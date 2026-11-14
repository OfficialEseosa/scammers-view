import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKS_PER_HOUR, __resetCheckLimitsForTests, clientIp, takeCheck } from "./limits";
import { MAX_SHOT_BYTES, readShareForm } from "./share";
import { parseSharedHash, sharedHash } from "./shared";

test("takeCheck: allows up to the hourly cap per IP, then refuses, then recovers after an hour", () => {
  __resetCheckLimitsForTests();
  const t0 = 1_000_000;
  for (let i = 0; i < CHECKS_PER_HOUR.text; i++) assert.equal(takeCheck("text", "1.2.3.4", t0 + i), true);
  assert.equal(takeCheck("text", "1.2.3.4", t0 + 100), false);
  assert.equal(takeCheck("text", "5.6.7.8", t0 + 100), true, "other IPs are unaffected");
  assert.equal(takeCheck("image", "1.2.3.4", t0 + 100), true, "kinds are counted separately");
  assert.equal(takeCheck("text", "1.2.3.4", t0 + 60 * 60 * 1000 + 100), true);
});

test("clientIp: first forwarded hop, then x-real-ip, then a shared bucket", () => {
  assert.equal(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } })), "9.9.9.9");
  assert.equal(clientIp(new Request("http://x", { headers: { "x-real-ip": "8.8.8.8" } })), "8.8.8.8");
  assert.equal(clientIp(new Request("http://x")), "unknown");
});

test("readShareForm: joins title, text and url once each, and caps the length", () => {
  const f = new FormData();
  f.set("title", "Your package");
  f.set("text", "Your package is held. Pay the fee: https://bad.example/pay");
  f.set("url", "https://bad.example/pay");
  assert.equal(readShareForm(f).text, "Your package\nYour package is held. Pay the fee: https://bad.example/pay");

  const long = new FormData();
  long.set("text", "a".repeat(5000));
  assert.equal(readShareForm(long).text.length, 4000);
});

test("readShareForm: keeps an image screenshot within the size cap, drops anything else", () => {
  const ok = new FormData();
  ok.set("shot", new File([new Uint8Array(10)], "s.png", { type: "image/png" }));
  assert.ok(readShareForm(ok).shot);

  const notImage = new FormData();
  notImage.set("shot", new File([new Uint8Array(10)], "s.pdf", { type: "application/pdf" }));
  assert.equal(readShareForm(notImage).shot, undefined);

  const huge = new FormData();
  huge.set("shot", new File([new Uint8Array(MAX_SHOT_BYTES + 1)], "s.png", { type: "image/png" }));
  assert.equal(readShareForm(huge).shot, undefined);
});

test("sharedHash / parseSharedHash round-trip, ignore unknown notes", () => {
  const msg = "Hi it's the bank & we need your code #1 now?";
  assert.deepEqual(parseSharedHash(sharedHash({ text: msg })), { text: msg, note: undefined });
  assert.deepEqual(parseSharedHash(sharedHash({ note: "limit" })), { text: undefined, note: "limit" });
  assert.equal(parseSharedHash("#note=evil"), null);
  assert.equal(parseSharedHash(""), null);
  assert.equal(sharedHash({ text: "   " }), "");
});
