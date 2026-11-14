import { z } from "zod";
import {
  generateJson,
  groundedJson,
  groundedSearch,
  LlmBillingError,
  LlmNotConfiguredError,
  type LlmUsage,
  type Source,
} from "@/lib/llm/gemini";
import type { ScanSubject } from "@/lib/types";
import { FindingCategory, IdentityAnchor, SourceType as SourceTypeEnum } from "@/lib/types";
import { normalizeUrl, type FindingCollector } from "./findings";
import type { Limiter } from "./limit";
import type { PageReader } from "./pageReader";
import { SEARCH_EXTRACT_SYSTEM, SEARCH_REPORT_SYSTEM, SEARCH_SYSTEM, subjectBlock } from "./prompts";

/**
 * One search = two Gemini calls:
 *  1. Grounding with Google Search (streamed): a short fact-per-sentence report.
 *     Its url_citation annotations (resolved from Google's redirect links) are
 *     the ground truth for sources; each cited span is marked " [n]".
 *  2. Structured output (no tools) turns the marked report into findings that
 *     cite a source NUMBER, so every finding's sourceUrl is a page Google
 *     Search actually returned, never a URL the model typed.
 * Live test 2026-11-14: grounding + structured output in ONE call returned no
 * url_citation annotations at all, so that path (SCAN_SEARCH_MODE=json) can
 * only trust model-written URLs; it is kept as an option, not the default.
 * Findings go to the collector as each worker finishes; workers run in parallel.
 */

const WorkerFinding = z.object({
  category: FindingCategory.exclude(["video"]),
  label: z.string().describe('Short label, e.g. "Dog\'s name", "High school", "Instagram handle".'),
  value: z.string().describe('The specific fact itself, e.g. "Biscuit". Not a description.'),
  sourceType: SourceTypeEnum.describe("Kind of site the result is on."),
  sourceUrl: z.string().describe("Exact URL of the search result that shows the fact."),
  sourceTitle: z.string(),
  snippet: z.string().describe("Short quote (under 200 chars) from the result."),
  anchor: IdentityAnchor.exclude(["face"]),
  confidence: z.number(),
  riskWeight: z.number(),
});

const WorkerOutput = z.object({
  findings: z.array(WorkerFinding),
  pages: z
    .array(z.object({ url: z.string(), why: z.string() }))
    .describe("Up to 5 result URLs clearly about the subject that are worth reading in full."),
});
type WorkerOutput = z.infer<typeof WorkerOutput>;

const ExtractOutput = z.object({
  findings: z.array(
    WorkerFinding.omit({ sourceUrl: true, sourceTitle: true }).extend({
      source: z.number().describe("Source marker number on the fact's sentence, e.g. 2 for [2]."),
    }),
  ),
  pages: z.array(z.number()).describe("Source numbers of pages worth reading in full (max 5)."),
});

export interface WorkerResult {
  accepted: number;
  searches: number;
  input: number;
  output: number;
  thought: number;
  /** Candidate findings tied to a grounding citation. */
  pinned: number;
  /** Candidate findings dropped because no grounding citation backs them. */
  uncited: number;
  /** Workers whose grounded search returned no citations at all. */
  noCitations: number;
}

export interface WorkerCtx {
  subject: ScanSubject;
  collector: FindingCollector;
  reader: PageReader;
  model: string;
  /** Model for the structured extraction step (defaults to `model`). */
  extractModel?: string;
  limiter: Limiter;
  signal: AbortSignal;
  knownAnchors: () => string;
  onUsage?: (u: LlmUsage) => void;
  /** Live Google queries of this worker (from the grounding stream). */
  onQueries?: (agentId: string, queries: string[]) => void;
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
};

/**
 * Pin a model-written URL to a grounding citation: exact canonical match, then
 * same host + path prefix, then the only citation on that host. null = no
 * citation backs it.
 */
export function pinToCitation(url: string, sources: Source[]): Source | null {
  if (!url) return null;
  const c = normalizeUrl(url);
  const exact = sources.find((s) => normalizeUrl(s.url) === c);
  if (exact) return exact;
  const h = host(url);
  if (!h) return null;
  const sameHost = sources.filter((s) => host(s.url) === h);
  const prefix = sameHost.find((s) => {
    const a = normalizeUrl(s.url);
    return a.startsWith(c) || c.startsWith(a);
  });
  if (prefix) return prefix;
  return sameHost.length === 1 ? sameHost[0] : null;
}

function userPrompt(query: string, hint: string, ctx: WorkerCtx) {
  return `Subject (the signed-in user; the only person you may research):\n${subjectBlock(ctx.subject)}\nAlready confirmed about them: ${ctx.knownAnchors() || "(nothing yet)"}\n\nYour Google Search query: ${query}\nWhat to look for: ${hint}`;
}

type Candidate = Omit<WorkerOutput["findings"][number], "sourceUrl" | "sourceTitle">;

export async function runSearchWorker(query: string, hint: string, agentId: string, ctx: WorkerCtx): Promise<WorkerResult> {
  const out: WorkerResult = { accepted: 0, searches: 0, input: 0, output: 0, thought: 0, pinned: 0, uncited: 0, noCitations: 0 };
  return ctx.limiter.run(async () => {
    if (ctx.signal.aborted) return out;
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]);
    const onUsage = (u: LlmUsage) => {
      out.input += u.inputTokens;
      out.output += u.outputTokens;
      out.thought += u.thoughtTokens;
      out.searches += u.searchQueries;
      ctx.onUsage?.(u);
    };
    const adds: Promise<void>[] = [];
    const add = (f: Candidate, sourceUrl: string, sourceTitle?: string) => {
      adds.push(
        ctx.collector
          .add(
            {
              ...f,
              sourceUrl,
              sourceTitle,
              snippet: f.snippet || undefined,
              confidence: Math.min(1, Math.max(0, f.confidence)),
              riskWeight: Math.min(10, Math.max(0, f.riskWeight)),
            },
            agentId,
          )
          .then((r) => {
            if (r.ok) out.accepted++;
          }),
      );
    };
    try {
      if (process.env.SCAN_SEARCH_MODE === "json") {
        await singleCall(query, hint, agentId, ctx, signal, onUsage, out, add);
      } else {
        await twoStep(query, hint, agentId, ctx, signal, onUsage, out, add);
      }
      await Promise.allSettled(adds);
    } catch (e) {
      await Promise.allSettled(adds);
      // Fatal for the whole scan: the orchestrator surfaces these.
      if (e instanceof LlmNotConfiguredError || e instanceof LlmBillingError) throw e;
      if (!ctx.signal.aborted) console.warn(`[scan:${agentId}] worker failed:`, e instanceof Error ? `${e.name}: ${e.message.slice(0, 160)}` : e);
    }
    return out;
  });
}

async function twoStep(
  query: string,
  hint: string,
  agentId: string,
  ctx: WorkerCtx,
  signal: AbortSignal,
  onUsage: (u: LlmUsage) => void,
  out: WorkerResult,
  add: (f: Candidate, url: string, title?: string) => void,
) {
  const g = await groundedSearch({
    model: ctx.model,
    system: SEARCH_REPORT_SYSTEM,
    prompt: userPrompt(query, hint, ctx),
    thinking: "low",
    signal,
    onUsage,
    onQueries: (q) => ctx.onQueries?.(agentId, q),
  });
  const report = (g.annotatedText ?? g.text).trim();
  if (!g.sources.length) out.noCitations++;
  if (!g.sources.length || !report || /^nothing about the subject\.?$/i.test(report)) {
    if (process.env.SCAN_DEBUG === "1") console.log(`[scan:${agentId}] worker: no cited results (sources=${g.sources.length})`);
    return;
  }
  const data = await generateJson({
    model: ctx.extractModel ?? ctx.model,
    system: SEARCH_EXTRACT_SYSTEM,
    schema: ExtractOutput,
    thinking: "low",
    signal,
    onUsage,
    prompt: `${userPrompt(query, hint, ctx)}\n\nSEARCH REPORT:\n${report}\n\nSOURCES:\n${g.sources.map((s, i) => `[${i + 1}] ${s.url}${s.title ? ` (${s.title})` : ""}`).join("\n")}`,
  });
  for (const { source, ...f } of data.findings) {
    const src = g.sources[Math.round(source) - 1];
    if (!src) {
      out.uncited++;
      continue;
    }
    out.pinned++;
    add(f, src.url, src.title);
  }
  for (const n of data.pages.slice(0, 5)) {
    const src = g.sources[Math.round(n) - 1];
    if (src) ctx.reader.enqueue({ url: src.url, why: `search result for: ${query}`, depth: 0 });
  }
  if (process.env.SCAN_DEBUG === "1") {
    console.log(`[scan:${agentId}] worker citations=${g.sources.length} candidates=${data.findings.length} pinned=${out.pinned} uncited=${out.uncited} searches=${out.searches}`);
  }
}

/** Alternate path: grounding + structured output in one call; URLs pinned to citations when any come back. */
async function singleCall(
  query: string,
  hint: string,
  agentId: string,
  ctx: WorkerCtx,
  signal: AbortSignal,
  onUsage: (u: LlmUsage) => void,
  out: WorkerResult,
  add: (f: Candidate, url: string, title?: string) => void,
) {
  const r = await groundedJson({ model: ctx.model, system: SEARCH_SYSTEM, prompt: userPrompt(query, hint, ctx), schema: WorkerOutput, thinking: "low", signal, onUsage });
  if (r.queries.length) ctx.onQueries?.(agentId, r.queries);
  const sources = r.sources;
  if (!sources.length) out.noCitations++;
  for (const { sourceUrl, sourceTitle, ...f } of r.data.findings) {
    if (!sources.length) {
      add(f, sourceUrl, sourceTitle || undefined);
      continue;
    }
    const pin = pinToCitation(sourceUrl, sources);
    if (!pin) {
      out.uncited++;
      continue;
    }
    out.pinned++;
    const keepDeeper = normalizeUrl(sourceUrl).startsWith(normalizeUrl(pin.url));
    add(f, keepDeeper ? sourceUrl : pin.url, sourceTitle || pin.title);
  }
  for (const p of r.data.pages.slice(0, 5)) {
    const url = sources.length ? pinToCitation(p.url, sources)?.url : p.url;
    if (url) ctx.reader.enqueue({ url, why: p.why ?? "", depth: 0 });
  }
}
