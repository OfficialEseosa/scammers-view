/**
 * Per-IP caps for the public, sign-in-free checker (in memory, rolling hour).
 * Screenshots cost a Gemini call each, so they get a much smaller allowance.
 */

const WINDOW_MS = 60 * 60 * 1000;
export const CHECKS_PER_HOUR = { text: 60, image: 15, agent: 400, browser: 30, verify: 60 } as const;
export type CheckKind = keyof typeof CHECKS_PER_HOUR;

const MAX_KEYS = 10_000;
const hits = new Map<string, number[]>();

function prune(now: number) {
  for (const [k, ts] of hits) if (!ts.some((t) => now - t < WINDOW_MS)) hits.delete(k);
}

/** Records one use; returns false (and records nothing) when the caller is over the hourly cap. */
export function takeCheck(kind: CheckKind, ip: string, now = Date.now()): boolean {
  if (hits.size > MAX_KEYS) prune(now);
  const key = `${kind}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= CHECKS_PER_HOUR[kind]) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Best-effort client address: the first hop the proxy saw, else a shared bucket. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function __resetCheckLimitsForTests() {
  hits.clear();
}
