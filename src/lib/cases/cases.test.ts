// Run: npx tsx --test src/lib/cases/cases.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { FindingCategory } from "../types";
import { caseDocs } from "./docs";
import { caseOpen, exposedCategories, missingNeeds } from "./match";
import { localCases, needsFilter } from "./search";

test("case docs are sourced, tagged with known categories and unique", () => {
  const docs = caseDocs();
  assert.ok(docs.length >= 250);
  assert.ok(docs.some((d) => d.source === "FBI IC3") && docs.some((d) => d.source === "FTC"));
  assert.equal(new Set(docs.map((d) => d.id)).size, docs.length);
  const cats = new Set<string>(FindingCategory.options);
  for (const d of docs) {
    assert.match(d.url, /^https:\/\/(www\.ic3\.gov|consumer\.ftc\.gov)\//);
    assert.ok(d.needs.length > 0 && d.needs.every((n) => cats.has(n)), d.id);
    assert.ok(d.channels.length > 0 && d.summary.length > 40 && d.how.length > 20, d.id);
  }
});

test("a case is open only while every fact it needs is public", () => {
  assert.equal(caseOpen(["phone", "relative"], ["phone", "relative", "email"]), true);
  assert.equal(caseOpen(["phone", "relative"], ["phone", "email"]), false);
  assert.deepEqual(missingNeeds(["phone", "relative"], ["phone"]), ["relative"]);
});

test("ticked fixes take a category out only when its last fact goes", () => {
  const findings = [
    { id: "a", category: "phone" as const },
    { id: "b", category: "phone" as const },
    { id: "c", category: "relative" as const },
  ];
  assert.deepEqual(exposedCategories(findings), ["phone", "relative"]);
  assert.deepEqual(exposedCategories(findings, ["a"]), ["phone", "relative"]);
  assert.deepEqual(exposedCategories(findings, ["a", "b"]), ["relative"]);
});

test("the Typesense filter excludes every category that is not exposed", () => {
  const f = needsFilter(["phone", "email"]);
  assert.ok(f?.startsWith("needs:!=["));
  assert.ok(f?.includes("relative") && !f.includes("phone") && !/[\[,]email[,\]]/.test(f));
  assert.equal(needsFilter(FindingCategory.options), undefined);
});

test("local search only returns cases the exposure allows, best match first", () => {
  const q = [{ id: "c1", text: "A caller pretends to be a grandchild in jail and asks the family for bail money" }];
  const withFamily = localCases({ exposed: ["relative", "phone", "location"], queries: q }, 5);
  assert.ok(withFamily.c1.length > 0);
  assert.equal(withFamily.c1[0].scam_type, "family-emergency");
  assert.equal(withFamily.c1[0].score, 1);
  const noFamily = localCases({ exposed: ["phone", "location"], queries: q }, 5);
  assert.ok(noFamily.c1.every((h) => !h.needs.includes("relative")));
  assert.deepEqual(localCases({ exposed: [], queries: q }, 5).c1, []);
});

test("student scams are covered: job, tuition and rental cases exist for a student's exposure", () => {
  const exposed = ["school", "email", "phone", "location"] as const;
  const q = [
    { id: "job", text: "A campus job offer by email that sends a check before any work" },
    { id: "aid", text: "A call about unpaid college tuition says pay now or be dropped from classes" },
    { id: "rent", text: "A rental listing near campus asks for a deposit before a viewing" },
  ];
  const r = localCases({ exposed: [...exposed], queries: q }, 3);
  assert.equal(r.job[0]?.scam_type, "job-offer");
  assert.equal(r.aid[0]?.scam_type, "financial-aid");
  assert.equal(r.rent[0]?.scam_type, "rental");
});
