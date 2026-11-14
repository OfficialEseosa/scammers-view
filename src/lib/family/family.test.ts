// Run: npx tsx --test src/lib/family/family.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_TTL_MS, firstNameFromSubject, sanitizeText } from "./card";
import { buildCard, memberId, signCard, verifyToken } from "./token";
import { familyAverage, parseFragment, pendingInvites, removeCard, upsertCard, type StoredCard } from "./board";
import { WORDS, generateSafeWord } from "./safeword";

const SECRET = "test-secret-not-real";
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

function mint(email: string, name: string, score: number, now = T0) {
  const card = buildCard(
    { id: memberId(SECRET, email), firstName: firstNameFromSubject({ name, email }), score, topFixTitle: "Remove your phone number from people-search sites", chainsBroken: 1, chainsTotal: 3 },
    now,
  );
  return { token: signCard(card, SECRET), card };
}

test("signed token round-trips and carries only the card fields", () => {
  const { token, card } = mint("alex@example.com", "Alex Rivera", 78);
  const res = verifyToken(token, SECRET, T0 + 1000);
  assert.ok(res.ok);
  assert.deepEqual(res.card, card);
  assert.equal(res.card.level, "danger");
  assert.equal(res.card.expiresAt - res.card.issuedAt, CARD_TTL_MS);
  const body = Buffer.from(token.split(".")[0], "base64url").toString();
  assert.ok(!body.includes("alex@example.com"));
  assert.ok(!body.includes("Rivera"));
});

test("tampered payload or signature is rejected", () => {
  const { token } = mint("alex@example.com", "Alex Rivera", 78);
  const [body, sig] = token.split(".");
  const forged = JSON.parse(Buffer.from(body, "base64url").toString());
  forged.s = 5;
  const forgedBody = Buffer.from(JSON.stringify(forged)).toString("base64url");
  assert.deepEqual(verifyToken(`${forgedBody}.${sig}`, SECRET, T0), { ok: false, reason: "signature" });
  assert.deepEqual(verifyToken(`${body}.${sig.slice(0, -2)}AA`, SECRET, T0), { ok: false, reason: "signature" });
  assert.deepEqual(verifyToken(token, "another-secret", T0), { ok: false, reason: "signature" });
  assert.equal(verifyToken("nonsense", SECRET, T0).ok, false);
  assert.equal(verifyToken("", SECRET, T0).ok, false);
  assert.equal(verifyToken("a.b.c", SECRET, T0).ok, false);
});

test("expiry: valid just before 7 days, expired at 7 days", () => {
  const { token } = mint("alex@example.com", "Alex Rivera", 50);
  assert.equal(verifyToken(token, SECRET, T0 + CARD_TTL_MS - 1).ok, true);
  assert.deepEqual(verifyToken(token, SECRET, T0 + CARD_TTL_MS), { ok: false, reason: "expired" });
});

test("first name comes from the subject and never leaks the email", () => {
  assert.equal(firstNameFromSubject({ name: "Alex Rivera", email: "a@example.com" }), "Alex");
  assert.equal(firstNameFromSubject({ name: "alexr", email: "alexr@example.com" }), "Family member");
  assert.equal(firstNameFromSubject({ name: "alex@example.com", email: "alex@example.com" }), "Family member");
});

test("fix title is sanitised and capped at 60", () => {
  const nasty = "<script>alert(1)</script>\u0000  Remove   `your` phone number from every people-search site you can find today";
  const out = sanitizeText(nasty, 60);
  assert.ok(Array.from(out).length <= 60);
  assert.ok(!/[<>`\u0000]/.test(out));
  assert.ok(!/\s{2}/.test(out));
});

test("score is clamped and chains cannot exceed total", () => {
  const c = buildCard({ id: "x", firstName: "A", score: 250, topFixTitle: "t", chainsBroken: 9, chainsTotal: 2 }, T0);
  assert.equal(c.score, 100);
  assert.equal(c.chainsBroken, 2);
});

test("member id is stable, keyed, and not the email", () => {
  const a = memberId(SECRET, "Alex@Example.com");
  assert.equal(a, memberId(SECRET, "alex@example.com"));
  assert.notEqual(a, memberId("other", "alex@example.com"));
  assert.ok(!a.includes("alex"));
});

test("board: newer card replaces older, older never replaces newer", () => {
  const old = mint("alex@example.com", "Alex Rivera", 80, T0);
  const fresh = mint("alex@example.com", "Alex Rivera", 40, T0 + 1000);
  let cards: StoredCard[] = upsertCard([], old);
  cards = upsertCard(cards, fresh);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].card.score, 40);
  assert.equal(upsertCard(cards, old)[0].card.score, 40);
  assert.equal(removeCard(cards, fresh.card.id).length, 0);
});

test("board: average ignores expired cards; pending invites match by first name", () => {
  const a = mint("a@example.com", "Mia Hale", 80, T0);
  const b = mint("b@example.com", "Sam Hale", 40, T0 - CARD_TTL_MS - 1);
  const cards = [a, b];
  assert.equal(familyAverage(cards, T0 + 10), 80);
  assert.equal(familyAverage([b], T0 + 10), null);
  assert.deepEqual(pendingInvites(["mia", "Dad", "Sam"], cards, T0 + 10), ["Dad", "Sam"]);
});

test("fragment parsing keeps only token-shaped values", () => {
  assert.deepEqual(parseFragment("#card=abc.def&card=ghi.jkl"), ["abc.def", "ghi.jkl"]);
  assert.deepEqual(parseFragment("#card=<script>"), []);
  assert.deepEqual(parseFragment(""), []);
  assert.deepEqual(parseFragment("#other=1"), []);
});

test("safe word: three distinct words, injectable randomness", () => {
  assert.equal(WORDS.length, 128);
  assert.equal(new Set(WORDS).size, 128);
  const w = generateSafeWord();
  assert.equal(w.split("-").length, 3);
  assert.equal(generateSafeWord((n) => new Uint8Array(n).fill(0)).split("-").length, 3);
  const fixed = generateSafeWord(() => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  assert.equal(fixed, `${WORDS[0]}-${WORDS[1]}-${WORDS[2]}`);
  assert.notEqual(generateSafeWord(), generateSafeWord());
});
