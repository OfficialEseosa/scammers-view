// Unit tests for the scan pipeline's pure logic. Run: npm run test:scan
// All fixtures are synthetic (no real people).
import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleHandles } from "./social.ts";
import { classify, exactKey, isUsefulInterest, richer } from "./dedupe.ts";

const F = (o) => ({
  id: "f1", category: "handle", label: "Instagram handle", value: "@demo.user", sourceType: "web",
  sourceUrl: "https://example.com", anchor: "github", confidence: 0.8, riskWeight: 5, foundAt: "", ...o,
});

test("social gate: anchored, confident handle per platform is eligible", () => {
  const h = eligibleHandles([F({})]);
  assert.equal(h.instagram?.handle, "demo.user");
});

test("social gate: name-only (unconfirmed) handles are never eligible", () => {
  const h = eligibleHandles([F({ anchor: "unconfirmed", confidence: 0.99 })]);
  assert.deepEqual(h, {});
});

test("social gate: confidence below 0.7 is not eligible", () => {
  assert.deepEqual(eligibleHandles([F({ confidence: 0.69 })]), {});
});

test("social gate: relatives' profiles are never eligible", () => {
  assert.deepEqual(eligibleHandles([F({ category: "relative", label: "Mother's Instagram", value: "https://instagram.com/someone" })]), {});
});

test("social gate: platform from profile URLs, reserved paths ignored", () => {
  const h = eligibleHandles([
    F({ category: "other", label: "Link", value: "https://x.com/realone", anchor: "email" }),
    F({ category: "handle", label: "site", value: "https://www.tiktok.com/@tt_user?lang=en", anchor: "school" }),
    F({ category: "handle", label: "post", value: "https://instagram.com/p/", anchor: "email" }),
    F({ category: "handle", label: "Bluesky", value: "demo.bsky.social", anchor: "github" }),
  ]);
  assert.equal(h.x?.handle, "realone");
  assert.equal(h.tiktok?.handle, "tt_user");
  assert.equal(h.instagram, undefined);
  assert.equal(h.bluesky?.handle, "demo.bsky.social");
});

test("social gate: picks the most confident handle per platform", () => {
  const h = eligibleHandles([F({ value: "@a_low", confidence: 0.75 }), F({ value: "@b_high", confidence: 0.9 })]);
  assert.equal(h.instagram?.handle, "b_high");
});

const C = (category, value, label = "x", sourceType = "web") => ({ category, value, label, sourceType });

test("dedupe: acronym vs full name", () => {
  assert.equal(classify(C("school", "GSU"), C("school", "Georgia State University")), "dup");
});

test("dedupe: suffix variants", () => {
  assert.equal(classify(C("employer", "Acme"), C("employer", "Acme Inc.")), "dup");
  assert.equal(classify(C("school", "Example State"), C("school", "Example State University")), "dup");
});

test("dedupe: @handle vs profile URL on the same platform", () => {
  const a = C("handle", "@demo_user", "Instagram handle");
  const b = C("handle", "https://www.instagram.com/demo_user/", "Profile");
  assert.equal(exactKey(a), exactKey(b));
});

test("dedupe: same username on different platforms stays distinct", () => {
  assert.equal(classify(C("handle", "@demo_user", "Instagram handle"), C("handle", "@demo_user", "TikTok handle")), "new");
});

test("dedupe: different facts in one category are new or ambiguous, never dup", () => {
  assert.notEqual(classify(C("school", "North High School"), C("school", "Example State University")), "dup");
  assert.equal(classify(C("pet", "Biscuit"), C("pet", "Pepper")), "new");
});

test("dedupe: phones compare by digits", () => {
  assert.equal(classify(C("phone", "(555) 010-1234"), C("phone", "+1 555 010 1234")), "dup");
});

test("merge keeps the richer value", () => {
  assert.equal(richer("Acme", "Acme Robotics Inc"), "Acme Robotics Inc");
  assert.equal(richer("GSU", "Georgia State University"), "Georgia State University");
});

test("generic interests are padding", () => {
  assert.equal(isUsefulInterest("web development", 5), false);
  assert.equal(isUsefulInterest("Plays goalie for the Riverside Otters", 4), true);
});

// ---------------------------------------------------------------- Gemini pipeline (mocked SDK, no network, no key)
import { __setGeminiClientForTests, LlmBillingError, LlmNotConfiguredError, MODELS } from "../llm/gemini.ts";
import { pinToCitation } from "./searchWorker.ts";
import { runScan } from "./orchestrator.ts";
import { ScanEvent } from "../types.ts";

test("citations: model URLs are pinned to grounding citations", () => {
  const src = [{ url: "https://devpost.com/demo-user", title: "devpost.com" }, { url: "https://example.edu/news/awards-2025", title: "example.edu" }];
  assert.equal(pinToCitation("https://devpost.com/demo-user/", src)?.url, "https://devpost.com/demo-user");
  assert.equal(pinToCitation("https://example.edu/news/awards-2025#winners", src)?.url, "https://example.edu/news/awards-2025");
  assert.equal(pinToCitation("https://www.example.edu/made-up-path", src)?.url, "https://example.edu/news/awards-2025");
  assert.equal(pinToCitation("https://invented.example.net/x", src), null);
});

test("runScan: without GEMINI_API_KEY it fails fast with a typed error and emits no findings", async () => {
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  __setGeminiClientForTests(null);
  const events = [];
  await assert.rejects(runScan({ name: "Demo User", email: "demo@example.edu" }, (e) => events.push(e), new AbortController().signal), LlmNotConfiguredError);
  assert.equal(events.filter((e) => e.type === "finding").length, 0);
  if (key) process.env.GEMINI_API_KEY = key;
});

test("runScan (mocked Gemini): grounded findings stream incrementally, deduped, pinned to citations, then score + chains", async () => {
  process.env.SCAN_SOURCES = "general";
  const calls = [];
  // Step 1 (grounded search, streamed): report text + url_citation annotations.
  async function* groundedStream(text, cites) {
    yield { event_type: "interaction.created", interaction: { id: "g", status: "in_progress" } };
    yield { event_type: "step.start", index: 0, step: { type: "google_search_call", id: "s1", arguments: { queries: ['"Demo User"'] } } };
    yield { event_type: "step.start", index: 1, step: { type: "model_output", content: [] } };
    yield { event_type: "step.delta", index: 1, delta: { type: "text", text } };
    if (cites.length) yield { event_type: "step.delta", index: 1, delta: { type: "text_annotation_delta", annotations: cites } };
    yield { event_type: "interaction.completed", interaction: { id: "g", status: "completed", usage: { total_input_tokens: 2000, total_output_tokens: 300, grounding_tool_count: [{ type: "google_search", count: 1 }] } } };
  }
  const CITES = [
    { type: "url_citation", url: "https://example.edu/news/demo", title: "example.edu", start_index: 0, end_index: 10 },
    { type: "url_citation", url: "https://demo.example.com/about", title: "demo.example.com", start_index: 11, end_index: 20 },
  ];
  // Step 2 (structured extraction): findings cite source numbers.
  const extraction = (findings) => ({ id: "x", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify({ findings, pages: [] }) }] }] });
  const F = (o) => ({ category: "pet", label: "Dog's name", value: "Biscuit", sourceType: "personal_site", source: 2, snippet: "my dog Biscuit", anchor: "email", confidence: 0.9, riskWeight: 9, ...o });
  let worker = 0;
  let extract = 0;
  __setGeminiClientForTests({
    interactions: {
      create: async (p) => {
        calls.push(p);
        if (p.model === MODELS.reasoning) {
          const ids = [...String(p.input).matchAll(/"id": "(f\d+)"/g)].map((m) => m[1]);
          return { id: "r", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify({
            score: 71, topFindingIds: [ids[0], "f999"], summary: "You are fairly exposed.", duplicateGroups: [],
            chains: [{ target: "School email account", severity: 8, steps: [
              { title: "Find the email", description: "d", findingIds: [ids[1] ?? ids[0]], enables: "reset" },
              { title: "Answer the security question", description: "d", findingIds: [ids[0], "bogus"], enables: "takeover" },
            ] }],
          }) }] }], usage: { total_input_tokens: 1500, total_output_tokens: 600, total_thought_tokens: 2000 } };
        }
        if (p.model === MODELS.lite) {
          return { id: "j", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: '{"answers":[{"index":0,"duplicateOf":""}]}' }] }] };
        }
        if (p.stream) {
          assert.deepEqual(p.tools, [{ type: "google_search" }], "search step uses Google Search grounding");
          worker++;
          if (worker === 3) return groundedStream("Nothing about the subject.", []);
          return groundedStream("Fact one. Fact two.", CITES);
        }
        assert.equal(p.tools, undefined, "extraction step has no tools");
        assert.ok(p.response_format, "extraction uses structured output");
        assert.match(String(p.input), /\[1\] https:\/\/example\.edu\/news\/demo/);
        extract++;
        if (extract === 1) return extraction([F({}), F({ category: "email", label: "School email", value: "demo@example.edu", source: 1, sourceType: "school", riskWeight: 8 })]);
        return extraction([F({ value: "Biscuit", label: "Pet" }), F({ category: "school", label: "School", value: "Example University", source: 9, anchor: "school" })]);
      },
    },
  });
  const events = [];
  const t = [];
  const final = await runScan({ name: "Demo User", email: "demo@example.edu" }, (e) => { events.push(e); t.push(Date.now()); }, new AbortController().signal);
  __setGeminiClientForTests(null);
  delete process.env.SCAN_SOURCES;

  for (const e of events) assert.ok(ScanEvent.safeParse(e).success, `contract: ${e.type}`);
  const findings = events.filter((e) => e.type === "finding").map((e) => e.finding);
  assert.equal(findings.length, 2, "exact duplicate merged before emit; uncited URL dropped");
  assert.deepEqual(findings.map((f) => f.category).sort(), ["email", "pet"]);
  assert.ok(findings.every((f) => ["https://demo.example.com/about", "https://example.edu/news/demo"].includes(f.sourceUrl)));
  const statuses = events.filter((e) => e.type === "status");
  assert.ok(statuses.some((s) => s.stage === "search" && /Google Search/.test(s.message) && s.model === MODELS.fast));
  assert.ok(statuses.some((s) => s.stage === "reasoning" && s.model === MODELS.reasoning));
  const started = events.filter((e) => e.type === "source_started" && e.agentId === "general");
  assert.equal(started.length, 1);
  const iFirstFinding = events.findIndex((e) => e.type === "finding");
  const iScore = events.findIndex((e) => e.type === "score");
  assert.ok(iFirstFinding < iScore, "findings are emitted before scoring");
  const score = events[iScore].score;
  assert.equal(score.score, 71);
  assert.ok(score.topFindingIds.every((id) => findings.some((f) => f.id === id)), "only real ids");
  const chains = events.filter((e) => e.type === "chain").map((e) => e.chain);
  assert.equal(chains.length, 1);
  for (const s of chains[0].steps) for (const id of s.findingIds) assert.ok(findings.some((f) => f.id === id));
  assert.equal(final.length, 2);
  const reasoningCall = calls.find((p) => p.model === MODELS.reasoning);
  assert.equal(reasoningCall.generation_config.thinking_level, "low");
  assert.equal(extract, 2, "no extraction call when the grounded report found nothing");
});

test("runScan: a 402 billing error from Gemini ends the scan with a typed error", async () => {
  process.env.SCAN_SOURCES = "general";
  __setGeminiClientForTests({ interactions: { create: async () => { throw Object.assign(new Error("402 API error occurred"), { status: 402 }); } } });
  const events = [];
  await assert.rejects(runScan({ name: "Demo User", email: "demo@example.edu" }, (e) => events.push(e), new AbortController().signal), LlmBillingError);
  __setGeminiClientForTests(null);
  delete process.env.SCAN_SOURCES;
  assert.equal(events.filter((e) => e.type === "score").length, 0);
});
