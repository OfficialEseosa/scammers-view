import { FIX_COLLECTION, PATTERN_COLLECTION } from "./docs";
import type { FixDoc, FixHit, PatternDoc, PatternHit, ScamSearch } from "./types";

/*
 * Typesense over its REST API (no SDK). Docs coded against:
 *  - POST /collections                                   (schema, with an auto-embedding field)
 *  - POST /collections/{name}/documents/import?action=upsert   (JSONL)
 *  - POST /multi_search                                  (hybrid: keyword fields + the embedding field in query_by)
 * Auth: X-TYPESENSE-API-KEY header.
 */

export const EMBED_MODEL = "ts/all-MiniLM-L12-v2";
const TIMEOUT_MS = 4000;
const MAX_Q = 600;

export interface TypesenseConfig {
  host: string;
  apiKey: string;
}

export function typesenseConfig(): TypesenseConfig | null {
  const host = process.env.TYPESENSE_HOST?.trim();
  const apiKey = process.env.TYPESENSE_API_KEY?.trim();
  if (!host || !apiKey) return null;
  return { host: host.replace(/\/+$/, ""), apiKey };
}

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

export const PATTERN_SCHEMA = {
  name: PATTERN_COLLECTION,
  fields: [
    { name: "name", type: "string" },
    { name: "tagline", type: "string" },
    { name: "opener", type: "string" },
    { name: "red_flags", type: "string[]" },
    { name: "action", type: "string" },
    { name: "sources", type: "string[]", index: false, optional: true },
    {
      name: "embedding",
      type: "float[]",
      embed: { from: ["name", "tagline", "opener", "red_flags"], model_config: { model_name: EMBED_MODEL } },
    },
  ],
};

export const FIX_SCHEMA = {
  name: FIX_COLLECTION,
  fields: [
    { name: "kind", type: "string", facet: true },
    { name: "title", type: "string" },
    { name: "steps", type: "string[]" },
    { name: "keywords", type: "string[]" },
    { name: "link", type: "string", index: false, optional: true },
  ],
};

/** Drops and recreates both collections, then loads the documents. Used by scripts/index-typesense.ts. */
export async function reindex(cfg: TypesenseConfig, docs: { patterns: PatternDoc[]; fixes: FixDoc[] }) {
  for (const schema of [PATTERN_SCHEMA, FIX_SCHEMA]) {
    await call(cfg, `/collections/${schema.name}`, { method: "DELETE" }).catch(() => null);
    // First creation downloads the embedding model, which can take a while.
    await call(cfg, "/collections", { method: "POST", body: JSON.stringify(schema), timeoutMs: 180_000 });
  }
  const load = async (name: string, rows: object[]) => {
    const res = await fetch(`${cfg.host}/collections/${name}/documents/import?action=upsert`, {
      method: "POST",
      headers: { "X-TYPESENSE-API-KEY": cfg.apiKey, "content-type": "text/plain" },
      body: rows.map((r) => JSON.stringify(r)).join("\n"),
      signal: AbortSignal.timeout(180_000),
    });
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { success: boolean; error?: string });
    const failed = lines.filter((l) => !l.success);
    if (!res.ok || failed.length) throw new Error(`Import into ${name} failed: ${failed[0]?.error ?? res.status}`);
    return lines.length;
  };
  return { patterns: await load(PATTERN_COLLECTION, docs.patterns), fixes: await load(FIX_COLLECTION, docs.fixes) };
}

interface Hit<T> {
  document: T;
  text_match?: number;
  vector_distance?: number;
  hybrid_search_info?: { rank_fusion_score?: number };
}
interface MultiResult<T> {
  results: { hits?: Hit<T>[]; error?: string }[];
}

const scoreOf = (h: Hit<unknown>, best: number) => {
  const raw = h.hybrid_search_info?.rank_fusion_score ?? (h.vector_distance !== undefined ? 1 - h.vector_distance / 2 : (h.text_match ?? 0));
  return best > 0 ? Math.round((raw / best) * 100) / 100 : 0;
};

export function createTypesenseSearch(cfg: TypesenseConfig): ScamSearch {
  async function one<T>(search: Record<string, unknown>): Promise<Hit<T>[]> {
    const out = await call<MultiResult<T>>(cfg, "/multi_search", { method: "POST", body: JSON.stringify({ searches: [search] }) });
    const r = out.results[0];
    if (!r || r.error) throw new Error(`Typesense search failed: ${r?.error ?? "no result"}`);
    return r.hits ?? [];
  }
  const best = (hits: Hit<unknown>[]) =>
    Math.max(0, ...hits.map((h) => h.hybrid_search_info?.rank_fusion_score ?? (h.vector_distance !== undefined ? 1 - h.vector_distance / 2 : (h.text_match ?? 0))));

  return {
    name: "typesense",
    async searchPatterns(text, limit) {
      const hits = await one<PatternDoc>({
        collection: PATTERN_COLLECTION,
        q: text.slice(0, MAX_Q),
        query_by: "name,tagline,red_flags,opener,embedding",
        exclude_fields: "embedding",
        prefix: false,
        drop_tokens_threshold: 0,
        per_page: limit,
      });
      const b = best(hits);
      return hits.map((h): PatternHit => ({ id: h.document.id, score: scoreOf(h, b) }));
    },
    async searchFixes(query, limit) {
      const hits = await one<FixDoc>({
        collection: FIX_COLLECTION,
        q: query.slice(0, 200),
        query_by: "title,keywords,steps",
        query_by_weights: "4,3,1",
        num_typos: 2,
        per_page: limit,
      });
      const b = best(hits);
      return hits.map((h): FixHit => ({ id: h.document.id, kind: h.document.kind, title: h.document.title, link: h.document.link, score: scoreOf(h, b) }));
    },
  };
}
