import test from "node:test";
import assert from "node:assert/strict";
import { matchPatterns } from "./match";
import { signCode, verifyCode, bandOf, normalizeCode } from "./code";
import { PATTERNS } from "./patterns";
import type { Finding } from "../types";

const base = { sourceType: "web" as const, sourceUrl: "https://x.example", anchor: "email" as const, confidence: 0.9, foundAt: "2026-01-01T00:00:00Z" };
const f = (id: string, category: Finding["category"], value: string, extra: Partial<Finding> = {}): Finding => ({
  ...base, id, category, label: category, value, riskWeight: 6, ...extra,
});

test("no findings gives no matches", () => {
  assert.deepEqual(matchPatterns([]), []);
});

test("job-hunting post plus school email ranks the job scams on top", () => {
  const r = matchPatterns([
    f("e", "email", "alex@northgate.example.edu"),
    f("s", "school", "Northgate College"),
    f("p", "interest", "Looking for a part-time job this semester", { sourceType: "x" }),
  ]);
  const top = r.slice(0, 3).map((m) => m.pattern.id);
  assert.ok(top.includes("fake-job-check"), top.join());
  assert.equal(r[0].pattern.id, "fake-job-check");
  assert.ok(r[0].matchedFindingIds.includes("p"));
  assert.ok(r[0].fitScore > 0 && r[0].fitScore <= 100);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].fitScore >= r[i].fitScore);
});

test("relatives plus a public video lift the voice-clone scam; unrelated ones are absent", () => {
  const r = matchPatterns([f("r", "relative", "Maria Rivera (mother)"), f("v", "photo", "Public video", { sourceType: "tiktok" })]);
  assert.equal(r[0].pattern.id, "family-voice-clone");
  assert.ok(!r.some((m) => m.pattern.id === "immigration-threat"));
});

test("international-student signal fires the immigration scam", () => {
  const r = matchPatterns([f("i", "other", "International student on an F-1 visa")]);
  assert.equal(r[0].pattern.id, "immigration-threat");
});

test("stronger, more confident facts give a higher fit", () => {
  const weak = matchPatterns([f("s", "school", "Northgate", { riskWeight: 1, confidence: 0.3 })]);
  const strong = matchPatterns([f("s", "school", "Northgate", { riskWeight: 9, confidence: 1 })]);
  const id = "fake-job-check";
  assert.ok(strong.find((m) => m.pattern.id === id)!.fitScore > weak.find((m) => m.pattern.id === id)!.fitScore);
});

test("bands", () => {
  assert.deepEqual([0, 39, 40, 69, 70, 100].map(bandOf), [0, 0, 1, 1, 2, 2]);
});

test("room codes round-trip for every pattern and band", () => {
  for (const p of PATTERNS) {
    for (const [score, band] of [[10, 0], [55, 1], [95, 2]] as const) {
      const code = signCode("secret", score, p.id)!;
      assert.match(code, /^[0-9A-Z]{6}$/);
      assert.deepEqual(verifyCode("secret", code), { band, patternId: p.id });
    }
  }
});

test("codes are case and look-alike tolerant", () => {
  const code = signCode("secret", 80, "rental-deposit", 7)!;
  assert.equal(verifyCode("secret", code.toLowerCase())?.patternId, "rental-deposit");
  assert.equal(normalizeCode(" o1-il "), "0111");
});

test("wrong secret, edited or random codes are rejected", () => {
  const code = signCode("secret", 80, "rental-deposit", 7)!;
  assert.equal(verifyCode("other", code), null);
  const flipped = (code[0] === "0" ? "1" : "0") + code.slice(1);
  assert.equal(verifyCode("secret", flipped), null);
  assert.equal(verifyCode("secret", "ABC"), null);
  assert.equal(verifyCode("secret", "!!!!!!"), null);
  let accepted = 0;
  for (let i = 0; i < 2000; i++) {
    const rnd = Array.from({ length: 6 }, () => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Math.floor(Math.random() * 32)]).join("");
    if (verifyCode("secret", rnd)) accepted++;
  }
  assert.ok(accepted < 5, `accepted ${accepted} random codes`);
});

test("two students with the same result get different codes (nonce)", () => {
  const set = new Set(Array.from({ length: 30 }, () => signCode("secret", 80, "rental-deposit")));
  assert.ok(set.size > 20);
});
