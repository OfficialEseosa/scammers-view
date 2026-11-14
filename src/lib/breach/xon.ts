import { normaliseXon } from "./normalise";
import { ProviderError, type BreachResult } from "./types";

const BASE = "https://api.xposedornot.com/v1/breach-analytics";

// Free tier is 2/s, 25/hour, 100/day per IP. Stay under it locally.
const HOURLY = 20;
const calls: number[] = [];

function wait(): number {
  const now = Date.now();
  while (calls.length && now - calls[0] > 3_600_000) calls.shift();
  return calls.length >= HOURLY ? Math.ceil((calls[0] + 3_600_000 - now) / 1000) : 0;
}

/** Docs: https://xposedornot.com/api_doc. Keyless; attribution to XposedOrNot is shown in the UI. */
export async function checkXon(email: string, fetchImpl: typeof fetch = fetch): Promise<BreachResult> {
  const w = wait();
  if (w > 0) throw new ProviderError("Rate limited.", "rate_limited", w);
  calls.push(Date.now());
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}?email=${encodeURIComponent(email.trim())}`, {
      headers: { "user-agent": "scammers-view-breach-check", accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ProviderError("Could not reach the breach service.", "error");
  }
  const checkedAt = new Date().toISOString();
  if (res.status === 404) return { breaches: [], checkedAt, provider: "xposedornot" };
  if (res.status === 429) throw new ProviderError("Rate limited.", "rate_limited", 900);
  if (!res.ok) throw new ProviderError(`Breach service returned ${res.status}.`, "error");
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ProviderError("Unreadable response from the breach service.", "error");
  }
  return { breaches: normaliseXon(json), checkedAt, provider: "xposedornot" };
}
