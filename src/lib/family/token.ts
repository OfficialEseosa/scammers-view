import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CARD_TTL_MS, FIRST_NAME_MAX, FIX_TITLE_MAX, clampScore, levelForScore, sanitizeText, type FamilyCard } from "./card";

/*
 * Stateless signed family card. Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Server only (node:crypto). Nothing is stored; the signature is the whole database.
 */

const DEV_KEY = "__svFamilyDevSecret";

export class SecretMissingError extends Error {}

/** AUTH_SECRET, or a random per-process secret in development. Throws elsewhere. */
export function getFamilySecret(): string {
  const env = process.env.AUTH_SECRET;
  if (env) return env;
  if (process.env.NODE_ENV === "development") {
    const g = globalThis as Record<string, unknown>;
    if (typeof g[DEV_KEY] !== "string") g[DEV_KEY] = randomBytes(32).toString("hex");
    return g[DEV_KEY] as string;
  }
  throw new SecretMissingError("AUTH_SECRET is not set.");
}

const b64 = (b: Buffer) => b.toString("base64url");

function mac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/** Stable, non-reversible member id from the verified email (the email itself is never in the token). */
export function memberId(secret: string, email: string): string {
  return b64(mac(secret, `family-member|${email.trim().toLowerCase()}`)).slice(0, 12);
}

const Payload = z.object({
  v: z.literal(1),
  m: z.string().min(1).max(32),
  n: z.string().min(1).max(FIRST_NAME_MAX * 4),
  s: z.number().int().min(0).max(100),
  t: z.string().max(FIX_TITLE_MAX * 4),
  b: z.number().int().min(0).max(999),
  c: z.number().int().min(0).max(999),
  i: z.number().int(),
  e: z.number().int(),
});

export function signCard(card: FamilyCard, secret: string): string {
  const payload = {
    v: 1,
    m: card.id,
    n: card.firstName,
    s: card.score,
    t: card.topFixTitle,
    b: card.chainsBroken,
    c: card.chainsTotal,
    i: card.issuedAt,
    e: card.expiresAt,
  };
  const body = b64(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${b64(mac(secret, body))}`;
}

export interface IssueInput {
  id: string;
  firstName: string;
  score: number;
  topFixTitle: string;
  chainsBroken: number;
  chainsTotal: number;
}

export function buildCard(input: IssueInput, now: number = Date.now()): FamilyCard {
  const score = clampScore(input.score);
  const total = Math.max(0, Math.min(999, Math.round(input.chainsTotal)));
  const broken = Math.max(0, Math.min(total, Math.round(input.chainsBroken)));
  return {
    id: input.id,
    firstName: sanitizeText(input.firstName, FIRST_NAME_MAX),
    score,
    level: levelForScore(score),
    topFixTitle: sanitizeText(input.topFixTitle, FIX_TITLE_MAX),
    chainsBroken: broken,
    chainsTotal: total,
    issuedAt: now,
    expiresAt: now + CARD_TTL_MS,
  };
}

export type VerifyResult =
  | { ok: true; card: FamilyCard }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

export function verifyToken(token: string, secret: string, now: number = Date.now()): VerifyResult {
  if (typeof token !== "string" || token.length > 1200) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;
  const expected = mac(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "signature" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const p = Payload.safeParse(raw);
  if (!p.success) return { ok: false, reason: "malformed" };
  const d = p.data;
  const card: FamilyCard = {
    id: d.m,
    firstName: sanitizeText(d.n, FIRST_NAME_MAX),
    score: d.s,
    level: levelForScore(d.s),
    topFixTitle: sanitizeText(d.t, FIX_TITLE_MAX),
    chainsBroken: d.b,
    chainsTotal: d.c,
    issuedAt: d.i,
    expiresAt: d.e,
  };
  if (now >= card.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, card };
}
