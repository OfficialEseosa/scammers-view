import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRawEmail, confirmationLinks, pickPrivacyEmail } from "./mail";
import { BROKER_SITES, allowedUrl, brokerForUrl, brokerTask } from "./sites";
import { cleanupForFix, taskFor } from "./tasks";
import { validateAction, buildPrompt } from "./step";
import { addLog, clearLog, logOwner, readLog, __clearCleanupLogForTests } from "./log";
import type { Fix } from "@/lib/fixes/types";
import type { CleanupTask, Details, PageSnapshot } from "./types";

const details: Details = {
  name: "Alex Rivera",
  email: "alex@school.edu",
  city: "Maple Grove",
  state: "CA",
  listingUrl: "https://www.spokeo.com/Alex-Rivera/example",
};

const page: PageSnapshot = {
  url: "https://www.spokeo.com/optout",
  title: "Opt out",
  text: "Remove your listing",
  captcha: false,
  elements: [
    { i: 0, tag: "input", type: "text", label: "Profile URL" },
    { i: 1, tag: "input", type: "email", label: "Email" },
    { i: 2, tag: "button", label: "Submit removal request" },
  ],
};

const task: CleanupTask = brokerTask(BROKER_SITES[0], details.listingUrl);

test("taskFor and brokerForUrl resolve known sites only", () => {
  assert.equal(taskFor("broker:spokeo")?.site, "Spokeo");
  assert.equal(taskFor("settings:instagram-private")?.kind, "settings");
  assert.equal(taskFor("broker:nope"), null);
  assert.equal(brokerForUrl("https://www.spokeo.com/x")?.id, "spokeo");
  assert.equal(allowedUrl("https://www.spokeo.com/optout", ["spokeo.com"]), true);
  assert.equal(allowedUrl("https://evil.example/", ["spokeo.com"]), false);
});

test("validateAction: only approved details may be typed; submits flagged; off-site goto refused", () => {
  const input = { task, details, page, history: [] as string[] };
  const typed = validateAction({ action: "type", index: 0, text: "Alex Rivera", say: "Pasting your name.", submits: false }, input);
  assert.equal(typed.action, "type");
  assert.equal(typed.text, "Alex Rivera");

  const bad = validateAction({ action: "type", index: 0, text: "hacker@evil.com", say: "x", submits: false }, input);
  assert.equal(bad.action, "needs_user");

  const click = validateAction({ action: "click", index: 2, say: "Submitting.", submits: false }, input);
  assert.equal(click.submits, true);

  const leave = validateAction({ action: "goto", url: "https://evil.example/", say: "x", submits: false }, input);
  assert.equal(leave.action, "needs_user");
});

test("buildPrompt includes the goal and approved details", () => {
  const p = buildPrompt({ task, details, page, history: ["Opened the page"] });
  assert.match(p, /Spokeo/);
  assert.match(p, /alex@school\.edu/);
  assert.match(p, /\[2\] button/);
});

test("confirmationLinks only keep confirm-like URLs on the broker's domain", () => {
  const spokeo = BROKER_SITES.find((b) => b.id === "spokeo")!;
  const text = `
    Thanks for your request. Confirm here: https://www.spokeo.com/optout/confirm?t=abc
    Or visit https://www.spokeo.com/about
    Ignore https://phishing.example/confirm?t=abc
  `;
  const links = confirmationLinks(text, spokeo);
  assert.deepEqual(links, ["https://www.spokeo.com/optout/confirm?t=abc"]);
});

test("pickPrivacyEmail prefers privacy@ on the site's own domain", () => {
  assert.equal(pickPrivacyEmail("Contact support@spokeo.com or privacy@spokeo.com", "spokeo.com"), "privacy@spokeo.com");
  assert.equal(pickPrivacyEmail("Write to help@other.com", "spokeo.com"), null);
});

test("buildRawEmail produces base64url RFC 2822", () => {
  const raw = buildRawEmail("privacy@spokeo.com", "Remove me", "Hello\nWorld");
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(decoded, /^To: privacy@spokeo.com/m);
  assert.match(decoded, /Subject: Remove me/);
  assert.match(decoded, /Hello\r\nWorld/);
});

test("cleanup log: add, read, clear, owner hashed", () => {
  __clearCleanupLogForTests();
  const a = logOwner("A@School.edu");
  const b = logOwner("a@school.edu");
  assert.equal(a, b);
  addLog(a, { site: "Spokeo", taskId: "broker:spokeo", outcome: "done", note: "Submitted." });
  assert.equal(readLog(a).length, 1);
  assert.equal(readLog(a)[0].site, "Spokeo");
  clearLog(a);
  assert.equal(readLog(a).length, 0);
});

test("cleanupForFix maps broker and privacy fixes to agent modes", () => {
  const brokerFix = {
    id: "fix:broker:spokeo-com",
    kind: "broker",
    title: "Get removed from Spokeo",
    why: "",
    steps: [],
    removesFindingIds: ["f1"],
    scoreDrop: 10,
    breaksChainIds: [],
    effort: "5 min",
    optout: { broker: "Spokeo", listingUrl: "https://www.spokeo.com/Alex-Rivera/example", findingIds: ["f1"] },
  } as Fix;
  assert.deepEqual(cleanupForFix(brokerFix), { taskId: "broker:spokeo", mode: "broker-form", site: "Spokeo" });

  const ig = {
    id: "fix:privacy:instagram",
    kind: "privacy",
    title: "Make your Instagram private",
    why: "",
    steps: [],
    removesFindingIds: [],
    scoreDrop: 0,
    breaksChainIds: [],
    effort: "1 min",
  } as Fix;
  assert.equal(cleanupForFix(ig)?.mode, "settings");

  const gh = {
    id: "fix:privacy:github",
    kind: "privacy",
    title: "Keep your GitHub email private",
    why: "",
    steps: [],
    removesFindingIds: [],
    scoreDrop: 0,
    breaksChainIds: [],
    effort: "5 min",
  } as Fix;
  assert.equal(cleanupForFix(gh)?.mode, "settings");
  assert.equal(cleanupForFix(gh)?.taskId, "settings:github-email");

  const wayup = {
    id: "fix:takedown:wayup-com",
    kind: "takedown",
    title: "Take Employer off wayup.com",
    why: "",
    steps: [],
    removesFindingIds: [],
    scoreDrop: 0,
    breaksChainIds: [],
    effort: "15 min",
    link: "https://www.wayup.com/profile/example",
  } as Fix;
  assert.deepEqual(cleanupForFix(wayup), { taskId: "profile:wayup", mode: "settings", site: "WayUp" });

  const devpost = {
    id: "fix:takedown:devpost-com",
    kind: "takedown",
    title: "Take Hackathon teammate off devpost.com",
    why: "",
    steps: [],
    removesFindingIds: [],
    scoreDrop: 0,
    breaksChainIds: [],
    effort: "15 min",
    link: "https://devpost.com/software/example",
  } as Fix;
  assert.deepEqual(cleanupForFix(devpost), { taskId: "profile:devpost", mode: "settings", site: "Devpost" });
});

test("taskFor profile requires a listing URL on that site", () => {
  assert.equal(taskFor("profile:wayup"), null);
  assert.equal(taskFor("profile:wayup", "https://evil.example/x"), null);
  const t = taskFor("profile:wayup", "https://www.wayup.com/profile/alex");
  assert.ok(t);
  assert.equal(t!.kind, "settings");
  assert.equal(t!.startUrl, "https://www.wayup.com/profile/alex");
  assert.deepEqual(t!.hosts, ["wayup.com"]);
});
