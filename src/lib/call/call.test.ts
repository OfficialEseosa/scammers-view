// Run: npx tsx --test src/lib/call/call.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding } from "../types";
import { nextTurn, safeLine, startCall, type CallState } from "./agent";
import { gradeRules } from "./grade";
import { buildScenario } from "./scenarios";
import { REDACTED, readSignals, redact } from "./signals";
import { TICKET_TTL_MS, clearTickets, createTicket, deleteOwnerTickets, getTicket, ownerKey, ticketForAgent, toView, updateTicket } from "./tickets";

const base = { sourceType: "personal_site" as const, anchor: "email" as const, confidence: 0.9, foundAt: "2026-01-01T00:00:00.000Z", sourceUrl: "https://alex.example" };
const FINDINGS: Finding[] = [
  { ...base, id: "f-school", category: "school", label: "School", value: "Northgate College", riskWeight: 8 },
  { ...base, id: "f-employer", category: "employer", label: "Employer", value: "Harbor Coffee Roasters", riskWeight: 7 },
  { ...base, id: "f-rel", category: "relative", label: "Sister", value: "Maya", riskWeight: 6 },
  { ...base, id: "f-loc", category: "location", label: "City", value: "Portland", riskWeight: 5 },
];

async function play(scenario: Parameters<typeof buildScenario>[0], replies: string[], hangupAt?: number): Promise<CallState> {
  let { state } = startCall(buildScenario(scenario, FINDINGS, "Alex Rivera"));
  for (let i = 0; i < replies.length; i++) {
    const r = await nextTurn(state, replies[i], { useModel: false, hangup: i === hangupAt });
    state = r.state;
    if (r.ended) break;
  }
  return state;
}

test("safeLine blocks links, long numbers and account details", () => {
  assert.ok(safeLine("I need you to send money, I'll explain later."));
  assert.ok(!safeLine("Go to https://example.com now"));
  assert.ok(!safeLine("Send it to account 12345678"));
  assert.ok(!safeLine("Use my routing details"));
  assert.ok(!safeLine("Pay me at @scammer"));
  assert.ok(!safeLine(""));
});

test("redact blanks SSNs, card numbers and codes but keeps short numbers", () => {
  assert.equal(redact("it's 123-45-6789"), `it's ${REDACTED}`);
  assert.equal(redact("card 4111 1111 1111 1111 ok"), `card ${REDACTED} ok`);
  assert.equal(redact("I have 2 kids"), "I have 2 kids");
  assert.ok(readSignals(redact("my ssn is 123456789")).revealedNumber);
});

test("scenarios use the user's own findings and never invent a recipient", () => {
  const s = buildScenario("family-voice-clone", FINDINGS, "Alex Rivera");
  assert.ok(s.details.some((d) => d.findingId === "f-rel"));
  assert.ok(s.safeWordExpected);
  const r = buildScenario("professor-gift-cards", FINDINGS, "Alex Rivera");
  assert.match(r.persona, /Harbor Coffee Roasters/);
});

test("a careful caller passes most checks", async () => {
  const state = await play("family-voice-clone", ["Who is this? What's our safe word?", "No. I'll call you back on your real number."], 1);
  assert.equal(state.endedBy, "you");
  const card = gradeRules(state);
  assert.equal(card.verdict, "safe");
  for (const id of ["verified", "secret", "refused", "callback", "hungUp", "noInfo"]) {
    assert.ok(card.checks.find((c) => c.id === id)?.passed, `${id} should pass`);
  }
});

test("reading out a number is caught and redacted in the transcript", async () => {
  const state = await play("fake-recruiter", ["Sure", "Okay, my social is 123-45-6789", "yes"]);
  assert.ok(!state.transcript.some((l) => /\d{3,}/.test(l.text) && l.speaker === "you"));
  const card = gradeRules(state);
  assert.equal(card.verdict, "caught");
  assert.equal(card.checks.find((c) => c.id === "noInfo")?.passed, false);
});

test("the scammer escalates and pivots when challenged, then ends with the practice tag", async () => {
  const state = await play("professor-gift-cards", ["Hi?", "How do I know it's really you?", "I'm not sure.", "No, I won't."]);
  const phases = state.transcript.filter((l) => l.speaker === "scammer").map((l) => l.text);
  assert.ok(phases.some((t) => /odd ask|meeting/i.test(t)), "pivot line used");
  assert.equal(state.phase, "done");
  assert.match(phases.at(-1)!, /practice call from Scammer's View/);
});

test("tickets expire, are owner-scoped and cap concurrent live calls", () => {
  clearTickets();
  const t0 = 1_000_000;
  const { state } = startCall(buildScenario("fake-recruiter", FINDINGS, "Alex"));
  const a = createTicket({ owner: ownerKey("a@example.com"), mode: "live", state, maxLive: 2 }, t0);
  assert.ok(a.ok);
  assert.equal(a.ticket.status, "waiting");
  assert.equal(toView(a.ticket).transcript.length, 0);
  assert.ok(createTicket({ owner: ownerKey("b@example.com"), mode: "live", state, maxLive: 2 }, t0).ok);
  assert.deepEqual(createTicket({ owner: ownerKey("c@example.com"), mode: "live", state, maxLive: 2 }, t0), { ok: false, reason: "live_busy" });
  assert.ok(createTicket({ owner: ownerKey("c@example.com"), mode: "simulated", state, maxLive: 2 }, t0).ok, "the cap only applies to live calls");
  assert.equal(getTicket(a.ticket.id, ownerKey("b@example.com"), t0), null);
  assert.equal(ticketForAgent(a.ticket.id, t0)?.id, a.ticket.id);
  assert.equal(getTicket(a.ticket.id, ownerKey("a@example.com"), t0 + TICKET_TTL_MS + 1), null);
  assert.equal(ticketForAgent(a.ticket.id, t0 + TICKET_TTL_MS + 1), null);
});

test("ending a session returns its tickets so their rooms can be closed", () => {
  clearTickets();
  const { state } = startCall(buildScenario("fake-recruiter", FINDINGS, "Alex"));
  const owner = ownerKey("a@example.com");
  const a = createTicket({ owner, mode: "live", state });
  assert.ok(a.ok);
  updateTicket(a.ticket.id, { room: "practice-x" });
  const gone = deleteOwnerTickets(owner);
  assert.deepEqual(gone.map((t) => t.room), ["practice-x"]);
  assert.equal(getTicket(a.ticket.id, owner), null);
});
