import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import type { Finding } from "../types";
import { deriveUserKey, open, recordKeyFor, resolveMasterKey, seal, type Envelope } from "./crypto";
import { MAX_BODY_BYTES, MAX_FINDINGS, deleteSaved, loadSaved, parseSavedScan, storeKey, storeSaved, type Kv, type SavedScan } from "./savedScan";

// Fictional people and data only.
const ALICE = "Ava.Example@example.com";
const BOB = "ben.sample@example.org";
const master = randomBytes(32);

function finding(i: number): Finding {
  return {
    id: `f${i}`,
    category: "pet",
    label: "Dog's name",
    value: `Biscuit-${i}`,
    sourceType: "web",
    sourceUrl: `https://example.com/post/${i}`,
    anchor: "unconfirmed",
    confidence: 0.8,
    riskWeight: 5,
    foundAt: "2026-01-01T00:00:00.000Z",
  };
}

function scan(n = 3): SavedScan {
  return {
    savedAt: 1_760_000_000_000,
    findings: Array.from({ length: n }, (_, i) => finding(i)),
    chains: [{ id: "c1", target: "School email account", severity: 6, steps: [{ id: "s1", title: "Guess", description: "Pet name as password hint", findingIds: ["f0"] }] }],
    score: { score: 42, topFindingIds: ["f0"], summary: "Fictional summary" },
    sources: { web: { status: "done", count: n } },
    notMeIds: ["f2"],
  };
}

function memKv(): Kv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(k: string) => (data.has(k) ? (structuredClone(data.get(k)) as T) : null),
    put: async (k, v) => (data.set(k, structuredClone(v)), true),
    del: async (k) => (data.delete(k), true),
  };
}

test("encrypt/decrypt round trip", () => {
  const env = seal(scan(), master, ALICE, 123);
  assert.equal(env.v, 1);
  assert.equal(env.savedAt, 123);
  assert.equal(Buffer.from(env.iv, "base64").length, 12);
  assert.deepEqual(open(env, master, ALICE), scan());
});

test("ciphertext holds none of the plaintext and IVs are fresh", () => {
  const a = seal(scan(), master, ALICE, 1);
  const b = seal(scan(), master, ALICE, 1);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  const raw = JSON.stringify(a);
  for (const needle of ["Biscuit", "example.com", "Fictional", ALICE.toLowerCase()]) assert.ok(!raw.includes(needle), needle);
});

test("tampering is rejected", () => {
  const env = seal(scan(), master, ALICE, 1);
  const ct = Buffer.from(env.ciphertext, "base64");
  ct[5] ^= 0x01;
  assert.throws(() => open({ ...env, ciphertext: ct.toString("base64") }, master, ALICE));
  const tag = Buffer.from(env.tag, "base64");
  tag[0] ^= 0x80;
  assert.throws(() => open({ ...env, tag: tag.toString("base64") }, master, ALICE));
  assert.throws(() => open({ ...env, iv: randomBytes(12).toString("base64") }, master, ALICE));
});

test("another user's key cannot open the record", () => {
  const env = seal(scan(), master, ALICE, 1);
  assert.throws(() => open(env, master, BOB));
  assert.throws(() => open(env, randomBytes(32), ALICE));
});

test("key derivation is deterministic, per user and case-insensitive", () => {
  assert.deepEqual(deriveUserKey(master, ALICE), deriveUserKey(master, ALICE.toLowerCase()));
  assert.notDeepEqual(deriveUserKey(master, ALICE), deriveUserKey(master, BOB));
  assert.equal(recordKeyFor(master, ALICE), recordKeyFor(master, `  ${ALICE.toUpperCase()} `));
  assert.notEqual(recordKeyFor(master, ALICE), recordKeyFor(master, BOB));
  const key = recordKeyFor(master, ALICE);
  assert.match(key, /^scan-[0-9a-f]{40}$/);
  assert.ok(!key.includes("example"));
});

test("missing key: off in production, dev-only derivation in development", () => {
  assert.equal(resolveMasterKey({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32) }), null);
  assert.equal(resolveMasterKey({ NODE_ENV: "production" }), null);
  assert.equal(resolveMasterKey({ NODE_ENV: "development" }), null);
  const dev = resolveMasterKey({ NODE_ENV: "development", AUTH_SECRET: "fictional-dev-secret" });
  assert.ok(dev && dev.length === 32);
  assert.deepEqual(dev, resolveMasterKey({ NODE_ENV: "development", AUTH_SECRET: "fictional-dev-secret" }));
  assert.notDeepEqual(dev, Buffer.from("fictional-dev-secret"));
  // A short or malformed key is refused, never padded.
  assert.equal(resolveMasterKey({ NODE_ENV: "production", SCAN_STORE_KEY: "c2hvcnQ=" }), null);
  const good = randomBytes(32).toString("base64");
  assert.equal(resolveMasterKey({ NODE_ENV: "production", SCAN_STORE_KEY: good })?.toString("base64"), good);
  assert.equal(storeKey({ NODE_ENV: "production", SCAN_STORE_KEY: good }), null, "no database settings: off");
  assert.ok(storeKey({ NODE_ENV: "production", SCAN_STORE_KEY: good, SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "k", SUPABASE_KV_SECRET: "s" }));
});

test("size caps and schema", () => {
  assert.deepEqual(parseSavedScan(JSON.stringify(scan())), { ok: true, scan: scan() });
  assert.equal(parseSavedScan(JSON.stringify(scan(MAX_FINDINGS))).ok, true);
  assert.deepEqual(parseSavedScan(JSON.stringify(scan(MAX_FINDINGS + 1))), { ok: false, error: "invalid" });
  assert.deepEqual(parseSavedScan(" ".repeat(MAX_BODY_BYTES + 1)), { ok: false, error: "too_large" });
  assert.deepEqual(parseSavedScan("{not json"), { ok: false, error: "bad_json" });
  assert.equal(parseSavedScan(JSON.stringify({ ...scan(), findings: [] })).ok, false);
  assert.equal(parseSavedScan(JSON.stringify({ ...scan(), faceDescriptor: [1, 2] })).ok, true, "unknown fields are dropped");
  const r = parseSavedScan(JSON.stringify({ ...scan(), faceDescriptor: [1, 2] }));
  assert.ok(r.ok && !("faceDescriptor" in r.scan));
});

test("store, load, delete through a mocked KV", async () => {
  const kv = memKv();
  assert.equal(await loadSaved(ALICE, master, kv), null);
  assert.equal(await storeSaved(ALICE, scan(), master, kv), true);
  assert.equal(kv.data.size, 1);
  const [key, stored] = [...kv.data.entries()][0];
  assert.equal(key, recordKeyFor(master, ALICE));
  assert.ok(!JSON.stringify(stored).includes("Biscuit"));
  assert.deepEqual(await loadSaved(ALICE, master, kv), scan());
  assert.equal(await loadSaved(BOB, master, kv), null, "Bob has no record");
  // Copying Alice's blob under Bob's key still cannot be opened.
  kv.data.set(recordKeyFor(master, BOB), stored as Envelope);
  assert.equal(await loadSaved(BOB, master, kv), null);
  assert.equal(await deleteSaved(ALICE, master, kv), true);
  assert.equal(await loadSaved(ALICE, master, kv), null);
});
