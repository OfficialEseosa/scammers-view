export type BreachProvider = "hibp" | "xposedornot";

export interface BreachInfo {
  name: string;
  domain?: string;
  /** ISO date (YYYY-MM-DD). Providers that only give a year use YYYY-01-01. */
  date: string;
  /** Types of data exposed, e.g. "Passwords". Never the data itself. */
  dataClasses: string[];
  verified?: boolean;
}

export interface BreachResult {
  breaches: BreachInfo[];
  /** ISO timestamp. */
  checkedAt: string;
  provider: BreachProvider;
}

/** What the API and the UI exchange. Never carries the email. */
export type BreachOutcome =
  | { status: "ok"; result: BreachResult }
  | { status: "not_configured" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "error"; message: string };

export const PROVIDER_NAME: Record<BreachProvider, { name: string; url: string }> = {
  hibp: { name: "Have I Been Pwned", url: "https://haveibeenpwned.com" },
  xposedornot: { name: "XposedOrNot", url: "https://xposedornot.com" },
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "rate_limited" | "error",
    readonly retryAfterSeconds = 60,
  ) {
    super(message);
  }
}
