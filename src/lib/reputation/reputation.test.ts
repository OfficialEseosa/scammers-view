import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLinks, extractNumbers, formatNumber } from "./extract";
import { addFtcCsv, finishFtcIndex, ftcFileUrls, loadFtcIndex, __setFtcIndexForTests } from "./ftc";
import { safeBrowsingLookup } from "./safeBrowsing";
import { __clearLinkCacheForTests, checkReputation, isReported } from "./index";

const CSV = [
  "Company_Phone_Number,Created_Date,Violation_Date,Consumer_City,Consumer_State,Consumer_Area_Code,Subject,Recorded_Message_Or_Robocall",
  '8005551234,2026-11-12 00:00:45,2026-11-12 09:23:00,,California,415,"Reducing your debt (credit cards, mortgage, student loans)",Y',
  '8005551234,2026-11-12 00:01:00,2026-11-12 09:30:00,Austin,Texas,512,"Reducing your debt (credit cards, mortgage, student loans)",N',
  "8005551234,2026-11-12 00:02:00,2026-11-12 09:40:00,,Texas,512,Other,Y",
  "2125550000,2026-11-12 00:03:00,2026-11-12 10:00:00,,New York,212,Other,N",
  ",2026-11-12 00:04:00,2026-11-12 10:00:00,,Utah,801,Other,Y",
].join("\n");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("extractLinks: schemes, www and bare domains; trailing punctuation dropped; emails skipped; deduplicated", () => {
  const links = extractLinks(
    "Log in at https://paypa1-secure.com/verify?id=3. Or www.example.org, or bit.ly/abc! Mail me at someone@school.edu. Again: https://paypa1-secure.com/verify?id=3",
  );
  assert.deepEqual(links, ["https://paypa1-secure.com/verify?id=3", "http://www.example.org/", "http://bit.ly/abc"]);
  assert.equal(extractLinks(Array.from({ length: 15 }, (_, i) => `https://x${i}.com`).join(" ")).length, 10);
});

test("extractNumbers: US formats to 10 digits, no duplicates, no short or invalid numbers", () => {
  const nums = extractNumbers("Call (800) 555-1234 or +1 212.555.0000 or 800-555-1234 now. Code 123456. Bad 012-555-1234.");
  assert.deepEqual(nums, ["8005551234", "2125550000"]);
  assert.equal(formatNumber("8005551234"), "(800) 555-1234");
});

test("FTC files: counts reports and robocalls per number, picks a specific subject over Other", () => {
  const tally = new Map();
  addFtcCsv(tally, CSV);
  const index = finishFtcIndex(tally);
  assert.deepEqual(index.get("8005551234"), { reports: 3, robocalls: 2, topSubject: "Reducing your debt (credit cards, mortgage, student loans)" });
  assert.deepEqual(index.get("2125550000"), { reports: 1, robocalls: 0, topSubject: "Other" });
  assert.equal(index.size, 2);
});

test("loadFtcIndex: skips missing days, fails only when no file loads", async () => {
  const urls = ftcFileUrls(new Date("2026-11-14T12:00:00Z"), 3);
  assert.match(urls[0], /DNC_Complaint_Numbers_2026-11-14\.csv$/);
  const fetchOk = (async (url: string) => (String(url).includes("2026-11-13") ? new Response(CSV) : new Response("nope", { status: 404 }))) as typeof fetch;
  const index = await loadFtcIndex(fetchOk, new Date("2026-11-14T12:00:00Z"));
  assert.equal(index.get("8005551234")?.reports, 3);
  const fetchNone = (async () => new Response("nope", { status: 404 })) as typeof fetch;
  await assert.rejects(loadFtcIndex(fetchNone, new Date("2026-11-14T12:00:00Z")));
});

test("safeBrowsingLookup: sends only the links and maps threat types", async () => {
  let sent: { threatInfo: { threatEntries: { url: string }[] } } | undefined;
  const fake = (async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return json({ matches: [{ threatType: "SOCIAL_ENGINEERING", threat: { url: "http://bad.example/" } }] });
  }) as typeof fetch;
  const found = await safeBrowsingLookup(["http://bad.example/", "http://good.example/"], "k", undefined, fake);
  assert.deepEqual(sent?.threatInfo.threatEntries, [{ url: "http://bad.example/" }, { url: "http://good.example/" }]);
  assert.deepEqual([...found], [["http://bad.example/", "phishing"]]);
  await assert.rejects(safeBrowsingLookup(["http://x.com/"], "k", undefined, (async () => json({}, 403)) as typeof fetch));
});

test("checkReputation: flags reported links and numbers, caches links, skips quietly without a key", async () => {
  __clearLinkCacheForTests();
  const tally = new Map();
  addFtcCsv(tally, CSV);
  __setFtcIndexForTests(finishFtcIndex(tally));
  let calls = 0;
  const fake = (async () => {
    calls++;
    return json({ matches: [{ threatType: "MALWARE", threat: { url: "http://bad.example/" } }] });
  }) as typeof fetch;
  const text = "Your account is locked. Visit http://bad.example/ or call 800-555-1234.";

  const r = await checkReputation(text, { safeBrowsingKey: "k", fetchImpl: fake });
  assert.deepEqual(r.links, [{ url: "http://bad.example/", threat: "malware" }]);
  assert.equal(r.numbers[0].reports, 3);
  assert.deepEqual(r.checked, { links: 1, numbers: 1 });
  assert.equal(isReported(r), true);

  await checkReputation(text, { safeBrowsingKey: "k", fetchImpl: fake });
  assert.equal(calls, 1, "second check comes from the cache");

  const noKey = await checkReputation("see http://other.example", { safeBrowsingKey: "", ftc: false, fetchImpl: fake });
  assert.deepEqual(noKey, { links: [], numbers: [], checked: { links: false, numbers: 0 } });
  __setFtcIndexForTests(undefined);
});

test("checkReputation: a slow lookup is dropped after the time limit", async () => {
  __clearLinkCacheForTests();
  const slow = ((_u: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(json({})), 2000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      });
    })) as typeof fetch;
  const started = Date.now();
  const r = await checkReputation("http://slow.example", { safeBrowsingKey: "k", ftc: false, fetchImpl: slow, timeoutMs: 100 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(r.checked.links, false);
});
