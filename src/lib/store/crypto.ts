import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Encryption for scans saved to a person's account.
 *
 * One server secret (SCAN_STORE_KEY, 32 random bytes, base64) never touches
 * the data directly. From it we derive, with HKDF-SHA256:
 *   - an id key, used to turn an email into an opaque record name, and
 *   - a data key per person (salt = their lowercased email), used for AES-256-GCM.
 * So the store holds no email addresses, and one person's record cannot be
 * opened with another person's key. Every write uses a fresh random 12-byte IV;
 * the GCM tag rejects any change to the ciphertext.
 */

export interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
  savedAt: number;
}

const DEV_LABEL = "scammers-view/dev-only/scan-store-key";

type Env = Record<string, string | undefined>;

/**
 * The master key, or null when the feature must stay off.
 * Production needs SCAN_STORE_KEY; development may derive one from AUTH_SECRET.
 */
export function resolveMasterKey(env: Env = process.env): Buffer | null {
  const raw = env.SCAN_STORE_KEY?.trim();
  if (raw) {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  }
  if (env.NODE_ENV === "development" && env.AUTH_SECRET) {
    return Buffer.from(hkdfSync("sha256", Buffer.from(env.AUTH_SECRET, "utf8"), Buffer.alloc(0), DEV_LABEL, 32));
  }
  return null;
}

const norm = (email: string) => email.trim().toLowerCase();

/** Record name for this person: no email in it, stable for the same key. */
export function recordKeyFor(master: Buffer, email: string): string {
  const idKey = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "sv-scan-record-id-v1", 32));
  return `scan-${createHmac("sha256", idKey).update(norm(email)).digest("hex").slice(0, 40)}`;
}

/** Per-person AES-256 key. */
export function deriveUserKey(master: Buffer, email: string): Buffer {
  const e = norm(email);
  return Buffer.from(hkdfSync("sha256", master, Buffer.from(e, "utf8"), `sv-scan-data-v1:${e}`, 32));
}

/** gzip, then AES-256-GCM. The record name is bound in as associated data. */
export function seal(value: unknown, master: Buffer, email: string, savedAt: number): Envelope {
  const key = deriveUserKey(master, email);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`v1|${recordKeyFor(master, email)}`, "utf8"));
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(value), "utf8"))), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: body.toString("base64"), savedAt };
}

/** Throws when the envelope was changed, is malformed, or belongs to someone else. */
export function open<T = unknown>(env: Envelope, master: Buffer, email: string): T {
  if (!env || env.v !== 1 || typeof env.iv !== "string" || typeof env.tag !== "string" || typeof env.ciphertext !== "string") {
    throw new Error("bad envelope");
  }
  const iv = Buffer.from(env.iv, "base64");
  const tag = Buffer.from(env.tag, "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("bad envelope");
  const decipher = createDecipheriv("aes-256-gcm", deriveUserKey(master, email), iv);
  decipher.setAAD(Buffer.from(`v1|${recordKeyFor(master, email)}`, "utf8"));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(Buffer.from(env.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(gunzipSync(plain, { maxOutputLength: 8 * 1024 * 1024 }).toString("utf8")) as T;
}
