import { FindingCategory } from "@/lib/types";
import { tokens } from "@/lib/search/local";
import { EMBED_MODEL, typesenseConfig, type TypesenseConfig } from "@/lib/search/typesense";
import { CASE_COLLECTION, caseDocs } from "./docs";
import { caseOpen } from "./match";
import type { CaseDoc, CaseHit, CaseRequest, CaseResponse } from "./types";

/*
 * "Which real, reported scams does this exposure make possible?"
 * Filter: every fact the case needs must be exposed. Rank: by meaning against the query text.
 * Typesense does both in one request; the local scorer is the fallback when it is unset or down.
 */

const TIMEOUT_MS = 4000;
const BATCH = 25;
const ALL = FindingCategory.options;

export const CASE_SCHEMA = {
  name: CASE_COLLECTION,
  fields: [
    { name: "title", type: "string" },
    { name: "summary", type: "string" },
    { name: "scam_type", type: "string", facet: true },
    { name: "how", type: "string" },
    { name: "channels", type: "string[]", facet: true },
    { name: "needs", type: "string[]", facet: true },
    { name: "source", type: "string", facet: true },
    { name: "year", type: "int32" },
    { name: "url", type: "string", index: false, optional: true },
    { name: "embedding", type: "float[]", embed: { from: ["how"], model_config: { model_name: EMBED_MODEL } } },
  ],
};

async function call<T>(cfg: TypesenseConfig, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(`${cfg.host}${path}`, {
    ...init,
    headers: { "X-TYPESENSE-API-KEY": cfg.apiKey, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Typesense ${init.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

/** Drops and recreates only the scam_cases collection, then loads it. Used by scripts/index-typesense.ts. */
export async function reindexCases(cfg: TypesenseConfig, docs: CaseDoc[] = caseDocs()): Promise<number> {
  await call(cfg, `/collections/${CASE_COLLECTION}`, { method: "DELETE" }).catch(() => null);
  // First creation downloads the embedding model, which can take a while.
  await call(cfg, "/collections", { method: "POST", body: JSON.stringify(CASE_SCHEMA), timeoutMs: 180_000 });
  // Small batches with a pause: a 0.5 GB cluster rejects a large write while it embeds.
  let loaded = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const res = await fetch(`${cfg.host}/collections/${CASE_COLLECTION}/documents/import?action=upsert`, {
      method: "POST",
      headers: { "X-TYPESENSE-API-KEY": cfg.apiKey, "content-type": "text/plain" },
      body: docs.slice(i, i + BATCH).map((d) => JSON.stringify(d)).join("\n"),
      signal: AbortSignal.timeout(300_000),
    });
    const body = await res.text();
    const lines = body.split(/\r?\n/).filter((l) => l.trim());
    const failed = lines.filter((l) => !/^\{"success":\s*true\}$/.test(l.trim()));
    if (!res.ok || failed.length) throw new Error(`Import into ${CASE_COLLECTION} failed: ${(failed[0] ?? String(res.status)).slice(0, 200)}`);
    loaded += lines.length;
    await new Promise((r) => setTimeout(r, 400));
  }
  return loaded;
}

/** "needs is a subset of exposed" written as "needs holds none of the unexposed categories". */
export function needsFilter(exposed: readonly string[]): string | undefined {
  const have = new Set(exposed);
  const missing = ALL.filter((c) => !have.has(c));
  return missing.length ? `needs:!=[${missing.join(",")}]` : undefined;
}

interface Hit {
  document: CaseDoc;
  text_match?: number;
  vector_distance?: number;
  hybrid_search_info?: { rank_fusion_score?: number };
}

const rawScore = (h: Hit) => h.hybrid_search_info?.rank_fusion_score ?? (h.vector_distance !== undefined ? 1 - h.vector_distance / 2 : (h.text_match ?? 0));

const toHit = (d: CaseDoc, score: number): CaseHit => ({
  id: d.id,
  source: d.source,
  url: d.url,
  year: d.year,
  title: d.title,
  summary: d.summary,
  scam_type: d.scam_type,
  how: d.how,
  channels: d.channels,
  needs: d.needs,
  score: Math.round(score * 100) / 100,
});

async function typesenseCases(cfg: TypesenseConfig, req: CaseRequest, limit: number): Promise<CaseResponse["byQuery"]> {
  const filter = needsFilter(req.exposed);
  const searches = req.queries.map((q) => ({
    collection: CASE_COLLECTION,
    q: q.text,
    query_by: "title,summary,embedding",
    // The queries are whole descriptions of an attack, so meaning counts far more than shared words.
    vector_query: "embedding:([], alpha: 0.8)",
    exclude_fields: "embedding",
    prefix: false,
    per_page: limit,
    ...(filter ? { filter_by: filter } : {}),
  }));
  const out = await call<{ results: { hits?: Hit[]; error?: string }[] }>(cfg, "/multi_search", { method: "POST", body: JSON.stringify({ searches }) });
  const byQuery: CaseResponse["byQuery"] = {};
  out.results.forEach((r, i) => {
    if (r.error) throw new Error(`Typesense search failed: ${r.error}`);
    const hits = r.hits ?? [];
    const best = Math.max(0, ...hits.map(rawScore));
    byQuery[req.queries[i].id] = hits.map((h) => toHit(h.document, best > 0 ? rawScore(h) / best : 0));
  });
  return byQuery;
}

function index(docs: CaseDoc[]) {
  return docs.map((doc) => ({ doc, terms: new Set(tokens([doc.how, doc.how, doc.title, doc.summary].join(" "))) }));
}

let localIndex: ReturnType<typeof index> | null = null;

/** No-account fallback: same subset filter, then idf-weighted word overlap. */
export function localCases(req: CaseRequest, limit: number, docs?: CaseDoc[]): CaseResponse["byQuery"] {
  const items = docs ? index(docs) : (localIndex ??= index(caseDocs()));
  const df = new Map<string, number>();
  for (const it of items) for (const t of it.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const open = items.filter((it) => caseOpen(it.doc.needs, req.exposed));
  const byQuery: CaseResponse["byQuery"] = {};
  for (const q of req.queries) {
    const words = new Set(tokens(q.text));
    const rows = open
      .map((it) => {
        let s = 0;
        for (const w of words) if (it.terms.has(w)) s += Math.log(1 + items.length / (df.get(w) ?? items.length));
        return { doc: it.doc, raw: s };
      })
      .filter((r) => r.raw > 0)
      .sort((a, b) => b.raw - a.raw || b.doc.year - a.doc.year)
      .slice(0, limit);
    const best = rows[0]?.raw ?? 0;
    byQuery[q.id] = rows.map((r) => toHit(r.doc, best > 0 ? r.raw / best : 0));
  }
  return byQuery;
}

/** Runs on Typesense and quietly falls back to the local scorer if it is unset, down or not indexed yet. */
export async function searchCases(req: CaseRequest): Promise<CaseResponse> {
  const limit = req.limit ?? 5;
  const cfg = typesenseConfig();
  if (cfg) {
    try {
      return { engine: "typesense", byQuery: await typesenseCases(cfg, req, limit) };
    } catch (e) {
      console.warn("[cases] typesense unavailable, using local:", e instanceof Error ? e.message.split(":")[0] : "error");
    }
  }
  return { engine: "local", byQuery: localCases(req, limit) };
}
