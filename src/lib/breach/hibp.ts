import { normaliseHibp } from "./normalise";
import { ProviderError, type BreachResult } from "./types";

const BASE = "https://haveibeenpwned.com/api/v3/breachedaccount/";
// Generic, no personal details. HIBP returns 403 without a user agent.
const USER_AGENT = "scammers-view-breach-check";

/** Docs: https://haveibeenpwned.com/API/v3#BreachesForAccount */
export async function checkHibp(email: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<BreachResult> {
  const url = `${BASE}${encodeURIComponent(email.trim())}?truncateResponse=false`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "hibp-api-key": apiKey, "user-agent": USER_AGENT, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ProviderError("Could not reach the breach service.", "error");
  }
  const checkedAt = new Date().toISOString();
  if (res.status === 404) return { breaches: [], checkedAt, provider: "hibp" };
  if (res.status === 429) {
    const secs = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    throw new ProviderError("Rate limited.", "rate_limited", Number.isFinite(secs) && secs > 0 ? secs : 60);
  }
  if (res.status === 401) throw new ProviderError("The breach service rejected the API key.", "error");
  if (!res.ok) throw new ProviderError(`Breach service returned ${res.status}.`, "error");
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ProviderError("Unreadable response from the breach service.", "error");
  }
  return { breaches: normaliseHibp(json), checkedAt, provider: "hibp" };
}
