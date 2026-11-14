// Unit tests for the shared Gemini layer with a mocked SDK client (no network,
// no key). Response shapes follow the Interactions API docs
// (aistudio.google.com/docs/google-search, /url-context, /streaming) and the
// @google/genai 3.3 type definitions. Run: npm run test:llm
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  __setGeminiClientForTests,
  estimateCostUsd,
  generateJson,
  generateText,
  getGemini,
  groundedJson,
  groundedSearch,
  isLlmConfigured,
  LlmBillingError,
  LlmNotConfiguredError,
  LlmRateLimitError,
  LlmTimeoutError,
  LlmOutputError,
  LlmRefusalError,
  MODELS,
  modelLabel,
} from "./gemini";

type Call = { params: Record<string, unknown>; options?: Record<string, unknown> };

function mockClient(responses: unknown[]) {
  const calls: Call[] = [];
  const client = {
    interactions: {
      create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.push({ params, options });
        const r = responses.shift();
        if (r instanceof Error) throw r;
        if (typeof r === "function") return r(params);
        return r;
      },
    },
  };
  __setGeminiClientForTests(client);
  return calls;
}

const textInteraction = (text: string, extra: Record<string, unknown> = {}) => ({
  id: "i1",
  status: "completed",
  steps: [{ type: "model_output", content: [{ type: "text", text }] }],
  usage: { total_input_tokens: 100, total_output_tokens: 20, total_thought_tokens: 5 },
  ...extra,
});

async function* sse(events: unknown[]) {
  for (const e of events) yield e;
}

const savedEnv = { ...process.env };
beforeEach(() => {
  __setGeminiClientForTests(null);
});
afterEach(() => {
  __setGeminiClientForTests(null);
  process.env = { ...savedEnv };
});

test("not configured: no key -> isLlmConfigured false and typed error", () => {
  delete process.env.GEMINI_API_KEY;
  assert.equal(isLlmConfigured(), false);
  assert.throws(() => getGemini(), LlmNotConfiguredError);
});

test("MODELS: defaults and env overrides", () => {
  delete process.env.GEMINI_MODEL_REASONING;
  assert.equal(MODELS.reasoning, "gemini-4-argon");
  assert.equal(MODELS.fast, "gemini-3.8-flash");
  assert.equal(MODELS.lite, "gemini-3.1-flash-lite");
  process.env.GEMINI_MODEL_REASONING = "gemini-4-carbon";
  process.env.GEMINI_MODEL_FAST = "gemini-4-hydrogen";
  process.env.GEMINI_MODEL_LITE = "gemini-3.5-flash-lite";
  assert.equal(MODELS.reasoning, "gemini-4-carbon");
  assert.equal(MODELS.fast, "gemini-4-hydrogen");
  assert.equal(MODELS.lite, "gemini-3.5-flash-lite");
  assert.equal(modelLabel("gemini-3.8-flash"), "Gemini 3.8 Flash");
});

test("generateJson: sends JSON schema response_format and validates with zod", async () => {
  const calls = mockClient([textInteraction('{"name":"Biscuit","age":3}')]);
  const schema = z.object({ name: z.string(), age: z.number() });
  let usage: unknown;
  const ctrl = new AbortController();
  const out = await generateJson({ model: "gemini-3.8-flash", system: "sys", prompt: "p", schema, signal: ctrl.signal, onUsage: (u) => (usage = u) });
  assert.deepEqual(out, { name: "Biscuit", age: 3 });
  const p = calls[0].params;
  assert.equal(p.model, "gemini-3.8-flash");
  assert.equal(p.system_instruction, "sys");
  assert.equal(p.store, false);
  const rf = p.response_format as { type: string; mime_type: string; schema: { type: string; $schema?: string } };
  assert.equal(rf.type, "text");
  assert.equal(rf.mime_type, "application/json");
  assert.equal(rf.schema.type, "object");
  assert.equal(rf.schema.$schema, undefined);
  const sent = (calls[0].options?.fetch_options as { signal: AbortSignal }).signal;
  assert.equal(sent.aborted, false);
  ctrl.abort();
  assert.equal(sent.aborted, true, "caller's signal is wired into the request");
  assert.deepEqual(usage, { model: "gemini-3.8-flash", inputTokens: 100, outputTokens: 20, thoughtTokens: 5, searchQueries: 0 });
});

test("generateJson: one repair retry on invalid JSON, then succeeds", async () => {
  const calls = mockClient([textInteraction('{"name": 42'), textInteraction('```json\n{"name":"ok"}\n```')]);
  const out = await generateJson({ model: "m", prompt: "p", schema: z.object({ name: z.string() }) });
  assert.deepEqual(out, { name: "ok" });
  assert.equal(calls.length, 2);
  assert.match(String(calls[1].params.input), /not valid for the required JSON schema/);
});

test("generateJson: still invalid after repair -> LlmOutputError", async () => {
  mockClient([textInteraction('{"x":1}'), textInteraction('{"x":2}')]);
  await assert.rejects(generateJson({ model: "m", prompt: "p", schema: z.object({ name: z.string() }) }), LlmOutputError);
});

test("refusal: failed interaction with model_output error -> LlmRefusalError with reason", async () => {
  mockClient([
    {
      id: "i2",
      status: "failed",
      steps: [{ type: "model_output", content: [], error: { code: 3, message: "SAFETY: dangerous_content" } }],
    },
  ]);
  await assert.rejects(generateText({ model: "m", prompt: "p" }), (e: unknown) => {
    assert.ok(e instanceof LlmRefusalError);
    assert.match(e.reason, /SAFETY/);
    return true;
  });
});

test("refusal: incomplete status with no text -> LlmRefusalError", async () => {
  mockClient([{ id: "i3", status: "incomplete", steps: [] }]);
  await assert.rejects(generateText({ model: "m", prompt: "p" }), LlmRefusalError);
});

test("multimodal parts are sent as one user_input step: text first, then media", async () => {
  const calls = mockClient([textInteraction('{"ok":true}')]);
  await generateJson({ model: "m", prompt: "describe", schema: z.object({ ok: z.boolean() }), parts: [{ mimeType: "image/png", data: "AAAA" }, { mimeType: "audio/mpeg", data: "BBBB" }] });
  // API v1 needs multi-part input wrapped in a single user_input step (live 400 otherwise).
  assert.deepEqual(calls[0].params.input, [
    {
      type: "user_input",
      content: [
        { type: "text", text: "describe" },
        { type: "image", mime_type: "image/png", data: "AAAA" },
        { type: "audio", mime_type: "audio/mpeg", data: "BBBB" },
      ],
    },
  ]);
});

test("groundedSearch: streams, collects queries, url_citation sources, usage; resolves redirect links", async () => {
  // Older grounding responses used redirect links; we resolve them via the Location header.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    assert.match(String(url), /vertexaisearch\.cloud\.google\.com/);
    return new Response(null, { status: 302, headers: { location: "https://news.example.org/story" } });
  }) as typeof fetch;
  const queries: string[] = [];
  let streamed = "";
  try {
    const calls = mockClient([
      sse([
        { event_type: "interaction.created", interaction: { id: "i4", status: "in_progress" } },
        { event_type: "step.start", index: 0, step: { type: "google_search_call", id: "c1", arguments: { queries: ["who won euro 2024"] } } },
        { event_type: "step.stop", index: 0 },
        { event_type: "step.start", index: 1, step: { type: "google_search_result", call_id: "c1", result: [{ search_suggestions: "<div>…</div>" }] } },
        { event_type: "step.stop", index: 1 },
        { event_type: "step.start", index: 2, step: { type: "model_output", content: [] } },
        { event_type: "step.delta", index: 2, delta: { type: "text", text: "Spain won " } },
        { event_type: "step.delta", index: 2, delta: { type: "text", text: "Euro 2024." } },
        {
          event_type: "step.delta",
          index: 2,
          delta: {
            type: "text_annotation_delta",
            annotations: [
              { type: "url_citation", url: "https://www.aljazeera.com/sports/euro", title: "aljazeera.com", start_index: 0, end_index: 9 },
              { type: "url_citation", url: "https://www.aljazeera.com/sports/euro", title: "aljazeera.com", start_index: 10, end_index: 19 },
              { type: "url_citation", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "example.org" },
            ],
          },
        },
        { event_type: "step.stop", index: 2 },
        {
          event_type: "interaction.completed",
          interaction: { id: "i4", status: "completed", usage: { total_input_tokens: 300, total_output_tokens: 40, total_thought_tokens: 0, grounding_tool_count: [{ type: "google_search", count: 1 }] } },
        },
      ]),
    ]);
    let usage: { searchQueries: number } | undefined;
    const r = await groundedSearch({
      model: "gemini-3.8-flash",
      prompt: "Who won the euro 2024?",
      onQueries: (q) => queries.push(...q),
      onText: (t) => (streamed += t),
      onUsage: (u) => (usage = u),
    });
    assert.equal(calls[0].params.stream, true);
    assert.deepEqual(calls[0].params.tools, [{ type: "google_search" }]);
    assert.equal(r.text, "Spain won Euro 2024.");
    assert.equal(streamed, "Spain won Euro 2024.");
    assert.deepEqual(r.queries, ["who won euro 2024"]);
    assert.deepEqual(queries, ["who won euro 2024"]);
    assert.deepEqual(r.sources, [
      { url: "https://www.aljazeera.com/sports/euro", title: "aljazeera.com" },
      { url: "https://news.example.org/story", title: "example.org" },
    ]);
    assert.equal(usage?.searchQueries, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("groundedSearch with urls adds the url_context tool and lists the URLs", async () => {
  const calls = mockClient([sse([{ event_type: "step.start", index: 0, step: { type: "model_output", content: [{ type: "text", text: "ok" }] } }, { event_type: "interaction.completed", interaction: { id: "x", status: "completed" } }])]);
  await groundedSearch({ model: "m", prompt: "read", urls: ["https://example.com/a"] });
  assert.deepEqual(calls[0].params.tools, [{ type: "google_search" }, { type: "url_context" }]);
  assert.match(String(calls[0].params.input), /https:\/\/example\.com\/a/);
});

test("stream error event surfaces as an error", async () => {
  mockClient([sse([{ event_type: "error", error: { code: "gateway_timeout", message: "upstream timed out" } }])]);
  await assert.rejects(groundedSearch({ model: "m", prompt: "p" }), /gateway_timeout/);
});

test("groundedJson: structured output + URL context, reports retrieval status and citations", async () => {
  const calls = mockClient([
    {
      id: "i5",
      status: "completed",
      steps: [
        { type: "url_context_call", id: "u1", arguments: { urls: ["https://example.com/about"] } },
        { type: "url_context_result", call_id: "u1", result: [{ url: "https://example.com/about", status: "success" }] },
        {
          type: "model_output",
          content: [{ type: "text", text: '{"pet":"Biscuit"}', annotations: [{ type: "url_citation", url: "https://example.com/about", title: "About" }] }],
        },
      ],
    },
  ]);
  const r = await groundedJson({ model: "m", prompt: "p", schema: z.object({ pet: z.string() }), search: false, urls: ["https://example.com/about"] });
  assert.deepEqual(r.data, { pet: "Biscuit" });
  assert.deepEqual(r.retrieved, [{ url: "https://example.com/about", status: "success" }]);
  assert.deepEqual(r.sources, [{ url: "https://example.com/about", title: "About" }]);
  assert.deepEqual(calls[0].params.tools, [{ type: "url_context" }]);
  assert.ok(calls[0].params.response_format);
});

test("cost estimate uses per-model prices and search query pricing", () => {
  const u = { model: "gemini-3.8-flash", inputTokens: 1_000_000, outputTokens: 0, thoughtTokens: 0, searchQueries: 10 };
  assert.equal(estimateCostUsd(u, { countSearch: false }), 0.75);
  assert.ok(Math.abs(estimateCostUsd(u) - (0.75 + 0.14)) < 1e-9);
});

test("HTTP 402 (prepayment credits depleted) -> LlmBillingError; 429 -> LlmRateLimitError", async () => {
  // Observed live: the SDK throws an error with status 402 and message "402 API error occurred".
  const e402 = Object.assign(new Error("402 API error occurred"), { status: 402 });
  mockClient([e402]);
  await assert.rejects(generateText({ model: "m", prompt: "p" }), LlmBillingError);
  mockClient([Object.assign(new Error("429 API error occurred"), { status: 429 })]);
  await assert.rejects(generateText({ model: "m", prompt: "p" }), LlmRateLimitError);
});

test("default deadline: a call that never answers ends with LlmTimeoutError", async () => {
  __setGeminiClientForTests({
    interactions: {
      create: (_p: unknown, o: { fetch_options: { signal: AbortSignal } }) =>
        new Promise((_, reject) => o.fetch_options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")))),
    },
  });
  const t = Date.now();
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout timers are unref'd
  await assert.rejects(generateText({ model: "m", prompt: "p", timeoutMs: 50 }), LlmTimeoutError);
  clearInterval(keepAlive);
  assert.ok(Date.now() - t < 2000);
});
