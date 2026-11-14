// Run: npx tsx --test src/lib/watch/watch.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { diffSnapshots, toSnapshot } from "./diff";
import { hashFinding, hashFindings, newSalt, normaliseValue } from "./fingerprint";
import { WATCH_SCAN_A, WATCH_SCAN_B } from "./fixture";
import { buildReminderIcs, escapeIcsText, foldLine } from "./ics";
import { MAX_HISTORY, WATCH_KEY, appendSnapshot, clearWatch, freshStore, loadWatch, saveWatch, sparklinePath, type KV } from "./store";

const SALT = "00112233445566778899aabbccddeeff";

function memory(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test("normalisation ignores case, spacing, punctuation, phone format and @", () => {
  assert.equal(normaliseValue("pet", "  Biscuit. "), normaliseValue("pet", "biscuit"));
  assert.equal(normaliseValue("phone", "(555) 010-4417"), "5550104417");
  assert.equal(normaliseValue("phone", "+1 555 010 4417"), "5550104417");
  assert.equal(normaliseValue("handle", "@AlexR_Designs"), "alexr_designs");
  assert.equal(normaliseValue("location", "412  Elm   Street"), "412 elm street");
});

test("hashes are salted, stable and hide the value", async () => {
  const a = await hashFinding(SALT, "pet", "Biscuit");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, await hashFinding(SALT, "pet", "  biscuit "));
  assert.notEqual(a, await hashFinding("ffeeddccbbaa99887766554433221100", "pet", "Biscuit"));
  assert.notEqual(a, await hashFinding(SALT, "handle", "Biscuit"));
  assert.ok(!a.includes("biscuit"));
});

test("salt is 32 hex chars and differs per call", () => {
  assert.match(newSalt(), /^[0-9a-f]{32}$/);
  assert.notEqual(newSalt(), newSalt());
});

test("same fact from two sources counts once", async () => {
  const dup = { ...WATCH_SCAN_A.findings[0], id: "dup", sourceType: "web" as const };
  const hashed = await hashFindings(SALT, [...WATCH_SCAN_A.findings, dup]);
  assert.equal(hashed.length, WATCH_SCAN_A.findings.length);
});

test("two fictional scans: new facts in full, gone facts by category, score delta", async () => {
  const snapA = toSnapshot(await hashFindings(SALT, WATCH_SCAN_A.findings), WATCH_SCAN_A.score, new Date("2026-11-07T12:00:00Z"));
  const hashedB = await hashFindings(SALT, WATCH_SCAN_B.findings);
  const diff = diffSnapshots(snapA, hashedB, WATCH_SCAN_B.score);

  assert.deepEqual(diff.added.map((f) => f.label).sort(), ["Employer", "TikTok handle"]);
  assert.equal(diff.removedCount, 2);
  assert.deepEqual(diff.removed, [
    { category: "location", count: 1 },
    { category: "phone", count: 1 },
  ]);
  assert.equal(diff.unchangedCount, 5);
  assert.equal(diff.scoreDelta, -17);
  // Gone facts carry no readable value.
  assert.ok(!JSON.stringify(diff.removed).includes("555"));
  assert.ok(!JSON.stringify(snapA).toLowerCase().includes("biscuit"));
});

test("snapshot stores only hashes, categories, score and date", async () => {
  const snap = toSnapshot(await hashFindings(SALT, WATCH_SCAN_A.findings), 78, new Date("2026-11-07T12:00:00Z"));
  assert.deepEqual(Object.keys(snap).sort(), ["at", "items", "score"]);
  const text = JSON.stringify(snap).toLowerCase();
  for (const f of WATCH_SCAN_A.findings) assert.ok(!text.includes(f.value.toLowerCase()), f.value);
});

test("history keeps the last 8 and dedupes an identical repeat scan", async () => {
  let store = freshStore(SALT);
  const base = toSnapshot(await hashFindings(SALT, WATCH_SCAN_A.findings), 78, new Date("2026-11-01T00:00:00Z"));
  for (let i = 0; i < 12; i++) store = appendSnapshot(store, { ...base, score: 50 + i, at: `2026-11-${10 + i}T00:00:00Z` });
  assert.equal(store.history.length, MAX_HISTORY);
  assert.equal(store.history[MAX_HISTORY - 1].score, 61);
  const again = appendSnapshot(store, { ...store.history[MAX_HISTORY - 1], at: "2026-12-01T00:00:00Z" });
  assert.equal(again.history.length, MAX_HISTORY);
  assert.equal(again.history[MAX_HISTORY - 1].at, "2026-12-01T00:00:00Z");
});

test("storage round-trip, corruption tolerance and clear", async () => {
  const kv = memory();
  assert.equal(loadWatch(kv), null);
  const snap = toSnapshot(await hashFindings(SALT, WATCH_SCAN_A.findings), 78);
  const store = appendSnapshot(freshStore(SALT), snap);
  assert.equal(saveWatch(kv, store), true);
  assert.deepEqual(loadWatch(kv), store);
  kv.setItem(WATCH_KEY, "{not json");
  assert.equal(loadWatch(kv), null);
  kv.setItem(WATCH_KEY, JSON.stringify({ v: 1, salt: "x", history: [] }));
  assert.equal(loadWatch(kv), null);
  saveWatch(kv, store);
  clearWatch(kv);
  assert.equal(loadWatch(kv), null);
});

test("sparkline path", () => {
  assert.equal(sparklinePath([50], 100, 30), "");
  const p = sparklinePath([0, 100], 100, 30, 0);
  assert.equal(p, "M0.0 30.0 L100.0 0.0");
});

test("ics: weekly recurrence, CRLF, folded lines, escaped text", () => {
  const now = new Date(2026, 10, 14, 15, 30, 0);
  const ics = buildReminderIcs({ now, appUrl: "https://app.example/scan", uid: "test-uid" });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("RRULE:FREQ=WEEKLY\r\n"));
  assert.ok(ics.includes("DTSTART:20261121T100000\r\n"));
  assert.ok(ics.includes("UID:test-uid\r\n"));
  assert.ok(!/[^\r]\n/.test(ics));
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(escapeIcsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  assert.ok(foldLine("X".repeat(200)).includes("\r\n "));
});
