/**
 * Shared Gemini layer. Every server-side model call in the app goes through
 * this module (Gemini API, `@google/genai` Interactions API, which the docs
 * recommend for new projects: aistudio.google.com/docs/interactions).
 *
 * Stable interface (others import it; add to it, never break it):
 *   getGemini, isLlmConfigured, MODELS, generateJson, generateText,
 *   groundedSearch, LlmNotConfiguredError, LlmRefusalError.
 *
 * Model IDs come from aistudio.google.com/docs/models and are overridable
 * with GEMINI_MODEL_REASONING / GEMINI_MODEL_FAST / GEMINI_MODEL_LITE.
 */
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

// ---------------------------------------------------------------- errors

export class LlmNotConfiguredError extends Error {
  readonly code = "llm_not_configured" as const;
  constructor(message = "Gemini is not configured (GEMINI_API_KEY is missing)") {
    super(message);
    this.name = "LlmNotConfiguredError";
  }
}

/** The model blocked or declined the request. `reason` is the block reason / status reported by the API. */
export class LlmRefusalError extends Error {
  readonly code = "llm_refusal" as const;
  constructor(
    readonly reason: string,
    message?: string,
  ) {
    super(message ?? `Gemini declined the request (${reason})`);
    this.name = "LlmRefusalError";
  }
}

/**
 * The project cannot pay for the call: HTTP 402 ("Your prepayment credits are
 * depleted") or billing not enabled for a paid-only model. Fatal for a scan.
 */
export class LlmBillingError extends Error {
  readonly code = "llm_billing" as const;
  constructor(readonly status: number, message = "Gemini billing: the project's prepayment credits are depleted or billing is not enabled (AI Studio > Projects > Billing). Also check for a GEMINI_API_KEY in your shell / OS environment overriding .env.local: Next.js and node --env-file never replace an existing variable") {
    super(message);
    this.name = "LlmBillingError";
  }
}

/** HTTP 429 RESOURCE_EXHAUSTED after the SDK's own retries. */
export class LlmRateLimitError extends Error {
  readonly code = "llm_rate_limit" as const;
  constructor(message = "Gemini rate limit reached (429)") {
    super(message);
    this.name = "LlmRateLimitError";
  }
}

function httpStatusOf(e: unknown): number | undefined {
  const o = e as { status?: unknown; statusCode?: unknown; httpMeta?: { response?: { status?: unknown } } } | null;
  const s = o?.status ?? o?.statusCode ?? o?.httpMeta?.response?.status;
  if (typeof s === "number") return s;
  const m = e instanceof Error ? e.message.match(/^(\d{3}) /) : null;
  return m ? Number(m[1]) : undefined;
}

/** Map SDK HTTP errors to typed errors; anything else is rethrown unchanged. */
export function mapGeminiError(e: unknown): unknown {
  const status = httpStatusOf(e);
  if (status === 402) return new LlmBillingError(402);
  if (status === 429) return new LlmRateLimitError();
  if (status === 403 && e instanceof Error && /billing|prepay|payment/i.test(e.message)) return new LlmBillingError(403);
  return e;
}

/** The call hit its deadline (timeoutMs) without an answer. */
export class LlmTimeoutError extends Error {
  readonly code = "llm_timeout" as const;
  constructor(readonly ms: number) {
    super(`Gemini did not answer within ${ms} ms`);
    this.name = "LlmTimeoutError";
  }
}

/** Structured output stayed invalid after the repair retry. */
export class LlmOutputError extends Error {
  readonly code = "llm_bad_output" as const;
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

// ---------------------------------------------------------------- models

const DEFAULT_MODELS = {
  /** Frontier reasoning at lower token spend than gemini-4-carbon. Attack chains, scoring. */
  reasoning: "gemini-4-argon",
  /** Stable, supports Google Search + URL context + structured output together. Search / extraction agents. */
  fast: "gemini-3.8-flash",
  /** Cheapest stable text model. Duplicate checks, tiny classifications. */
  lite: "gemini-3.1-flash-lite",
} as const;

export type ModelRole = keyof typeof DEFAULT_MODELS;

/** Model IDs, read from env at access time so overrides apply without a rebuild. */
export const MODELS: { readonly reasoning: string; readonly fast: string; readonly lite: string } = {
  get reasoning() {
    return process.env.GEMINI_MODEL_REASONING?.trim() || DEFAULT_MODELS.reasoning;
  },
  get fast() {
    return process.env.GEMINI_MODEL_FAST?.trim() || DEFAULT_MODELS.fast;
  },
  get lite() {
    return process.env.GEMINI_MODEL_LITE?.trim() || DEFAULT_MODELS.lite;
  },
};

/** Human label for status lines, e.g. "Gemini 4 Argon". */
export function modelLabel(model: string): string {
  const m = model.replace(/^models\//, "");
  const parts = m.split("-").filter(Boolean);
  if (parts[0] !== "gemini") return m;
  return [
    "Gemini",
    ...parts.slice(1).map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))),
  ].join(" ");
}

// ---------------------------------------------------------------- client

/** Minimal surface of the SDK client we use; lets tests inject a mock. */
export type GeminiClient = Pick<GoogleGenAI, "interactions">;

let cachedClient: GeminiClient | null = null;
let cachedKey: string | null = null;
let testClient: GeminiClient | null = null;

export function isLlmConfigured(): boolean {
  return Boolean(testClient) || Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function getGemini(): GeminiClient {
  if (testClient) return testClient;
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new LlmNotConfiguredError();
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new GoogleGenAI({ apiKey: key });
    cachedKey = key;
  }
  return cachedClient;
}

/** Test hook: inject a mocked client (pass null to reset). */
export function __setGeminiClientForTests(client: unknown): void {
  testClient = (client as GeminiClient | null) ?? null;
}

// ---------------------------------------------------------------- usage / cost

export type LlmUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  searchQueries: number;
};

/** USD per 1M tokens (paid tier) from aistudio.google.com/docs/pricing, read 2026-11-14. Thinking billed as output. */
const PRICES: Record<string, { in: number; out: number }> = {
  "gemini-4-carbon": { in: 2.0, out: 10.0 }, // $4 / $20 from 2026-12-01
  "gemini-4-argon": { in: 2.0, out: 10.0 }, // $4 / $20 from 2026-12-01
  "gemini-4-hydrogen": { in: 1.5, out: 7.5 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75 }, // $1.50 / $7.50 from 2027-01-01
  "gemini-3.6-flash": { in: 0.75, out: 3.75 },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
};
/** Grounding with Google Search on Gemini 3+: $14 / 1,000 executed queries after 5,000 free per month. */
const SEARCH_QUERY_USD = 14 / 1000;

export function estimateCostUsd(u: LlmUsage, opts: { countSearch?: boolean } = {}): number {
  const p = PRICES[u.model.replace(/^models\//, "")] ?? { in: 2, out: 10 };
  const tokens = (u.inputTokens * p.in + (u.outputTokens + u.thoughtTokens) * p.out) / 1_000_000;
  return tokens + (opts.countSearch === false ? 0 : u.searchQueries * SEARCH_QUERY_USD);
}

type UsageListener = (u: LlmUsage) => void;
const usageListeners = new Set<UsageListener>();
/** Subscribe to every call's usage (e.g. per-scan cost meter). Returns an unsubscribe fn. */
export function onLlmUsage(fn: UsageListener): () => void {
  usageListeners.add(fn);
  return () => usageListeners.delete(fn);
}

// ---------------------------------------------------------------- shared types

/** Inline media for multimodal prompts. `data` is base64 (no data: prefix). */
export type InlinePart = { mimeType: string; data: string };

export type BaseOptions = {
  model: string;
  system?: string;
  prompt: string;
  signal?: AbortSignal;
  /** "minimal" | "low" | "medium" | "high" — see aistudio.google.com/docs/thinking for per-model support. */
  thinking?: "minimal" | "low" | "medium" | "high" | "xhigh";
  maxOutputTokens?: number;
  temperature?: number;
  /** Hard per-call deadline in ms (default GEMINI_TIMEOUT_MS or 60s); no call can hang indefinitely. */
  timeoutMs?: number;
  /** Per-call usage callback (in addition to global onLlmUsage listeners). */
  onUsage?: UsageListener;
};

export type Source = { url: string; title?: string };

export type GroundedResult = {
  text: string;
  sources: Source[];
  queries: string[];
  /** `text` with " [n]" markers after each cited span; n is the 1-based index into `sources`. */
  annotatedText?: string;
};

// Loose structural views of the Interactions API response (SDK types are
// deeply nested unions; we read defensively so API additions don't break us).
type AnyRec = Record<string, unknown>;
type StepLike = AnyRec & { type?: string };
type InteractionLike = AnyRec & {
  status?: string;
  steps?: StepLike[];
  output_text?: string;
  usage?: AnyRec;
};

// ---------------------------------------------------------------- core call

function buildInput(prompt: string, parts?: InlinePart[]): unknown {
  if (!parts?.length) return prompt;
  const media = parts.map((p) => {
    const t = p.mimeType.startsWith("image/")
      ? "image"
      : p.mimeType.startsWith("audio/")
        ? "audio"
        : p.mimeType.startsWith("video/")
          ? "video"
          : "document";
    return { type: t, mime_type: p.mimeType, data: p.data };
  });
  // The SDK targets API v1, which rejects a bare list of content blocks
  // ("'image' is not supported for 'input[1].type' in v1", verified live
  // 2026-11-14); multi-part input must be one user_input step.
  return [{ type: "user_input", content: [{ type: "text", text: prompt }, ...media] }];
}

function defaultThinking(model: string): BaseOptions["thinking"] {
  if (model === MODELS.reasoning) return undefined; // model default (medium)
  if (/flash-lite/.test(model)) return "minimal";
  return "low";
}

type CallSpec = BaseOptions & {
  parts?: InlinePart[];
  tools?: AnyRec[];
  responseSchema?: AnyRec;
  stream?: boolean;
  onEvent?: (e: AnyRec) => void;
};

function readUsage(model: string, usage: AnyRec | undefined): LlmUsage {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  let searches = 0;
  const g = usage?.grounding_tool_count;
  if (Array.isArray(g)) {
    for (const c of g as AnyRec[]) {
      if (!c.type || String(c.type).includes("search")) searches += n(c.count);
    }
  }
  return {
    model,
    inputTokens: n(usage?.total_input_tokens),
    outputTokens: n(usage?.total_output_tokens),
    thoughtTokens: n(usage?.total_thought_tokens),
    searchQueries: searches,
  };
}

function emitUsage(spec: CallSpec, interaction: InteractionLike, fallbackQueries: number) {
  const u = readUsage(spec.model, interaction.usage);
  if (!u.searchQueries) u.searchQueries = fallbackQueries;
  spec.onUsage?.(u);
  for (const l of usageListeners) {
    try {
      l(u);
    } catch {
      /* listener errors never break a call */
    }
  }
}

/** Fold an SSE stream into the same shape as a non-streamed interaction. */
async function collectStream(
  stream: AsyncIterable<AnyRec>,
  onEvent?: (e: AnyRec) => void,
): Promise<InteractionLike> {
  const steps: StepLike[] = [];
  const out: InteractionLike = { steps };
  for await (const ev of stream) {
    onEvent?.(ev);
    const type = ev.event_type;
    if (type === "step.start") {
      const idx = Number(ev.index);
      steps[idx] = structuredClone((ev.step as StepLike) ?? {});
    } else if (type === "step.delta") {
      const idx = Number(ev.index);
      const step = (steps[idx] ??= {});
      const d = (ev.delta ?? {}) as AnyRec;
      switch (d.type) {
        case "text": {
          const content = ((step.content as AnyRec[]) ??= []);
          let last = content[content.length - 1];
          if (!last || last.type !== "text") {
            last = { type: "text", text: "" };
            content.push(last);
          }
          last.text = String(last.text ?? "") + String(d.text ?? "");
          break;
        }
        case "text_annotation_delta": {
          const content = ((step.content as AnyRec[]) ??= []);
          let last = content[content.length - 1];
          if (!last || last.type !== "text") {
            last = { type: "text", text: "" };
            content.push(last);
          }
          const anns = ((last.annotations as unknown[]) ??= []);
          if (Array.isArray(d.annotations)) anns.push(...d.annotations);
          break;
        }
        case "google_search_call": {
          step.type ??= "google_search_call";
          const prev = ((step.arguments as AnyRec) ?? {}).queries as string[] | undefined;
          const next = ((d.arguments as AnyRec) ?? {}).queries as string[] | undefined;
          step.arguments = { queries: [...(prev ?? []), ...(next ?? [])] };
          break;
        }
        case "google_search_result":
        case "url_context_result":
        case "url_context_call": {
          step.type ??= d.type;
          if (Array.isArray(d.result)) step.result = [...((step.result as unknown[]) ?? []), ...d.result];
          if (d.arguments) step.arguments = d.arguments;
          if (d.is_error) step.is_error = true;
          break;
        }
        default:
          break;
      }
    } else if (type === "interaction.completed" || type === "interaction.created") {
      const inter = (ev.interaction ?? {}) as AnyRec;
      if (inter.status) out.status = String(inter.status);
      if (inter.usage) out.usage = inter.usage as AnyRec;
      if (Array.isArray(inter.steps) && inter.steps.length && !steps.length) {
        steps.push(...(inter.steps as StepLike[]));
      }
    } else if (type === "interaction.status_update") {
      if (ev.status) out.status = String(ev.status);
      if (ev.usage) out.usage = ev.usage as AnyRec;
    } else if (type === "error") {
      const err = (ev.error ?? {}) as AnyRec;
      throw new Error(`Gemini stream error: ${err.code ?? "unknown"} ${err.message ?? ""}`.trim());
    }
  }
  return out;
}

const DEFAULT_TIMEOUT_MS = 60_000;

async function callGemini(spec: CallSpec): Promise<InteractionLike> {
  const client = getGemini();
  const thinking = spec.thinking ?? defaultThinking(spec.model);
  const generation_config: AnyRec = {};
  if (thinking) generation_config.thinking_level = thinking;
  if (spec.maxOutputTokens) generation_config.max_output_tokens = spec.maxOutputTokens;
  if (spec.temperature !== undefined) generation_config.temperature = spec.temperature;

  const params: AnyRec = {
    model: spec.model,
    input: buildInput(spec.prompt, spec.parts),
    store: false,
  };
  if (spec.system) params.system_instruction = spec.system;
  if (Object.keys(generation_config).length) params.generation_config = generation_config;
  if (spec.tools?.length) params.tools = spec.tools;
  if (spec.responseSchema) {
    params.response_format = { type: "text", mime_type: "application/json", schema: spec.responseSchema };
  }
  if (spec.stream) params.stream = true;

  const timeoutMs = spec.timeoutMs ?? (Number(process.env.GEMINI_TIMEOUT_MS) > 0 ? Number(process.env.GEMINI_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS);
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = spec.signal ? AbortSignal.any([spec.signal, deadline]) : deadline;
  const options = { fetch_options: { signal } };
  // The SDK's create() is a large overload set; params are assembled dynamically above.
  const create = client.interactions.create.bind(client.interactions) as unknown as (
    p: AnyRec,
    o?: AnyRec,
  ) => Promise<unknown>;

  let interaction: InteractionLike;
  try {
    if (spec.stream) {
      const stream = (await create(params, options)) as AsyncIterable<AnyRec>;
      interaction = await collectStream(stream, spec.onEvent);
    } else {
      interaction = (await create(params, options)) as InteractionLike;
    }
  } catch (e) {
    if (deadline.aborted && !spec.signal?.aborted) throw new LlmTimeoutError(timeoutMs);
    throw mapGeminiError(e);
  }
  spec.signal?.throwIfAborted();
  emitUsage(spec, interaction, collectQueries(interaction).length);
  assertNotBlocked(interaction);
  return interaction;
}

// ---------------------------------------------------------------- response readers

function modelOutputs(i: InteractionLike): StepLike[] {
  return (i.steps ?? []).filter((s) => s && s.type === "model_output");
}

function textBlocks(i: InteractionLike): AnyRec[] {
  return modelOutputs(i).flatMap((s) =>
    ((s.content as AnyRec[]) ?? []).filter((c) => c && c.type === "text"),
  );
}

export function extractText(i: InteractionLike): string {
  if (typeof i.output_text === "string" && i.output_text.length) return i.output_text;
  return textBlocks(i)
    .map((c) => String(c.text ?? ""))
    .join("");
}

function collectQueries(i: InteractionLike): string[] {
  const qs: string[] = [];
  for (const s of i.steps ?? []) {
    if (s?.type !== "google_search_call") continue;
    const q = ((s.arguments as AnyRec) ?? {}).queries;
    if (Array.isArray(q)) for (const x of q) if (typeof x === "string" && x.trim()) qs.push(x.trim());
  }
  return [...new Set(qs)];
}

function collectCitations(i: InteractionLike): Source[] {
  const out: Source[] = [];
  for (const block of textBlocks(i)) {
    for (const a of (block.annotations as AnyRec[]) ?? []) {
      if (a?.type === "url_citation" && typeof a.url === "string") {
        out.push({ url: a.url, title: typeof a.title === "string" ? a.title : undefined });
      }
    }
  }
  return out;
}

const sourceKey = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");

/**
 * Resolve every url_citation (grounding returns vertexaisearch redirect links,
 * observed live 2026-11-14), de-duplicate, and mark each cited span in the
 * text with " [n]" so a follow-up extraction can tie facts to real sources.
 */
async function annotateCitations(i: InteractionLike, signal?: AbortSignal): Promise<{ sources: Source[]; annotatedText: string }> {
  const blocks = textBlocks(i);
  const rawUrls = new Set<string>();
  for (const b of blocks) for (const a of (b.annotations as AnyRec[]) ?? []) if (a?.type === "url_citation" && typeof a.url === "string") rawUrls.add(a.url);
  const resolved = new Map<string, string | null>();
  await Promise.all([...rawUrls].map(async (u) => resolved.set(u, await resolveSourceUrl(u, signal))));
  const sources: Source[] = [];
  const indexOf = new Map<string, number>();
  const idx = (url: string, title?: string) => {
    const k = sourceKey(url);
    let n = indexOf.get(k);
    if (n === undefined) {
      sources.push({ url, title });
      n = sources.length;
      indexOf.set(k, n);
    }
    return n;
  };
  const parts = blocks.map((b) => {
    const text = String(b.text ?? "");
    const marks = new Map<number, Set<number>>();
    for (const a of (b.annotations as AnyRec[]) ?? []) {
      if (a?.type !== "url_citation" || typeof a.url !== "string") continue;
      const url = resolved.get(a.url);
      if (!url) continue;
      const n = idx(url, typeof a.title === "string" ? a.title : undefined);
      const end = typeof a.end_index === "number" ? Math.min(Math.max(0, a.end_index), text.length) : text.length;
      (marks.get(end) ?? marks.set(end, new Set()).get(end)!).add(n);
    }
    let out = text;
    for (const end of [...marks.keys()].sort((x, y) => y - x)) {
      out = out.slice(0, end) + ` ${[...marks.get(end)!].sort((x, y) => x - y).map((n) => `[${n}]`).join("")}` + out.slice(end);
    }
    return out;
  });
  return { sources, annotatedText: parts.join("") };
}

/** URLs the URL context tool actually retrieved successfully. */
export function retrievedUrls(i: InteractionLike): { url: string; status: string }[] {
  const out: { url: string; status: string }[] = [];
  for (const s of i.steps ?? []) {
    if (s?.type !== "url_context_result") continue;
    for (const r of (s.result as AnyRec[]) ?? []) {
      if (typeof r?.url === "string") out.push({ url: r.url, status: String(r.status ?? "unknown") });
    }
  }
  return out;
}

const BLOCKED_STATUSES = new Set(["failed", "cancelled", "incomplete", "budget_exceeded"]);

function assertNotBlocked(i: InteractionLike) {
  const outErr = modelOutputs(i)
    .map((s) => s.error as AnyRec | undefined)
    .find(Boolean);
  if (outErr) {
    throw new LlmRefusalError(String(outErr.message ?? outErr.code ?? "blocked"));
  }
  if (i.status && BLOCKED_STATUSES.has(i.status) && !extractText(i).trim()) {
    throw new LlmRefusalError(i.status);
  }
}

// ---------------------------------------------------------------- citation URL resolution

const REDIRECT_HOSTS = /(^|\.)vertexaisearch\.cloud\.google\.com$/i;

/**
 * Current docs show url_citation.url as the publisher URL; older grounding
 * responses used vertexaisearch.cloud.google.com redirect links. Resolve those
 * by reading the Location header (no body download), so we never store or
 * show a Google redirect as a finding source.
 */
export async function resolveSourceUrl(url: string, signal?: AbortSignal): Promise<string | null> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!REDIRECT_HOSTS.test(host)) return url;
  try {
    const ctrl = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(4000)]);
    const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: ctrl });
    const loc = res.headers.get("location");
    if (loc && /^https?:\/\//i.test(loc)) return loc;
  } catch {
    /* fall through */
  }
  return null;
}

async function resolveSources(raw: Source[], signal?: AbortSignal): Promise<Source[]> {
  const resolved = await Promise.all(
    raw.map(async (s) => {
      const url = await resolveSourceUrl(s.url, signal);
      return url ? { url, title: s.title } : null;
    }),
  );
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of resolved) {
    if (!s) continue;
    const key = s.url.replace(/#.*$/, "").replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------- JSON schema

/** zod -> JSON Schema for response_format. Drops keys the API rejects or ignores. */
export function toGeminiSchema(schema: z.ZodType): AnyRec {
  const js = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as AnyRec;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    const o: AnyRec = {};
    for (const [k, v] of Object.entries(node as AnyRec)) {
      if (k === "$schema" || k === "$id" || k === "pattern") continue;
      o[k] = strip(v);
    }
    return o;
  };
  return strip(js) as AnyRec;
}

function parseJsonLoose(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new SyntaxError("No JSON found in model output");
  }
}

// ---------------------------------------------------------------- public API

export type GenerateJsonOptions<S extends z.ZodType> = BaseOptions & {
  schema: S;
  parts?: InlinePart[];
};

async function jsonWithRepair<S extends z.ZodType>(
  opts: GenerateJsonOptions<S> & { tools?: AnyRec[] },
): Promise<{ data: z.output<S>; interaction: InteractionLike }> {
  const responseSchema = toGeminiSchema(opts.schema);
  let interaction = await callGemini({ ...opts, responseSchema });
  let text = extractText(interaction);
  let firstError: string;
  try {
    return { data: opts.schema.parse(parseJsonLoose(text)), interaction };
  } catch (e) {
    firstError = e instanceof Error ? e.message : String(e);
  }
  // One repair retry: show the model its own output and the validation error.
  const repairPrompt = `${opts.prompt}\n\n---\nYour previous answer was not valid for the required JSON schema.\nValidation error: ${firstError.slice(0, 1500)}\nPrevious answer:\n${text.slice(0, 6000)}\n\nReturn ONLY corrected JSON matching the schema.`;
  interaction = await callGemini({ ...opts, prompt: repairPrompt, responseSchema });
  text = extractText(interaction);
  try {
    return { data: opts.schema.parse(parseJsonLoose(text)), interaction };
  } catch (e) {
    throw new LlmOutputError(
      `Gemini returned invalid JSON after one repair: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Structured output validated by zod; one repair retry; LlmRefusalError on block. */
export async function generateJson<S extends z.ZodType>(opts: GenerateJsonOptions<S>): Promise<z.output<S>> {
  return (await jsonWithRepair(opts)).data;
}

export async function generateText(opts: BaseOptions & { parts?: InlinePart[] }): Promise<string> {
  const interaction = await callGemini(opts);
  const text = extractText(interaction);
  if (!text.trim()) throw new LlmRefusalError(interaction.status ?? "empty_response");
  return text;
}

export type GroundedSearchOptions = BaseOptions & {
  /** Also enable the URL context tool for these URLs (max 20 per request per docs). */
  urls?: string[];
  /** Live callbacks while the grounded call streams. */
  onQueries?: (queries: string[]) => void;
  onText?: (delta: string) => void;
};

function groundingTools(urls?: string[]): AnyRec[] {
  const tools: AnyRec[] = [{ type: "google_search" }];
  if (urls?.length) tools.push({ type: "url_context" });
  return tools;
}

function withUrls(prompt: string, urls?: string[]): string {
  if (!urls?.length) return prompt;
  return `${prompt}\n\nURLs to read:\n${urls.slice(0, 20).join("\n")}`;
}

function streamHooks(opts: GroundedSearchOptions) {
  const seenQ = new Set<string>();
  return (e: AnyRec) => {
    if (e.event_type !== "step.delta" && e.event_type !== "step.start") return;
    const d = ((e.delta ?? e.step) ?? {}) as AnyRec;
    if (d.type === "google_search_call" && opts.onQueries) {
      const q = (((d.arguments as AnyRec) ?? {}).queries as string[] | undefined) ?? [];
      const fresh = q.filter((x) => typeof x === "string" && !seenQ.has(x));
      fresh.forEach((x) => seenQ.add(x));
      if (fresh.length) opts.onQueries(fresh);
    } else if (d.type === "text" && opts.onText && typeof d.text === "string") {
      opts.onText(d.text);
    }
  };
}

/** Grounding with Google Search (+ URL context when `urls` given). Streams; sources resolved to real URLs. */
export async function groundedSearch(opts: GroundedSearchOptions): Promise<GroundedResult> {
  const interaction = await callGemini({
    ...opts,
    prompt: withUrls(opts.prompt, opts.urls),
    tools: groundingTools(opts.urls),
    stream: true,
    onEvent: streamHooks(opts),
  });
  const { sources, annotatedText } = await annotateCitations(interaction, opts.signal);
  return {
    text: extractText(interaction),
    sources,
    queries: collectQueries(interaction),
    annotatedText,
  };
}

/**
 * Grounded search + structured output in one call (supported on Gemini 3+/4
 * per aistudio.google.com/docs/structured-output). Returns the parsed data plus
 * the grounding citations / queries / URL-context retrievals for that call.
 */
export async function groundedJson<S extends z.ZodType>(
  opts: GenerateJsonOptions<S> & { urls?: string[]; search?: boolean },
): Promise<{ data: z.output<S>; sources: Source[]; queries: string[]; retrieved: { url: string; status: string }[] }> {
  const tools: AnyRec[] = [];
  if (opts.search !== false) tools.push({ type: "google_search" });
  if (opts.urls?.length) tools.push({ type: "url_context" });
  const { data, interaction } = await jsonWithRepair({
    ...opts,
    prompt: withUrls(opts.prompt, opts.urls),
    tools,
  });
  return {
    data,
    sources: await resolveSources(collectCitations(interaction), opts.signal),
    queries: collectQueries(interaction),
    retrieved: retrievedUrls(interaction),
  };
}
