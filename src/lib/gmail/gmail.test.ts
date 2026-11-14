import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText } from "./html";
import { bodyText, toEmailText, type GmailMessage } from "./message";
import {
  RESULTS_TTL_MS,
  __clearInboxForTests,
  failInboxCheck,
  finishInboxCheck,
  forgetInboxResults,
  inboxOwner,
  startInboxCheck,
  takeInboxResults,
  type InboxResults,
} from "./store";
import { authorizeUrl, GMAIL_SCOPE } from "./oauth";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const EMPTY: InboxResults = { inbox: [], spam: [], revoked: true, checkedAt: 0 };

test("htmlToText: drops styles and scripts, keeps link targets behind harmless labels, decodes entities", () => {
  const text = htmlToText(
    `<html><head><style>p{color:red}</style></head><body><p>Hi&nbsp;there,</p><script>x()</script>
     <p>Your account is <b>locked</b> &amp; will close.<br>Click <a href="https://evil.example/login?a=1&amp;b=2">PayPal Login</a></p>
     <p><a href="https://same.example">https://same.example</a> <a href="mailto:x@y.z">mail us</a></p><ul><li>one</li></ul></body></html>`,
  );
  assert.equal(
    text,
    "Hi there,\n\nYour account is locked & will close.\nClick PayPal Login (https://evil.example/login?a=1&b=2)\n\nhttps://same.example mail us\n• one",
  );
});

test("bodyText: prefers the HTML part, skips attachments, falls back to plain text", () => {
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64("Plain version") } },
          { mimeType: "text/html", body: { data: b64("<p>HTML <a href='https://x.example'>here</a></p>") } },
        ],
      },
      { mimeType: "text/plain", filename: "notes.txt", body: { data: b64("attachment text") } },
    ],
  };
  assert.equal(bodyText(payload), "HTML here (https://x.example)");
  assert.equal(bodyText({ mimeType: "text/plain", body: { data: b64("Only plain") } }), "Only plain");

  const m: GmailMessage = {
    id: "m1",
    snippet: "snip",
    internalDate: "1763000000000",
    payload: { headers: [{ name: "From", value: "Bank <alerts@bank.example>" }, { name: "subject", value: "Act now" }], mimeType: "text/plain" },
  };
  const e = toEmailText(m, 4000);
  assert.deepEqual([e.from, e.subject, e.body], ["Bank <alerts@bank.example>", "Act now", "snip"]);
});

test("inbox store: working until finished, deleted on first read, expires after 10 minutes", () => {
  __clearInboxForTests();
  const owner = inboxOwner("Student@School.edu ");
  assert.equal(owner, inboxOwner("student@school.edu"));
  const run = startInboxCheck(owner, 0);
  assert.ok(run);
  assert.equal(startInboxCheck(owner, 1), null, "one check at a time");
  assert.equal(takeInboxResults(owner, 2)?.status, "working");
  assert.equal(takeInboxResults(owner, 3)?.status, "working", "reading 'working' does not delete it");

  finishInboxCheck(owner, run!, EMPTY, 10);
  assert.equal(takeInboxResults(owner, 11)?.status, "done");
  assert.equal(takeInboxResults(owner, 12), null, "deleted on first read");

  const run2 = startInboxCheck(owner, 100)!;
  finishInboxCheck(owner, run2, EMPTY, 100);
  assert.equal(takeInboxResults(owner, 100 + RESULTS_TTL_MS), null, "expired");
});

test("inbox store: Forget during a check drops its late results; a stale run can't overwrite a new one", () => {
  __clearInboxForTests();
  const owner = inboxOwner("a@b.c");
  const first = startInboxCheck(owner, 0)!;
  forgetInboxResults(owner);
  finishInboxCheck(owner, first, EMPTY, 5);
  assert.equal(takeInboxResults(owner, 6), null);

  const second = startInboxCheck(owner, 10)!;
  failInboxCheck(owner, first, "late", 11);
  assert.equal(takeInboxResults(owner, 12)?.status, "working");
  failInboxCheck(owner, second, "Couldn't read", 13);
  const e = takeInboxResults(owner, 14);
  assert.equal(e?.status === "error" && e.message, "Couldn't read");
});

test("authorizeUrl: read-only Gmail scope, no refresh token, consent every time, bound to the signed-in address", () => {
  process.env.GOOGLE_CLIENT_ID = "cid";
  const u = new URL(authorizeUrl("http://localhost:3000", "st", "me@school.edu"));
  assert.equal(u.searchParams.get("scope"), GMAIL_SCOPE);
  assert.equal(u.searchParams.get("access_type"), "online");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("login_hint"), "me@school.edu");
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:3000/api/gmail/callback");
  assert.equal(u.searchParams.get("state"), "st");
});
