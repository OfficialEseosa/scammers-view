// Run: npx tsx --test src/lib/voice-exposure/voice-exposure.test.ts
// All fixtures are synthetic (no real people).
import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibleHandles } from "../scan/social";
import { instagramVideos, MAX_VIDEOS, tiktokVideos, videoRisk } from "../scan/videos";
import { exactKey, classify } from "../scan/dedupe";
import { Finding } from "../types";
import { isAllowedMediaHost } from "./hosts";
import { classifySound } from "./sound";
import { isBlockedAddress, MediaProxyError, parseMediaTarget, sniffMedia } from "./ssrf";
import { calibrate, cosine, MATCH_THRESHOLD, meanEmbedding, MIN_MATCHED_SEC, planWindows, speechSegments, verdictFor } from "./verify";
import { clearVoiceData, getVoiceEmbedding, getVoiceSample, hasVoiceReference, setVoiceEmbedding, setVoiceSample } from "./store";

const me = { handle: "demo.user", displayName: "Demo User" };

/* ------------------------------ sound metadata ------------------------------ */

test("sound: own original sound is a candidate (true)", () => {
  assert.equal(classifySound({ title: "original sound", author: "Demo User", original: true }, me).soundOriginal, true);
  assert.equal(classifySound({ title: "original sound - demo.user", author: "demo.user", original: false }, me).soundOriginal, true);
  assert.equal(classifySound({ title: "Original audio", author: "demo.user", original: true }, me).soundOriginal, true);
});

test("sound: another creator's original sound is borrowed (lip-sync)", () => {
  const v = classifySound({ title: "original sound", author: "someone.else", original: true }, me);
  assert.equal(v.soundOriginal, false);
  assert.match(v.soundTitle, /someone\.else/);
});

test("sound: a named track is borrowed", () => {
  assert.equal(classifySound({ title: "Example Song", author: "Example Band", original: false }, me).soundOriginal, false);
  assert.equal(classifySound({ title: "Example Song", author: "Example Band" }, me).soundOriginal, false);
});

test("sound: muted audio is borrowed, missing metadata is unknown", () => {
  assert.equal(classifySound({ title: "x", author: "demo.user", original: true, muted: true }, me).soundOriginal, false);
  assert.equal(classifySound(null, me).soundOriginal, undefined);
  assert.equal(classifySound({ title: "original sound", author: "" }, me).soundOriginal, undefined);
});

/* ------------------------------ actor output -> videos ------------------------------ */

const tt = (o: Record<string, unknown> = {}) => ({
  webVideoUrl: "https://www.tiktok.com/@demo.user/video/1",
  text: "story time",
  authorMeta: { name: "demo.user", nickName: "Demo User" },
  videoMeta: { duration: 21, coverUrl: "https://p16-sign.tiktokcdn.com/c.jpg", downloadAddr: "https://v16-webapp-prime.tiktok.com/v.mp4" },
  musicMeta: { musicName: "original sound", musicAuthor: "Demo User", musicOriginal: true, playUrl: "https://v16-webapp-prime.tiktok.com/a.mp3" },
  ...o,
});

test("tiktok videos: own sound uses the audio-only sound file; others' videos are dropped", () => {
  const v = tiktokVideos("demo.user", [tt(), tt({ authorMeta: { name: "other" } }), tt({ musicMeta: { musicName: "Song", musicAuthor: "Band", musicOriginal: false, playUrl: "https://v16-webapp-prime.tiktok.com/s.mp3" } })]);
  assert.equal(v.length, 2);
  assert.equal(v[0].mediaUrl, "https://v16-webapp-prime.tiktok.com/a.mp3");
  assert.equal(v[0].soundOriginal, true);
  assert.equal(v[0].durationSec, 21);
  assert.equal(v[1].soundOriginal, false);
  assert.equal(v[1].mediaUrl, "https://v16-webapp-prime.tiktok.com/v.mp4");
});

test("videos are capped per platform", () => {
  const items = Array.from({ length: 30 }, (_, i) => tt({ webVideoUrl: `https://www.tiktok.com/@demo.user/video/${i}` }));
  assert.equal(tiktokVideos("demo.user", items).length, MAX_VIDEOS);
});

test("instagram reels: only the account's own videos, musicInfo classified", () => {
  const v = instagramVideos("demo.user", [
    { type: "Video", url: "https://www.instagram.com/p/A/", ownerUsername: "demo.user", videoUrl: "https://scontent-lax3-1.cdninstagram.com/v.mp4", videoDuration: 12.3, musicInfo: { artist_name: "demo.user", song_name: "Original audio", uses_original_audio: true } },
    { type: "Video", url: "https://www.instagram.com/p/B/", ownerUsername: "collab.partner", videoUrl: "https://scontent.cdninstagram.com/v.mp4" },
    { type: "Image", url: "https://www.instagram.com/p/C/", ownerUsername: "demo.user" },
    { type: "Video", url: "https://www.instagram.com/p/D/", ownerUsername: "demo.user", videoUrl: "https://scontent.cdninstagram.com/d.mp4", musicInfo: { artist_name: "Band", song_name: "Song", uses_original_audio: false } },
  ]);
  assert.deepEqual(v.map((x) => [x.postUrl.slice(-3), x.soundOriginal]), [["/A/", true], ["/D/", false]]);
  assert.equal(videoRisk(v[0]), 4);
  assert.equal(videoRisk(v[1]), 1);
});

/* ------------------------------ handle gate still holds ------------------------------ */

const F = (o: Partial<Finding>): Finding => ({
  id: "f1", category: "handle", label: "TikTok handle", value: "@demo.user", sourceType: "web",
  sourceUrl: "https://example.com", anchor: "github", confidence: 0.8, riskWeight: 5, foundAt: "", ...o,
});

test("gate: videos are only read for anchored, confident handles", () => {
  assert.equal(eligibleHandles([F({})]).tiktok?.handle, "demo.user");
  assert.deepEqual(eligibleHandles([F({ anchor: "unconfirmed", confidence: 0.99 })]), {});
  assert.deepEqual(eligibleHandles([F({ confidence: 0.69 })]), {});
  assert.deepEqual(eligibleHandles([F({ category: "relative", value: "https://www.tiktok.com/@someone" })]), {});
  // A video finding itself never makes a new handle eligible.
  assert.deepEqual(eligibleHandles([F({ category: "video", label: "Public tiktok video", value: "Video: hi", anchor: "unconfirmed" })]), {});
});

test("dedupe: one finding per video post, never merged by caption", () => {
  const a = { category: "video", label: "v", value: "Video: hello", sourceType: "tiktok", sourceUrl: "https://www.tiktok.com/@d/video/1" };
  const b = { ...a, sourceUrl: "https://www.tiktok.com/@d/video/2" };
  assert.notEqual(exactKey(a), exactKey(b));
  assert.equal(classify(a, b), "new");
});

test("contract: video fields are optional and additive", () => {
  const base = F({});
  assert.ok(Finding.safeParse(base).success);
  const v = Finding.safeParse({ ...base, category: "video", mediaUrl: "https://x.tiktokcdn.com/a.mp3", durationSec: 3, soundOriginal: false, soundTitle: "s" });
  assert.ok(v.success);
  assert.equal(v.data?.soundOriginal, false);
});

/* ------------------------------ verification maths ------------------------------ */

function unit(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    v[i] = s / 2147483648 - 0.5;
  }
  return v;
}
function blend(a: Float32Array, b: Float32Array, wa: number) {
  return a.map((x, i) => wa * x + (1 - wa) * b[i]);
}

test("cosine: identical 1, orthogonal 0, opposite -1, scale-invariant", () => {
  const a = Float32Array.from([1, 0, 0]);
  assert.equal(cosine(a, a), 1);
  assert.equal(cosine(a, Float32Array.from([0, 2, 0])), 0);
  assert.equal(cosine(a, Float32Array.from([-3, 0, 0])), -1);
  assert.equal(cosine(a, new Float32Array(2)), 0);
});

test("threshold separates same-voice from other-voice synthetic embeddings", () => {
  const me_ = unit(256, 1);
  const other = unit(256, 99);
  const ref = meanEmbedding([blend(me_, unit(256, 2), 0.85), blend(me_, unit(256, 3), 0.85)])!;
  const mine = blend(me_, unit(256, 7), 0.8);
  const theirs = blend(other, unit(256, 8), 0.8);
  assert.ok(cosine(mine, ref) >= MATCH_THRESHOLD);
  assert.ok(cosine(theirs, ref) < MATCH_THRESHOLD);
});

test("verdict: only windows above the threshold count (several speakers)", () => {
  const w = (start: number, end: number, similarity: number) => ({ start, end, similarity });
  const v = verdictFor(12, [w(0, 3, 0.8), w(3, 6, 0.1), w(6, 9, 0.75), w(9, 12, 0.2)]);
  assert.equal(v.kind, "yours");
  assert.equal(v.matchedSeconds, 6);
  assert.equal(v.speechSeconds, 12);
});

test("verdict: other voice, short match, and no speech", () => {
  assert.equal(verdictFor(9, [{ start: 0, end: 3, similarity: 0.3 }]).kind, "someone_else");
  assert.equal(verdictFor(9, [{ start: 0, end: MIN_MATCHED_SEC - 0.5, similarity: 0.9 }]).matched, false);
  const ns = verdictFor(0.9, []);
  assert.equal(ns.kind, "no_speech");
  assert.equal(ns.matchedSeconds, 0);
});

test("VAD segmentation: hysteresis, minimum speech, music-like noise rejected", () => {
  const f = 0.032;
  const probs = [...Array(10).fill(0.05), ...Array(50).fill(0.9), ...Array(10).fill(0.05), ...Array(3).fill(0.9), ...Array(10).fill(0.05)];
  const segs = speechSegments(probs, f);
  assert.equal(segs.length, 1); // the 3-frame blip (96 ms) is below the 250 ms minimum
  assert.ok(Math.abs(segs[0].end - segs[0].start - 1.66) < 0.1);
  assert.deepEqual(speechSegments(Array(500).fill(0.3), f), []);
});

test("windows: 3 s chunks, remainders joined or kept, tiny regions skipped", () => {
  assert.deepEqual(planWindows([{ start: 0, end: 7 }]).map((w) => [w.start, w.end]), [[0, 3], [3, 7]]);
  assert.deepEqual(planWindows([{ start: 0, end: 8 }]).map((w) => [w.start, w.end]), [[0, 3], [3, 6], [6, 8]]);
  assert.deepEqual(planWindows([{ start: 0, end: 1 }]), []);
  assert.deepEqual(planWindows([{ start: 0, end: 1 }, { start: 1.2, end: 2.4 }]).map((w) => [w.start, w.end]), [[0, 2.4]]);
});

test("calibrate: midpoint when separated, equal-error point when overlapping", () => {
  assert.deepEqual(calibrate([0.7, 0.8], [0.2, 0.3]), { threshold: 0.5, frr: 0, far: 0, separated: true });
  const c = calibrate([0.4, 0.6, 0.8], [0.2, 0.5, 0.3]);
  assert.equal(c.separated, false);
});

/* ------------------------------ in-memory reference ------------------------------ */

test("store: embedding replaces sample; clearVoiceData wipes and zeroes", () => {
  setVoiceSample(new Blob(["x"]));
  assert.ok(getVoiceSample());
  const e = Float32Array.from([0.5, 0.5]);
  setVoiceEmbedding(e);
  assert.equal(getVoiceSample(), null);
  assert.ok(hasVoiceReference());
  clearVoiceData();
  assert.equal(hasVoiceReference(), false);
  assert.equal(getVoiceEmbedding(), null);
  assert.deepEqual([...e], [0, 0]);
});

/* ------------------------------ proxy allowlist + SSRF ------------------------------ */

test("allowlist: platform media CDNs only", () => {
  for (const h of ["v16-webapp-prime.tiktok.com", "v19-webapp.tiktok.com", "p16-sign-useast2a.tiktokcdn.com", "sf16-ies-music.tiktokcdn-us.com", "scontent-lax3-1.cdninstagram.com", "scontent.xx.fbcdn.net"])
    assert.ok(isAllowedMediaHost(h), h);
  for (const h of ["www.tiktok.com", "tiktok.com", "www.instagram.com", "evil.com", "cdninstagram.com.evil.com", "tiktokcdn.com", "x-tiktokcdn.com", "v16.tiktok.com.evil.net", "localhost"])
    assert.equal(isAllowedMediaHost(h), false, h);
});

const rejects = (u: string | null, status: number) => {
  assert.throws(() => parseMediaTarget(u), (e: unknown) => e instanceof MediaProxyError && e.status === status, String(u));
};

test("proxy target: https, port, credentials, IPs, local names, allowlist", () => {
  assert.equal(parseMediaTarget("https://v16-webapp-prime.tiktok.com/a.mp3?x=1").hostname, "v16-webapp-prime.tiktok.com");
  rejects(null, 400);
  rejects("http://v16-webapp-prime.tiktok.com/a.mp3", 400);
  rejects("https://v16-webapp-prime.tiktok.com:8443/a.mp3", 400);
  rejects("https://u:p@scontent.cdninstagram.com/a.mp4", 400);
  rejects("https://127.0.0.1/a.mp3", 403);
  rejects("https://[::1]/a.mp3", 403);
  rejects("https://169.254.169.254/latest/meta-data", 403);
  rejects("https://metadata.internal/a", 403);
  rejects("https://example.com/a.mp3", 403);
  rejects("https://www.tiktok.com/@x", 403);
});

test("SSRF: private, loopback, link-local, CGNAT and mapped addresses are blocked", () => {
  for (const a of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.1.1", "172.16.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "0.0.0.0", "not-an-ip"])
    assert.equal(isBlockedAddress(a), true, a);
  for (const a of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34"]) assert.equal(isBlockedAddress(a), false, a);
});

test("sniff: media magic bytes accepted, HTML rejected", () => {
  const pad = (s: number[]) => Uint8Array.from([...s, ...Array(16).fill(0)]);
  assert.equal(sniffMedia(pad([0, 0, 0, 0x18, ...Buffer.from("ftypisom")])), "video/mp4");
  assert.equal(sniffMedia(pad([0, 0, 0, 0x18, ...Buffer.from("ftypM4A ")])), "audio/mp4");
  assert.equal(sniffMedia(pad([...Buffer.from("ID3")])), "audio/mpeg");
  assert.equal(sniffMedia(pad([0x1a, 0x45, 0xdf, 0xa3])), "video/webm");
  assert.equal(sniffMedia(pad([...Buffer.from("OggS")])), "audio/ogg");
  assert.equal(sniffMedia(pad([...Buffer.from("<!doctype html>")])), null);
});
