import { z } from "zod";
import { AttackChain, ExposureScore, Finding, SourceType } from "../types";
import { kvDelete, kvGet, kvPut } from "../admin/killSwitch";
import { open, recordKeyFor, resolveMasterKey, seal, type Envelope } from "./crypto";

/**
 * A finished scan saved to the signed-in person's account, encrypted (see ./crypto).
 * Only what the results need: findings, chains, score, sources and the "not me" ids.
 * No face data, no voice data, no tokens.
 */

export const STORE_NAME = "scammers-view-scans";
export const MAX_FINDINGS = 400;
export const MAX_CHAINS = 120;
export const MAX_BODY_BYTES = 1_500_000;

const SourceStatus = z.object({
  status: z.enum(["running", "done"]),
  count: z.number().int().min(0),
  query: z.string().max(500).optional(),
});

export const SavedScan = z.object({
  savedAt: z.number().int().positive(),
  findings: z.array(Finding).min(1).max(MAX_FINDINGS),
  chains: z.array(AttackChain).max(MAX_CHAINS),
  score: ExposureScore.nullable(),
  sources: z.partialRecord(SourceType, SourceStatus),
  notMeIds: z.array(z.string().max(200)).max(MAX_FINDINGS).optional(),
});
export type SavedScan = z.infer<typeof SavedScan>;

export interface Kv {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<boolean>;
  del(key: string): Promise<boolean>;
}

export const serverKv: Kv = {
  get: (k) => kvGet(k, STORE_NAME),
  put: (k, v) => kvPut(k, v, STORE_NAME),
  del: (k) => kvDelete(k, STORE_NAME),
};

type Env = Record<string, string | undefined>;

/** Master key when both the secret and a store are available; otherwise the feature is off. */
export function storeKey(env: Env = process.env): Buffer | null {
  if (!(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_KV_SECRET)) return null;
  return resolveMasterKey(env);
}

export type ParseResult = { ok: true; scan: SavedScan } | { ok: false; error: string };

/** Size cap, then schema. `raw` is the request body text. */
export function parseSavedScan(raw: string): ParseResult {
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return { ok: false, error: "too_large" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "bad_json" };
  }
  const parsed = SavedScan.safeParse(json);
  return parsed.success ? { ok: true, scan: parsed.data } : { ok: false, error: "invalid" };
}

export async function loadSaved(email: string, master: Buffer, kv: Kv = serverKv): Promise<SavedScan | null> {
  const env = await kv.get<Envelope>(recordKeyFor(master, email));
  if (!env) return null;
  try {
    const parsed = SavedScan.safeParse(open(env, master, email));
    return parsed.success ? parsed.data : null;
  } catch {
    // Tampered, wrong key or rotated secret: treat as nothing saved.
    return null;
  }
}

export async function storeSaved(email: string, scan: SavedScan, master: Buffer, kv: Kv = serverKv): Promise<boolean> {
  return kv.put(recordKeyFor(master, email), seal(scan, master, email, scan.savedAt));
}

export async function deleteSaved(email: string, master: Buffer, kv: Kv = serverKv): Promise<boolean> {
  return kv.del(recordKeyFor(master, email));
}
