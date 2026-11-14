import { createHmac, randomInt } from "node:crypto";
import { PATTERNS, type PatternId } from "./patterns";

/*
 * Room codes. 6 characters of Crockford base32 = 30 bits:
 *   6 bits payload (2 band, 4 pattern index) | 8 bits nonce | 16 bits HMAC tag.
 * The code carries only a score band and a scam type. Nothing identifies a person.
 * The tag stops a student from inventing codes to skew the room; it is not a secret store.
 * Server-only (uses node:crypto and the signing secret).
 */

export type Band = 0 | 1 | 2;
export const BAND_LABEL = ["0 to 39", "40 to 69", "70 to 100"] as const;

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function bandOf(score: number): Band {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return s >= 70 ? 2 : s >= 40 ? 1 : 0;
}

function tag(secret: string, payload: number, nonce: number): number {
  const mac = createHmac("sha256", secret).update(`campus-room:${payload}:${nonce}`).digest();
  return (mac[0] << 8) | mac[1];
}

function toChars(n: number): string {
  let s = "";
  for (let i = 5; i >= 0; i--) s += ALPHABET[(n >>> (i * 5)) & 31];
  return s;
}

function fromChars(code: string): number | null {
  if (code.length !== 6) return null;
  let n = 0;
  for (const ch of code) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 32 + i;
  }
  return n;
}

/** Uppercases, maps look-alikes (O to 0, I and L to 1) and strips spaces and dashes. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function signCode(secret: string, score: number, patternId: PatternId, nonce: number = randomInt(0, 256)): string | null {
  const idx = PATTERNS.findIndex((p) => p.id === patternId);
  if (idx < 0 || idx > 15) return null;
  const payload = (bandOf(score) << 4) | idx;
  const n = ((payload << 24) | ((nonce & 255) << 16) | tag(secret, payload, nonce & 255)) >>> 0;
  return toChars(n);
}

export type DecodedCode = { band: Band; patternId: PatternId };

export function verifyCode(secret: string, raw: string): DecodedCode | null {
  const n = fromChars(normalizeCode(raw));
  if (n === null) return null;
  const payload = n >>> 24;
  const nonce = (n >>> 16) & 255;
  const t = n & 0xffff;
  if (tag(secret, payload, nonce) !== t) return null;
  const band = payload >> 4;
  const pattern = PATTERNS[payload & 15];
  if (band > 2 || !pattern) return null;
  return { band: band as Band, patternId: pattern.id };
}
