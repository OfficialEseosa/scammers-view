import { cached, emailKey } from "./cache";
import { checkHibp } from "./hibp";
import { ProviderError, type BreachOutcome } from "./types";
import { checkXon } from "./xon";

export type { BreachInfo, BreachOutcome, BreachProvider, BreachResult } from "./types";

/**
 * Check one address. The caller passes the signed-in subject's email, never request input.
 * Provider order: HIBP when HIBP_API_KEY is set, else XposedOrNot unless BREACH_FALLBACK=off, else not_configured.
 * Failures are not cached. The address is never logged.
 */
export async function checkBreaches(email: string): Promise<BreachOutcome> {
  const key = process.env.HIBP_API_KEY?.trim();
  const fallbackOn = (process.env.BREACH_FALLBACK ?? "").toLowerCase() !== "off";
  if (!key && !fallbackOn) return { status: "not_configured" };
  try {
    const result = await cached(`${key ? "hibp" : "xon"}:${emailKey(email)}`, () => (key ? checkHibp(email, key) : checkXon(email)));
    return { status: "ok", result };
  } catch (e) {
    if (e instanceof ProviderError) {
      return e.kind === "rate_limited"
        ? { status: "rate_limited", retryAfterSeconds: e.retryAfterSeconds }
        : { status: "error", message: e.message };
    }
    return { status: "error", message: "Breach check failed." };
  }
}
