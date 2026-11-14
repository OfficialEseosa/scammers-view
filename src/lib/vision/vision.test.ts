// Run: npx tsx --test src/lib/vision/vision.test.ts
// Gemini is mocked (no network, no key). All fixtures are fictional.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { __setGeminiClientForTests, toGeminiSchema } from "@/lib/llm/gemini";
import { Finding } from "@/lib/types";
import { cleanPhotoReadout, keepFact, validBox } from "./clean";
import { parseImageTarget, parseVideoTarget, sniffImage, VisionFetchError } from "./fetch";
import { __resetQuotaForTests, takeQuota, VIDEO_MAX_BYTES } from "./limits";
import { analysePhoto } from "./photo";
import { IDENTITY_GUARD, PHOTO_SYSTEM, VIDEO_SYSTEM } from "./prompts";
import { PhotoReadout, VideoReadout } from "./schema";
import { analyseVideo } from "./video";

const JPEG = Buffer.from("ffd8ffe000104a4649460001010000010001", "hex");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(32)]);

const photoOut = {
  facts: [
    { kind: "school", label: "School logo on hoodie", value: "Northfield High", evidence: "Crest and name printed on the hoodie.", fromVisibleText: true, risk: 8, confidence: 0.9, box: [400, 300, 700, 650] },
    { kind: "pet", label: "Dog name tag", value: "Biscuit", evidence: "Tag on the collar reads BISCUIT.", fromVisibleText: true, risk: 7, confidence: 0.8, box: [] },
    // Must be dropped: a name not read from text (would be recognition).
    { kind: "name", label: "Friend", value: "Jordan Lee", evidence: "The person on the left looks like Jordan Lee.", fromVisibleText: false, risk: 5, confidence: 0.4, box: [0, 0, 100, 100] },
  ],
  otherPeople: { count: 2, relationshipGuess: "teammates" },
  scammerLearns: "Your school and your dog's name.",
};

const videoOut = {
  hasSpeech: true,
  facts: [
    { kind: "routine", label: "Gym schedule", value: "Tuesdays 7am at Riverside Gym", evidence: "Says it while filming.", fromVisibleText: true, risk: 7, confidence: 0.8, channel: "speech", at: "00:12" },
    { kind: "place", label: "Street sign", value: "Elm Street", evidence: "Sign behind the speaker.", fromVisibleText: true, risk: 6, confidence: 0.7, channel: "scene", at: "bad" },
  ],
  scammerLearns: "Where you are every Tuesday morning.",
};

function mockClient(opts: { output: unknown; failCreate?: boolean; states?: string[] }) {
  const calls = { create: [] as unknown[], upload: 0, deleted: [] as string[], get: 0 };
  const states = [...(opts.states ?? ["ACTIVE"])];
  const client = {
    interactions: {
      create: async (p: unknown) => {
        calls.create.push(p);
        if (opts.failCreate) throw new Error("boom");
        return { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(opts.output) }] }], usage: { total_input_tokens: 1200, total_output_tokens: 300, total_thought_tokens: 100 } };
      },
    },
    files: {
      upload: async () => {
        calls.upload++;
        return { name: "files/abc123", state: "PROCESSING" };
      },
      get: async () => {
        calls.get++;
        return { name: "files/abc123", state: states.shift() ?? "ACTIVE", uri: "https://generativelanguage.example/files/abc123" };
      },
      delete: async ({ name }: { name: string }) => {
        calls.deleted.push(name);
        return {};
      },
    },
  };
  __setGeminiClientForTests(client);
  return calls;
}

afterEach(() => __setGeminiClientForTests(null));

test("prompts carry the face-identification guard", () => {
  for (const sys of [PHOTO_SYSTEM, VIDEO_SYSTEM]) {
    assert.ok(sys.includes(IDENTITY_GUARD));
    assert.match(sys, /Never identify any person from their face/);
    assert.match(sys, /Never name a person unless the name is printed or written/);
    assert.match(sys, /only as a count and a relationship guess/);
  }
});

test("model schemas convert to JSON Schema without unsupported keywords", () => {
  for (const s of [PhotoReadout, VideoReadout]) {
    const js = JSON.stringify(toGeminiSchema(s));
    assert.ok(!js.includes("anyOf") && !js.includes("$ref") && !js.includes("pattern"), js);
  }
});

test("schema validation rejects malformed readouts", () => {
  assert.equal(PhotoReadout.safeParse({ facts: [], scammerLearns: "x" }).success, false);
  assert.equal(PhotoReadout.safeParse({ ...photoOut, facts: [{ ...photoOut.facts[0], kind: "face" }] }).success, false);
  assert.equal(VideoReadout.safeParse(videoOut).success, true);
});

test("output guard drops names not read from text and recognition phrasing", () => {
  assert.equal(keepFact({ kind: "name", fromVisibleText: false, evidence: "x", value: "Sam", label: "Name" }), false);
  assert.equal(keepFact({ kind: "name", fromVisibleText: true, evidence: "Badge reads SAM", value: "Sam", label: "Name" }), true);
  assert.equal(keepFact({ kind: "other", fromVisibleText: false, evidence: "He resembles a celebrity", value: "x", label: "y" }), false);
  const r = cleanPhotoReadout(PhotoReadout.parse({ ...photoOut, otherPeople: { count: 1, relationshipGuess: "Jordan Lee" } }));
  assert.equal(r.facts.length, 2);
  assert.equal(r.otherPeople.relationshipGuess, null);
});

test("boxes: only ordered, in-range, sensible regions survive", () => {
  assert.deepEqual(validBox([400, 300, 700, 650]), [400, 300, 700, 650]);
  assert.equal(validBox([700, 300, 400, 650]), null);
  assert.equal(validBox([0, 0, 1000, 1000]), null);
  assert.equal(validBox([1, 2, 3]), null);
  assert.equal(validBox([]), null);
});

test("SSRF: image targets", () => {
  const bad = ["http://example.com/a.jpg", "https://127.0.0.1/a.jpg", "https://[::1]/a.jpg", "https://10.1.2.3/x", "https://169.254.169.254/latest", "https://example.com:8443/a.jpg", "https://u:p@example.com/a.jpg", "https://printer.local/a.jpg", "https://svc.internal/a", "file:///etc/passwd", "not a url"];
  for (const u of bad) assert.throws(() => parseImageTarget(u), VisionFetchError, u);
  assert.equal(parseImageTarget("https://images.example.org/p/1.jpg").hostname, "images.example.org");
});

test("SSRF: video targets need an allowlisted media CDN", () => {
  assert.throws(() => parseVideoTarget("https://example.com/v.mp4"), VisionFetchError);
  assert.throws(() => parseVideoTarget("https://www.tiktok.com/@a/video/1"), VisionFetchError);
  assert.equal(parseVideoTarget("https://v16-webapp-prime.tiktok.com/video/x.mp4").protocol, "https:");
});

test("image sniffing", () => {
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(Buffer.from("<html><body>hello</body></html>")), null);
});

test("photo: mocked Gemini -> findings anchored to face, no identification, cost reported", async () => {
  const calls = mockClient({ output: photoOut });
  const res = await analysePhoto(
    { findingId: "f1", imageUrl: "https://images.example.org/p/1.jpg", sourceUrl: "https://www.instagram.com/p/xyz/" },
    new AbortController().signal,
    { fetchImage: async () => ({ mimeType: "image/jpeg", bytes: JPEG }), now: () => "2026-01-01T00:00:00.000Z" },
  );
  assert.equal(calls.create.length, 1);
  const sent = JSON.stringify(calls.create[0]);
  assert.match(sent, /Never identify any person from their face/);
  assert.match(sent, /"type":"image"/);
  assert.equal(res.findings.length, 3); // school, pet, people count (the guessed name is dropped)
  for (const f of res.findings) {
    assert.ok(Finding.safeParse(f).success);
    assert.equal(f.anchor, "face");
    assert.equal(f.sourceUrl, "https://www.instagram.com/p/xyz/");
    assert.equal(f.sourceType, "instagram");
    assert.ok(!f.imageUrl, "derived findings must not re-enter face matching");
    assert.ok(!/Jordan/.test(JSON.stringify(f)));
  }
  assert.equal(res.findings.find((f) => f.label === "People with you")?.value, "2 other people (teammates)");
  assert.ok((res.usage?.costUsd ?? 0) > 0);
});

test("video: upload, poll, analyse, delete on success", async () => {
  const calls = mockClient({ output: videoOut, states: ["PROCESSING", "ACTIVE"] });
  const res = await analyseVideo(
    { findingId: "v1", mediaUrl: "https://v16-webapp-prime.tiktok.com/v.mp4", sourceUrl: "https://www.tiktok.com/@demo/video/1", durationSec: 45, anchor: "email" },
    new AbortController().signal,
    { fetchVideo: async () => ({ mimeType: "video/mp4", bytes: MP4 }), sleep: async () => {} },
  );
  assert.ok("readout" in res);
  assert.equal(calls.upload, 1);
  assert.equal(calls.get, 2);
  assert.deepEqual(calls.deleted, ["files/abc123"]);
  const sent = calls.create[0] as { input: Array<{ type: string; content: Array<Record<string, unknown>> }>; system_instruction: string };
  assert.equal(sent.input[0].type, "user_input");
  const media = sent.input[0].content.find((p) => p.type === "video")!;
  assert.equal(media.uri, "https://generativelanguage.example/files/abc123");
  assert.deepEqual(media.processing, { type: "static", end_offset: "120s" });
  assert.match(sent.system_instruction, /Never identify any person/);
  if ("readout" in res) {
    assert.equal(res.readout.facts[1].at, null); // bad timestamp cleaned
    assert.equal(res.findings[0].anchor, "email");
    assert.match(res.findings[0].snippet ?? "", /^Said at 00:12/);
  }
});

test("video: file deleted when the model call fails", async () => {
  const calls = mockClient({ output: videoOut, failCreate: true });
  await assert.rejects(
    analyseVideo({ findingId: "v2", mediaUrl: "https://v16-webapp-prime.tiktok.com/v.mp4" }, new AbortController().signal, {
      fetchVideo: async () => ({ mimeType: "video/mp4", bytes: MP4 }),
      sleep: async () => {},
    }),
  );
  assert.deepEqual(calls.deleted, ["files/abc123"]);
});

test("video: file deleted when processing FAILS", async () => {
  const calls = mockClient({ output: videoOut, states: ["FAILED"] });
  await assert.rejects(
    analyseVideo({ findingId: "v3", mediaUrl: "https://v16-webapp-prime.tiktok.com/v.mp4" }, new AbortController().signal, {
      fetchVideo: async () => ({ mimeType: "video/mp4", bytes: MP4 }),
      sleep: async () => {},
    }),
  );
  assert.equal(calls.create.length, 0);
  assert.deepEqual(calls.deleted, ["files/abc123"]);
});

test("video: over limits skips without uploading", async () => {
  const calls = mockClient({ output: videoOut });
  const long = await analyseVideo({ findingId: "v4", mediaUrl: "https://v16-webapp-prime.tiktok.com/v.mp4", durationSec: 3600 }, new AbortController().signal);
  assert.ok("skipped" in long);
  const big = await analyseVideo({ findingId: "v5", mediaUrl: "https://v16-webapp-prime.tiktok.com/v.mp4" }, new AbortController().signal, {
    fetchVideo: async (_u, max) => {
      assert.equal(max, VIDEO_MAX_BYTES);
      throw new VisionFetchError(413, "Too large");
    },
  });
  assert.ok("skipped" in big);
  assert.equal(calls.upload, 0);
});

test("audio-only track is sent as audio without clipping", async () => {
  const calls = mockClient({ output: { ...videoOut, facts: [videoOut.facts[0]] } });
  await analyseVideo({ findingId: "v6", mediaUrl: "https://v16-webapp-prime.tiktok.com/a.mp3" }, new AbortController().signal, {
    fetchVideo: async () => ({ mimeType: "audio/mp3", bytes: Buffer.from("ID3abcdefghijkl") }),
    sleep: async () => {},
  });
  const media = (calls.create[0] as { input: Array<{ content: Array<Record<string, unknown>> }> }).input[0].content.find((p) => p.type === "audio");
  assert.ok(media && !("processing" in media));
  assert.deepEqual(calls.deleted, ["files/abc123"]);
});

test("hourly quota per person", () => {
  __resetQuotaForTests();
  const t = 1_000_000;
  for (let i = 0; i < 8; i++) assert.equal(takeQuota("video", "a@example.com", t), true);
  assert.equal(takeQuota("video", "A@example.com", t), false);
  assert.equal(takeQuota("video", "b@example.com", t), true);
  assert.equal(takeQuota("video", "a@example.com", t + 61 * 60 * 1000), true);
});
