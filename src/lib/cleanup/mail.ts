import { BROKER_SITES, hostOf, type BrokerSite } from "./sites";

/** RFC 2822 message, base64url-encoded, for the Gmail API's messages.send. */
export function buildRawEmail(to: string, subject: string, body: string): string {
  const safeSubject = subject.replace(/[\r\n]+/g, " ").slice(0, 200);
  const encodedSubject = /^[\x20-\x7e]*$/.test(safeSubject) ? safeSubject : `=?UTF-8?B?${Buffer.from(safeSubject, "utf8").toString("base64")}?=`;
  const msg = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body.replace(/\r?\n/g, "\r\n"),
  ].join("\r\n");
  return Buffer.from(msg, "utf8").toString("base64url");
}

export function brokerForEmail(address: string): BrokerSite | undefined {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  return BROKER_SITES.find((b) => domain === b.domain || domain.endsWith(`.${b.domain}`));
}

const CONFIRM_WORDS = /confirm|verif|opt.?out|remov|suppress|validat|activate|complete/i;

/** Confirmation links in a broker's email: on the broker's own site, with a confirm-like path or label. */
export function confirmationLinks(text: string, broker: BrokerSite): string[] {
  const out = new Set<string>();
  const re = /https?:\/\/[^\s"'<>()]+/g;
  for (const m of text.matchAll(re)) {
    const url = m[0].replace(/[.,;)\]]+$/, "").replace(/&amp;/g, "&");
    const h = hostOf(url);
    if (!(h === broker.domain || h.endsWith(`.${broker.domain}`))) continue;
    // Only URLs whose path/query themselves look like a confirmation (never nearby prose).
    if (!CONFIRM_WORDS.test(url)) continue;
    out.add(url.startsWith("http://") ? url.replace("http://", "https://") : url);
    if (out.size >= 3) break;
  }
  return [...out];
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Picks the most removal-related address on a privacy page that belongs to the site itself. */
export function pickPrivacyEmail(html: string, domain: string): string | null {
  const found = [...new Set((html.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))].filter((e) => {
    const d = e.split("@")[1];
    return d === domain || d.endsWith(`.${domain}`);
  });
  const rank = (e: string) => (/privacy|optout|opt-out|remov|suppress/.test(e) ? 0 : /support|help|legal|compliance/.test(e) ? 1 : 2);
  found.sort((a, b) => rank(a) - rank(b));
  return found[0] ?? null;
}
