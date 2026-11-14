import type { Finding, FindingCategory } from "../types";

/*
 * Change watch keeps no readable values. Each finding becomes a salted SHA-256 of
 * "category|normalised value", cut to 64 bits. With a per-device random salt the
 * hashes cannot be matched across devices and a value cannot be read back from one.
 */

export interface FpItem {
  c: FindingCategory;
  h: string;
}

/** Same fact, same string: case, spacing, punctuation and phone formatting do not matter. */
export function normaliseValue(category: FindingCategory, value: string): string {
  let v = String(value ?? "").normalize("NFKC").toLowerCase().trim();
  if (category === "phone") {
    const digits = v.replace(/\D+/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  }
  if (category === "handle") v = v.replace(/^@+/, "");
  v = v.replace(/\s+/g, " ").replace(/^[\s"'.,;:!()[\]-]+|[\s"'.,;:!()[\]-]+$/g, "");
  return v;
}

export function fingerprintKey(category: FindingCategory, value: string): string {
  return `${category}|${normaliseValue(category, value)}`;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashFinding(salt: string, category: FindingCategory, value: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${fingerprintKey(category, value)}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return toHex(digest).slice(0, 16);
}

export function newSalt(random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface HashedFinding {
  finding: Finding;
  c: FindingCategory;
  h: string;
}

/** One entry per distinct fact (two sources for the same value count once). */
export async function hashFindings(salt: string, findings: Finding[]): Promise<HashedFinding[]> {
  const seen = new Set<string>();
  const out: HashedFinding[] = [];
  for (const finding of findings) {
    const h = await hashFinding(salt, finding.category, finding.value);
    const key = `${finding.category}|${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ finding, c: finding.category, h });
  }
  return out;
}
