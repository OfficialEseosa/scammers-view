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
