import { riskLevel, type RiskLevel } from "../../design/risk";

/** The only thing a family card says about a person. No findings, no email, no surname. */
export interface FamilyCard {
  /** Opaque keyed hash of the member, so a newer card replaces an older one. Not reversible. */
  id: string;
  firstName: string;
  score: number;
  level: RiskLevel;
  topFixTitle: string;
  chainsBroken: number;
  chainsTotal: number;
  /** Epoch milliseconds. */
  issuedAt: number;
  expiresAt: number;
}

export const CARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FIX_TITLE_MAX = 60;
export const FIRST_NAME_MAX = 24;
export const FALLBACK_NAME = "Family member";
/** Page that reads `#card=<token>`. */
export const FAMILY_PATH = "/family";

const INVISIBLE = new RegExp("[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]", "g");

/** Strip control characters and markup characters, collapse whitespace, cap by code points. */
export function sanitizeText(input: string, max: number): string {
  const cleaned = String(input ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, " ")
    .replace(/[<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(cleaned);
  return chars.length <= max ? cleaned : chars.slice(0, max).join("").trimEnd();
}

/**
 * First name from the verified subject. If the session only has an email-derived
 * name, say so generically rather than leak part of the address.
 */
export function firstNameFromSubject(subject: { name: string; email: string }): string {
  const name = subject.name.trim();
  const local = subject.email.split("@")[0]?.trim().toLowerCase() ?? "";
  if (!name || name.includes("@") || name.toLowerCase() === local) return FALLBACK_NAME;
  const first = sanitizeText(name.split(/\s+/)[0] ?? "", FIRST_NAME_MAX);
  return first || FALLBACK_NAME;
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
}

export function levelForScore(score: number): RiskLevel {
  return riskLevel(clampScore(score));
}

export function isExpired(card: Pick<FamilyCard, "expiresAt">, now: number = Date.now()): boolean {
  return now >= card.expiresAt;
}

export function daysLeft(card: Pick<FamilyCard, "expiresAt">, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((card.expiresAt - now) / 86_400_000));
}
