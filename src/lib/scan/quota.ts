import { createHash } from "node:crypto";
import { isAdmin, kvGet, kvPut } from "@/lib/admin/killSwitch";

/**
 * Daily cap on paid scans per signed-in person. A scan costs real money
 * (Gemini plus Apify), and a finished scan is kept on the person's device, so
 * a few fresh runs a day is plenty.
 *
 * The count is one small record per person per day in the same key-value
 * store as the kill switch. The key is a hash of the email, so the store
 * never holds an address. The owner is exempt. If the store cannot be
 * reached the scan is allowed: a storage outage must not lock people out.
 */

export const DAILY_SCANS = Math.max(1, Number(process.env.SCAN_DAILY_LIMIT) || 3);

export interface Quota {
  limit: number;
  used: number;
  remaining: number;
  /** The owner is never limited. */
  unlimited: boolean;
}

const day = () => new Date().toISOString().slice(0, 10);
const keyFor = (email: string) => `scans-${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24)}-${day()}`;

/** The store can lag a moment behind a write, so this instance also remembers what it counted. */
const local = new Map<string, number>();

export async function readQuota(email: string): Promise<Quota> {
  if (isAdmin(email)) return { limit: DAILY_SCANS, used: 0, remaining: DAILY_SCANS, unlimited: true };
  const key = keyFor(email);
  const rec = await kvGet<{ count?: number }>(key);
  const used = Math.max(0, Number(rec?.count) || 0, local.get(key) ?? 0);
  return { limit: DAILY_SCANS, used, remaining: Math.max(0, DAILY_SCANS - used), unlimited: false };
}

/** Count one scan. Returns false when today's allowance is already spent. */
export async function takeScan(email: string): Promise<{ ok: boolean; quota: Quota }> {
  const quota = await readQuota(email);
  if (quota.unlimited) return { ok: true, quota };
  if (quota.remaining <= 0) return { ok: false, quota };
  const key = keyFor(email);
  local.set(key, quota.used + 1);
  if (local.size > 5000) local.clear();
  await kvPut(key, { count: quota.used + 1 });
  return { ok: true, quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 } };
}
