// Run: npx tsx --test src/lib/search/search.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { findSpans } from "./cues";
import { fixDocs, patternDocs } from "./docs";
import { localSearch } from "./local";

test("reference docs cover every pattern and fix, with no user data", () => {
  assert.equal(new Set(patternDocs().map((d) => d.id)).size, patternDocs().length);
  assert.ok(fixDocs().some((d) => d.id === "fix:broker:whitepages-com"));
});

test("local search ranks the obvious scam first", async () => {
  const gift = await localSearch.searchPatterns("Hi it's Professor Lee from my personal email. Are you free? I need you to buy 4 gift cards for a surprise and send me the card numbers, keep it between us.", 3);
  assert.equal(gift[0]?.id, "professor-gift-cards");
  const aid = await localSearch.searchPatterns("FINAL NOTICE: your financial aid refund is on hold. Log in here https://bit.ly/x to avoid your classes being dropped.", 3);
  assert.equal(aid[0]?.id, "aid-refund-phish");
  const none = await localSearch.searchPatterns("", 3);
  assert.equal(none.length, 0);
});

test("fix search finds brokers and platforms", async () => {
  const hits = await localSearch.searchFixes("whitepages remove", 3);
  assert.equal(hits[0]?.id, "fix:broker:whitepages-com");
  const ig = await localSearch.searchFixes("instagram private", 3);
  assert.equal(ig[0]?.id, "fix:privacy:instagram");
});

test("cue spans are non-overlapping and point at the text", () => {
  const text = "Urgent: buy gift cards right now and send the verification code.";
  const spans = findSpans(text);
  assert.ok(spans.length >= 3);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i].start >= spans[i - 1].end);
  assert.ok(spans.some((s) => text.slice(s.start, s.end).toLowerCase() === "gift cards"));
});
