/**
 * Content rails applied to every model-written string: links become non-functional
 * .example placeholders, phone numbers become 555-01xx, payment handles and wallets
 * are neutralised. Applied identically to bodies and quotes.
 */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const BARE_DOMAIN_RE =
  /\b(?<![@\w.-])([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|edu|io|co|ly|me|info|biz|app|link|xyz|site|online|us|gov|page|ai))(\/[^\s<>"')\]]*)?/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
const CASHTAG_RE = /(^|[\s(])\$(?=[A-Za-z])[A-Za-z][A-Za-z0-9_-]{1,30}\b/g;
const WALLET_RE = /\b(?:0x[a-fA-F0-9]{20,}|bc1[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g;

function isExample(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "example" || h.endsWith(".example");
}

function placeholderHost(host: string): string {
  const base = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 24);
  return `${base || "portal"}.example`;
}

function fixUrl(raw: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (isExample(u.hostname)) return raw;
    return `https://${placeholderHost(u.hostname)}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return "https://link-placeholder.example";
  }
}

export function sanitize(text: string): string {
  let out = text.replace(URL_RE, (m) => fixUrl(m));
  out = out.replace(EMAIL_RE, (m, host: string) =>
    isExample(host) ? m : `${m.split("@")[0]}@${placeholderHost(host)}`,
  );
  out = out.replace(BARE_DOMAIN_RE, (m, host: string) => (isExample(host) ? m : placeholderHost(host)));
  out = out.replace(PHONE_RE, "555-0142");
  out = out.replace(CASHTAG_RE, (_m, pre: string) => `${pre}example-handle`);
  out = out.replace(WALLET_RE, "[wallet removed]");
  return out;
}

/** Forces a fictional sender: SMS numbers become 555-01xx, email hosts end in .example. */
export function fictionalAddress(kind: "sms" | "email", raw: string): string {
  if (kind === "sms") return "555-0199";
  const at = raw.indexOf("@");
  const local = (at > 0 ? raw.slice(0, at) : "notice").replace(/[^a-z0-9._-]/gi, "").slice(0, 24) || "notice";
  const host = at > 0 ? raw.slice(at + 1) : "";
  return `${local}@${isExample(host) ? host : placeholderHost(host || "notice")}`;
}

/** Finds the exact substring of body that `quote` refers to (exact, case-insensitive, whitespace-tolerant). */
export function locateQuote(body: string, quote: string): string | null {
  const q = quote.trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  if (q.length < 2) return null;
  if (body.includes(q)) return q;
  const i = body.toLowerCase().indexOf(q.toLowerCase());
  if (i >= 0) return body.slice(i, i + q.length);
  const pattern = q
    .split(/\s+/)
    .map((w) =>
      w
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/'/g, "['‘’]")
        .replace(/"/g, '["“”]')
        .replace(/-/g, "[-–—]"),
    )
    .join("\\s+");
  try {
    return body.match(new RegExp(pattern, "i"))?.[0] ?? null;
  } catch {
    return null;
  }
}
