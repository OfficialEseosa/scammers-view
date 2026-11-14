import { extractLinks, extractNumbers, formatNumber } from "./extract";
import { ftcIndex } from "./ftc";
import { safeBrowsingLookup, type LinkThreat } from "./safeBrowsing";

/*
 * "Has this been reported?" lookups for the links and phone numbers in a message.
 * Links go to Google Safe Browsing (only the links, never the message). Numbers are matched
 * against the FTC's public complaint files held in memory, so they leave the server not at all.
 * Every lookup is best effort: a missing key, a slow service or an error just means "not checked".
 */

export type { LinkThreat } from "./safeBrowsing";

export interface ReportedLink {
  url: string;
  threat: LinkThreat;
}

export interface ReportedNumber {
  number: string;
  display: string;
  reports: number;
  robocalls: number;
  topSubject: string;
}

export interface Reported {
  links: ReportedLink[];
  numbers: ReportedNumber[];
  /** What was looked up. `false` means that lookup was unavailable this time. */
  checked: { links: number | false; numbers: number | false };
}

export const LOOKUP_TIMEOUT_MS = 3000;
const CACHE_MS = 60 * 60 * 1000;
const CACHE_MAX = 5000;

type LinkCache = Map<string, { threat: LinkThreat | null; expiresAt: number }>;
const g = globalThis as unknown as { __svLinkCache?: LinkCache };
const linkCache: LinkCache = (g.__svLinkCache ??= new Map());

export interface ReputationOptions {
  safeBrowsingKey?: string;
  /** FTC number lookups; on unless FTC_LOOKUPS=off. */
  ftc?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms).unref?.())]);
}

async function checkLinks(urls: string[], key: string, o: Required<Pick<ReputationOptions, "timeoutMs" | "fetchImpl" | "now">>) {
  const flagged: ReportedLink[] = [];
  const todo: string[] = [];
  for (const url of urls) {
    const hit = linkCache.get(url);
    if (hit && hit.expiresAt > o.now) {
      if (hit.threat) flagged.push({ url, threat: hit.threat });
    } else todo.push(url);
  }
  if (todo.length) {
    const found = await safeBrowsingLookup(todo, key, AbortSignal.timeout(o.timeoutMs), o.fetchImpl);
    if (linkCache.size > CACHE_MAX) linkCache.clear();
    for (const url of todo) {
      const threat = found.get(url) ?? null;
      linkCache.set(url, { threat, expiresAt: o.now + CACHE_MS });
      if (threat) flagged.push({ url, threat });
    }
  }
  return flagged;
}

async function checkNumbers(numbers: string[], fetchImpl: typeof fetch) {
  const index = await ftcIndex(fetchImpl);
  if (!index) throw new Error("FTC data unavailable");
  const flagged: ReportedNumber[] = [];
  for (const number of numbers) {
    const r = index.get(number);
    if (r) flagged.push({ number, display: formatNumber(number), ...r });
  }
  return flagged.sort((a, b) => b.reports - a.reports);
}

export async function checkReputation(text: string, opts: ReputationOptions = {}): Promise<Reported> {
  const key = opts.safeBrowsingKey ?? process.env.SAFE_BROWSING_API_KEY?.trim();
  const ftcOn = opts.ftc ?? process.env.FTC_LOOKUPS?.trim().toLowerCase() !== "off";
  const o = { timeoutMs: opts.timeoutMs ?? LOOKUP_TIMEOUT_MS, fetchImpl: opts.fetchImpl ?? fetch, now: opts.now ?? Date.now() };

  const urls = extractLinks(text);
  const numbers = extractNumbers(text);
  const result: Reported = { links: [], numbers: [], checked: { links: false, numbers: false } };

  const [links, nums] = await Promise.all([
    urls.length && key ? withTimeout(checkLinks(urls, key, o), o.timeoutMs).catch(() => "timeout" as const) : null,
    numbers.length && ftcOn ? withTimeout(checkNumbers(numbers, o.fetchImpl), o.timeoutMs).catch(() => "timeout" as const) : null,
  ]);
  if (!urls.length) result.checked.links = 0;
  else if (Array.isArray(links)) {
    result.links = links;
    result.checked.links = urls.length;
  }
  if (!numbers.length) result.checked.numbers = 0;
  else if (Array.isArray(nums)) {
    result.numbers = nums;
    result.checked.numbers = numbers.length;
  }
  return result;
}

export function isReported(r: Reported): boolean {
  return r.links.length > 0 || r.numbers.length > 0;
}

/** Test hook. */
export function __clearLinkCacheForTests() {
  linkCache.clear();
}
