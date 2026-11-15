import { fetchPage, type PageData } from "@/lib/scan/pageFetch";
import { hostOf } from "./sites";

/*
 * Finds where to write to a site that publishes the student's details: the listing page itself,
 * then the site's own privacy and contact pages. Plain public GETs through the guarded fetcher.
 * Nothing is sent from here; the student approves the address and the text before any email goes.
 */

export interface SiteContact {
  address: string;
  /** The page the address was read from. */
  page: string;
  /** True when the address is on the site's own domain. */
  sameSite: boolean;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
const JUNK = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|domain|email|yourdomain|sentry|wixpress)\.|@[0-9.]+$|^(no-?reply|donotreply|do-not-reply|mailer-daemon|postmaster)@/i;
const CONTACT_LINK = /privacy|contact|about|legal|terms|imprint|impressum|dmca|removal|opt.?out|masthead|staff|editor/i;
const GUESS_PATHS = ["/contact", "/privacy", "/about"];
/** Published by some sites as their official point of contact (RFC 9116). */
const SECURITY_TXT = "/.well-known/security.txt";
const MAX_PAGES = 8;

/** "name [at] site (dot) com" and similar spellings, written back as a plain address. */
export function plainAddresses(text: string): string {
  return text
    .replace(/\s*[\[({<]\s*(?:at|@)\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[\[({<]\s*(?:dot|\.)\s*[\])}>]\s*/gi, ".")
    .replace(/([A-Z0-9._%+-]+)\s+(?:\bAT\b|\(at\))\s+([A-Z0-9-]+)\s+\bDOT\b\s+([A-Z]{2,})/g, "$1@$2.$3");
}

/** The part of a host that names the site: the last two labels, or three under a shared suffix like co.uk. */
export function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const two = parts.slice(-2).join(".");
  return PUBLIC_SUFFIX.has(two) ? parts.slice(-3).join(".") : two;
}

/** True when an email domain and a site host belong together (same host, or one is a subdomain of the other). */
export function sameSite(emailDomain: string, host: string): boolean {
  const d = emailDomain.toLowerCase().replace(/^www\./, "");
  const h = host.toLowerCase().replace(/^www\./, "");
  if (!d.includes(".") || !h.includes(".")) return false;
  if (d === h || h.endsWith(`.${d}`) || d.endsWith(`.${h}`)) return d.split(".").length >= 2 && !PUBLIC_SUFFIX.has(d) && !PUBLIC_SUFFIX.has(h);
  return false;
}

/** Shared domains where "same domain" says nothing about who owns the mailbox. */
const PUBLIC_SUFFIX = new Set(["co.uk", "com.au", "co.in", "co.nz", "co.za", "com.br", "github.io", "blogspot.com", "wordpress.com", "medium.com", "substack.com", "wixsite.com", "weebly.com", "netlify.app", "vercel.app", "pages.dev"]);

function rank(address: string, same: boolean): number {
  const local = address.split("@")[0];
  const kind = /privacy|dpo|gdpr|optout|opt-out|remov|dmca|legal|abuse|compliance/.test(local) ? 0 : /contact|support|help|info|admin|webmaster|editor|hello|office|security|news|press/.test(local) ? 1 : 2;
  return kind + (same ? 0 : 3);
}

/** Addresses written on a page, best first: privacy inboxes on the site's own domain lead. */
export function emailsOnPage(text: string, host: string, page: string): SiteContact[] {
  const seen = new Set<string>();
  const out: SiteContact[] = [];
  for (const m of plainAddresses(text).match(EMAIL_RE) ?? []) {
    const address = m.toLowerCase().replace(/\.+$/, "");
    if (seen.has(address) || JUNK.test(address) || address.length > 120) continue;
    seen.add(address);
    out.push({ address, page, sameSite: sameSite(address.split("@")[1], host) });
  }
  return out.sort((a, b) => rank(a.address, a.sameSite) - rank(b.address, b.sameSite));
}

/** Privacy, contact and about pages worth reading on the listing's own site. */
export function contactPages(listingUrl: string, links: { url: string; text: string }[] = []): string[] {
  let origin: string;
  let host: string;
  try {
    const u = new URL(listingUrl);
    origin = u.origin;
    host = u.hostname.toLowerCase();
  } catch {
    return [];
  }
  const base = baseDomain(host);
  const linked = links
    .filter((l) => {
      try {
        const u = new URL(l.url);
        // The site's other subdomains count: a story on news.school.example links to www.school.example/contact.
        return u.protocol === "https:" && baseDomain(u.hostname) === base && (CONTACT_LINK.test(u.pathname) || CONTACT_LINK.test(l.text));
      } catch {
        return false;
      }
    })
    .map((l) => l.url.split("#")[0])
    .sort((a, b) => Number(!/contact|privacy/i.test(a)) - Number(!/contact|privacy/i.test(b)));
  const guesses = [...GUESS_PATHS.map((p) => origin + p), origin + SECURITY_TXT];
  // Linked pages first, but always leave room for the guessed ones.
  return [...new Set([...linked.slice(0, MAX_PAGES - 1 - guesses.length), ...guesses])].filter((u) => u !== listingUrl).slice(0, MAX_PAGES - 1);
}

type Fetcher = (url: string, signal: AbortSignal) => Promise<PageData | null>;

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; list: SiteContact[] }>();

/** Reads the listing page and the site's contact pages, and returns the addresses found, best first. */
export async function findSiteContact(listingUrl: string, signal: AbortSignal, fetcher: Fetcher = fetchPage, now = Date.now()): Promise<SiteContact[]> {
  const host = hostOf(listingUrl);
  if (!host) return [];
  const hit = cache.get(listingUrl);
  if (fetcher === fetchPage && hit && now - hit.at < CACHE_MS) return hit.list;

  const read = (p: PageData | null, url: string) => (p ? emailsOnPage([p.text, p.description, ...(p.mailto ?? [])].join("\n"), host, p.url || url) : []);
  const first = await fetcher(listingUrl, signal).catch(() => null);
  const pages = contactPages(listingUrl, [...(first?.contactLinks ?? []), ...(first?.links ?? [])]);
  const rest = await Promise.all(pages.map((u) => fetcher(u, signal).then((p) => read(p, u)).catch(() => [] as SiteContact[])));

  const seen = new Set<string>();
  const list = [...read(first, listingUrl), ...rest.flat()]
    .filter((c) => (seen.has(c.address) ? false : (seen.add(c.address), true)))
    .sort((a, b) => rank(a.address, a.sameSite) - rank(b.address, b.sameSite))
    .slice(0, 6);
  if (fetcher === fetchPage) {
    if (cache.size > 200) cache.clear();
    cache.set(listingUrl, { at: now, list });
  }
  return list;
}

/** May a removal request about this listing go to this address? Its own domain, or an address the site itself publishes. */
export async function recipientAllowed(to: string, listingUrl: string, signal: AbortSignal, fetcher: Fetcher = fetchPage): Promise<boolean> {
  const host = hostOf(listingUrl);
  const domain = to.split("@")[1]?.toLowerCase() ?? "";
  if (!host || !domain) return false;
  if (sameSite(domain, host)) return true;
  return (await findSiteContact(listingUrl, signal, fetcher)).some((c) => c.address === to.toLowerCase());
}
