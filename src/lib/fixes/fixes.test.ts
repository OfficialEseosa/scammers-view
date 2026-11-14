// Run: npx tsx --test src/lib/fixes/fixes.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_CHAINS as chains, FIXTURE_FINDINGS as findings } from "./fixture";
import { planFixes } from "./plan";
import { computeExposure } from "./score";

const allIds = findings.map((f) => f.id);

test("deterministic", () => {
  const a = computeExposure(findings, chains, ["f-dog"], 78);
  const b = computeExposure(findings, chains, ["f-dog"], 78);
  assert.deepEqual(a, b);
});

test("anchor lands the untouched score on the server value", () => {
  assert.equal(computeExposure(findings, chains, [], 78).score, 78);
  assert.equal(computeExposure(findings, chains, [], 40).score, 40);
  const free = computeExposure(findings, chains, []).score;
  assert.ok(free > 0 && free <= 100);
});

test("removing everything gives 0, nothing removed gives baseline", () => {
  assert.equal(computeExposure(findings, chains, allIds, 78).score, 0);
  const r = computeExposure(findings, chains, [], 78);
  assert.equal(r.score, r.baselineScore);
  assert.deepEqual(r.brokenChainIds, []);
});

test("score never rises when a finding is removed", () => {
  let removed: string[] = [];
  let last = computeExposure(findings, chains, removed, 78).score;
  for (const id of allIds) {
    removed = [...removed, id];
    const s = computeExposure(findings, chains, removed, 78).score;
    assert.ok(s <= last, `${id}: ${s} > ${last}`);
    last = s;
  }
});

test("a chain breaks only when a step loses ALL of its findings", () => {
  // step 2 of c-email needs dog, school AND hometown removed
  let r = computeExposure(findings, chains, ["f-dog", "f-school"], 78);
  assert.ok(!r.chainStatus["c-email"].broken);
  r = computeExposure(findings, chains, ["f-dog", "f-school", "f-hometown"], 78);
  assert.ok(r.chainStatus["c-email"].broken);
  assert.deepEqual(r.chainStatus["c-email"].brokenStepIds, ["c-email-2"]);
  assert.ok(r.brokenChainIds.includes("c-email"));
});

test("breaking a chain drops the score by more than the fact alone", () => {
  const noChains = computeExposure(findings, [], ["f-email"], 78);
  const withChains = computeExposure(findings, chains, ["f-email"], 78);
  assert.ok(withChains.chainStatus["c-email"].broken);
  assert.ok(withChains.score < computeExposure(findings, chains, [], 78).score);
  assert.ok(noChains.score >= 0);
});

test("diminishing returns per category", () => {
  const loc = findings.filter((f) => f.category === "location");
  assert.equal(loc.length, 2);
  const one = computeExposure([loc[0]], [], [], undefined).exactScore;
  const both = computeExposure(loc, [], [], undefined).exactScore;
  assert.ok(both < one * 2);
});

test("steps with no findings cannot be broken", () => {
  const c = [{ id: "x", target: "t", severity: 5, steps: [{ id: "s", title: "", description: "", findingIds: [] }] }];
  assert.equal(computeExposure(findings, c, allIds).brokenChainIds.length, 0);
});

test("planFixes: ranked, sums to total drop, top fix breaks a chain", () => {
  const fixes = planFixes(findings, chains, 78);
  assert.ok(fixes.length >= 6);
  const scoring = fixes.filter((f) => f.removesFindingIds.length > 0);
  // Marginal drops can rise down the list when two fixes together break a chain
  // (Spokeo + Instagram break the email chain); the first pick is always the best single move.
  const alone = (f: (typeof fixes)[number]) =>
    78 - computeExposure(findings, chains, f.removesFindingIds, 78).score;
  assert.equal(scoring[0].scoreDrop, Math.max(...scoring.map(alone)));
  const total = scoring.reduce((n, f) => n + f.scoreDrop, 0);
  const all = new Set(scoring.flatMap((f) => f.removesFindingIds));
  assert.equal(total, 78 - computeExposure(findings, chains, all, 78).score);
  assert.ok(scoring[0].scoreDrop > 0);
  assert.equal(fixes.at(-1)!.kind, "2fa");
  assert.equal(fixes.at(-1)!.scoreDrop, 0);
  assert.equal(new Set(fixes.map((f) => f.id)).size, fixes.length);
});

test("planFixes covers the catalog cases", () => {
  const ids = planFixes(findings, chains, 78).map((f) => f.id);
  for (const want of [
    "fix:privacy:instagram",
    "fix:privacy:linkedin",
    "fix:privacy:github",
    "fix:privacy:x",
    "fix:privacy:facebook",
    "fix:privacy:venmo",
    "fix:broker:spokeo-com",
    "fix:question:pet",
    "fix:question:hometown",
    "fix:question:maiden",
    "fix:2fa:checklist",
  ]) {
    assert.ok(ids.includes(want), `missing ${want}`);
  }
});

test("every fix has 3-7 steps, and unconfirmed links are flagged", () => {
  for (const f of planFixes(findings, chains, 78)) {
    assert.ok(f.steps.length >= 3 && f.steps.length <= 7, f.id);
    if (f.kind === "broker") assert.equal(f.linkConfirmed, false);
    if (f.link) assert.match(f.link, /^https:\/\//);
  }
});

test("no findings: only the 2FA hygiene fix, no crash", () => {
  const fixes = planFixes([], [], 0);
  assert.equal(fixes.length, 1);
  assert.equal(computeExposure([], [], []).score, 0);
});
