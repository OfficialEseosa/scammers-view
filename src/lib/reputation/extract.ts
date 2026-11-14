/*
 * Pulls links and US phone numbers out of a message, so only those (never the message) go to
 * the reputation lookups.
 */

export const MAX_EACH = 10;

const COMMON_TLDS =
  "com|net|org|info|biz|io|co|us|edu|gov|app|xyz|top|site|online|club|shop|live|link|click|me|ly|gl|cc|tk|ml|ga|cf|gq|ru|cn|uk|ca|de";
const URL_RE = new RegExp(
  String.raw`\b(?:https?:\/\/[^\s<>"'()]+|www\.[^\s<>"'()]+|(?:[a-z0-9-]+\.)+(?:${COMMON_TLDS})\/[^\s<>"'()]*|(?:[a-z0-9-]+\.)+(?:${COMMON_TLDS})\b)`,
  "gi",
);
const PHONE_RE = /(?<![\d-])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})(?![\d-])/g;
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** Normalised links (scheme added, trailing punctuation removed), first 10, no duplicates. */
export function extractLinks(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0].replace(TRAILING, "");
    if (m.index > 0 && text[m.index - 1] === "@") continue;
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    try {
      const u = new URL(url);
      if (!u.hostname.includes(".")) continue;
      out.add(u.href);
    } catch {
      continue;
    }
    if (out.size >= MAX_EACH) break;
  }
  return [...out];
}

/** US numbers as 10 digits, first 10, no duplicates. */
export function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PHONE_RE)) {
    out.add(`${m[1]}${m[2]}${m[3]}`);
    if (out.size >= MAX_EACH) break;
  }
  return [...out];
}

export function formatNumber(digits: string): string {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
