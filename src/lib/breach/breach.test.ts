// Run: npx tsx --test src/lib/breach/breach.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Finding } from "../types";
import { cached, clearBreachCache, emailKey } from "./cache";
import { FIXTURE_BREACHES, FIXTURE_CLEAN } from "./fixture";
import { checkHibp } from "./hibp";
import { normaliseHibp, normaliseXon } from "./normalise";
import { breachesToFindings, breachFixes } from "./toFindings";
import { checkXon } from "./xon";

const hibpRaw = [
  { Name: "Adobe", Title: "Adobe", Domain: "adobe.com", BreachDate: "2013-10-04", DataClasses: ["Email addresses", "Password hints", "Passwords", "Usernames"], IsVerified: true, IsSensitive: false, IsRetired: false },
  { Name: "Hidden", Title: "Hidden", BreachDate: "2020-01-01", DataClasses: ["Passwords"], IsSensitive: true },
  { Name: "NewOne", Title: "New One", Domain: "", BreachDate: "2022-05-01", DataClasses: ["Phone numbers"], IsVerified: false },
  { nope: 1 },
];

test("normaliseHibp: drops sensitive, sorts newest first, maps fields", () => {
  const out = normaliseHibp(hibpRaw);
  assert.deepEqual(out.map((b) => b.name), ["New One", "Adobe"]);
  assert.equal(out[1].domain, "adobe.com");
  assert.equal(out[0].domain, undefined);
  assert.equal(out[0].verified, false);
  assert.deepEqual(normaliseHibp(null), []);
});

test("normaliseXon: splits xposed_data, year to date", () => {
  const out = normaliseXon({
    ExposedBreaches: { breaches_details: [
      { breach: "A", domain: "a.example", xposed_data: "Email addresses;Passwords;Phone numbers", xposed_date: "2016", verified: "Yes" },
      { breach: "B", xposed_data: "", xposed_date: "2020", verified: "No" },
    ] },
  });
  assert.deepEqual(out.map((b) => b.name), ["B", "A"]);
  assert.deepEqual(out[1].dataClasses, ["Email addresses", "Passwords", "Phone numbers"]);
  assert.equal(out[1].date, "2016-01-01");
  assert.equal(out[1].verified, true);
  assert.equal(out[0].verified, false);
  assert.deepEqual(normaliseXon({ ExposedBreaches: null }), []);
});

test("breachesToFindings: valid Findings, high weight for sensitive classes, skips email-only", () => {
  const f = breachesToFindings(FIXTURE_BREACHES);
  assert.ok(f.length > 0);
  for (const x of f) {
    Finding.parse(x);
    assert.equal(x.anchor, "email");
    assert.equal(x.category, "other");
    assert.equal(x.sourceType, "other");
  }
  const pw = f.find((x) => x.label === "Password exposed in Maplewood Forum (2023)");
  assert.ok(pw && pw.riskWeight >= 7);
  assert.ok(f.some((x) => x.label.startsWith("Security answers exposed in Quizzical")));
  assert.ok(!f.some((x) => x.label.includes("OldBlog")), "usernames + email only is below the bar");
  assert.equal(new Set(f.map((x) => x.id)).size, f.length);
  assert.ok(f.every((x, i) => i === 0 || f[i - 1].riskWeight >= x.riskWeight));
});

test("breachesToFindings: passwords win over hints in the same breach", () => {
  const f = breachesToFindings({ provider: "hibp", checkedAt: "2026-01-01T00:00:00Z", breaches: normaliseHibp(hibpRaw) });
  const adobe = f.filter((x) => x.label.includes("Adobe"));
  assert.deepEqual(adobe.map((x) => x.label).sort(), ["Password exposed in Adobe (2013)", "Password hint exposed in Adobe (2013)"]);
});

test("breachFixes: password, 2FA link only when verified, manager, answers", () => {
  const fixes = breachFixes(FIXTURE_BREACHES);
  const ids = fixes.map((x) => x.id);
  assert.ok(ids.includes("fix:maplewood-forum:password"));
  assert.ok(ids.includes("fix:2fa:app") && ids.includes("fix:password-manager") && ids.includes("fix:security-answers"));
  for (const x of fixes) if (x.link) assert.equal(x.linkConfirmed, true);
  const dropbox = breachFixes({ provider: "hibp", checkedAt: "x", breaches: [{ name: "Dropbox", domain: "dropbox.com", date: "2012-07-01", dataClasses: ["Passwords"] }] });
  assert.equal(dropbox[0].link, "https://help.dropbox.com/security/enable-two-step-verification");
  assert.deepEqual(breachFixes(FIXTURE_CLEAN), []);
});

test("emailKey: hash, case and space insensitive, never the address", () => {
  assert.equal(emailKey(" A@B.com "), emailKey("a@b.com"));
  assert.ok(!emailKey("a@b.com").includes("a@b"));
});

test("cache: one call for concurrent identical keys; failures not cached", async () => {
  clearBreachCache();
  let n = 0;
  const load = async () => (n++, FIXTURE_CLEAN);
  await Promise.all([cached("k", load), cached("k", load)]);
  await cached("k", load);
  assert.equal(n, 1);
  let m = 0;
  await assert.rejects(cached("bad", async () => { m++; throw new Error("x"); }));
  await assert.rejects(cached("bad", async () => { m++; throw new Error("x"); }));
  assert.equal(m, 2);
});

test("hibp: headers, 404 clean, 429 retry-after, 401", async () => {
  let seen: { url: string; headers: Record<string, string> } | null = null;
  const mk = (status: number, body: unknown = [], h: Record<string, string> = {}) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), headers: init?.headers as Record<string, string> };
      return new Response(JSON.stringify(body), { status, headers: h });
    }) as typeof fetch;
  const ok = await checkHibp("a@b.com", "k".repeat(32), mk(200, hibpRaw));
  assert.equal(ok.breaches.length, 2);
  assert.ok(seen!.url.includes("a%40b.com") && seen!.url.includes("truncateResponse=false"));
  assert.equal(seen!.headers["hibp-api-key"], "k".repeat(32));
  assert.ok(seen!.headers["user-agent"] && !/@/.test(seen!.headers["user-agent"]));
  assert.deepEqual((await checkHibp("a@b.com", "k", mk(404))).breaches, []);
  await assert.rejects(checkHibp("a@b.com", "k", mk(429, {}, { "retry-after": "7" })), (e: { kind: string; retryAfterSeconds: number }) => e.kind === "rate_limited" && e.retryAfterSeconds === 7);
  await assert.rejects(checkHibp("a@b.com", "k", mk(401)), (e: { kind: string }) => e.kind === "error");
});

test("xon: miss payload is clean; 429 maps to rate_limited", async () => {
  const miss = (async () => new Response(JSON.stringify({ ExposedBreaches: null }), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual((await checkXon("a@b.com", miss)).breaches, []);
  const limited = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(checkXon("a@b.com", limited), (e: { kind: string }) => e.kind === "rate_limited");
});
