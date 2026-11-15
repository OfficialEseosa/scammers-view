import { lookup } from "dns/promises";
import { isIP } from "net";
import { isAuthLikeUrl } from "./findings";

/**
 * Guarded fetcher for public pages: plain GET, no cookies, no credentials,
 * public hosts only, never auth/login/reset pages, never data brokers or
 * breach sites. Returns readable text plus image and link candidates.
 */

/** Never fetched: data brokers (search snippets only), breach/leak sites, identity providers. */
export const FETCH_BLOCKED = [
  "spokeo.com", "whitepages.com", "beenverified.com", "truepeoplesearch.com", "fastpeoplesearch.com",
  "radaris.com", "mylife.com", "intelius.com", "peoplefinders.com", "thatsthem.com", "truthfinder.com",
  "instantcheckmate.com", "peekyou.com", "nuwber.com", "clustrmaps.com", "familytreenow.com",
  "usphonebook.com", "searchpeoplefree.com", "peoplelooker.com", "411.com", "addresses.com",
  "rocketreach.co", "zoominfo.com", "contactout.com", "signalhire.com", "lusha.com", "apollo.io",
  "haveibeenpwned.com", "dehashed.com", "intelx.io", "leakcheck.io", "snusbase.com", "pastebin.com",
  "venmo.com", "cash.app", "paypal.me", "paypal.com",
  "accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com",
  "idmsa.apple.com", "okta.com", "auth0.com", "login.yahoo.com", "id.atlassian.com",
];

/** Login-walled to anonymous fetches; we only keep their public meta tags (og:*). */
const META_ONLY = ["instagram.com", "facebook.com", "linkedin.com", "tiktok.com", "x.com", "twitter.com", "threads.net"];

const hostMatches = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith("." + d));

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function urlAllowed(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "bad url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials in url" };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || (isIP(host) && isPrivateIp(host))) return { ok: false, reason: "private host" };
  if (hostMatches(host, FETCH_BLOCKED)) return { ok: false, reason: "blocked domain" };
  if (isAuthLikeUrl(url.href)) return { ok: false, reason: "auth-like page" };
  if (/\.(pdf|zip|png|jpe?g|gif|webp|mp4|mov|docx?|pptx?|xlsx?)$/i.test(url.pathname)) return { ok: false, reason: "not a web page" };
  return { ok: true, url };
}

export interface PageImage { url: string; alt: string; context: string }
export interface PageData {
  url: string;
  title: string;
  description: string;
  text: string;
  images: PageImage[];
  links: { url: string; text: string }[];
  metaOnly: boolean;
  /** Static fallbacks for JS-only sites: RSS/Atom feed link, and the origin (for sitemap.xml). */
  feedUrl?: string;
  /** Addresses in the page's mailto: links (they are not part of the readable text). */
  mailto?: string[];
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function meta(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "").trim() : "";
}

const MAX_BYTES = 1_500_000;
const MAX_TEXT = 18_000;

export async function fetchPage(rawUrl: string, signal: AbortSignal): Promise<PageData | null> {
  let current = rawUrl;
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    const check = urlAllowed(current);
    if (!check.ok) return null;
    // Resolve DNS and refuse private addresses (no fetching internal services).
    try {
      const addrs = await Promise.race([
        lookup(check.url.hostname, { all: true }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("dns timeout")), 4000)),
      ]);
      if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) return null;
    } catch {
      return null;
    }
    res = await fetch(check.url, {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      credentials: "omit",
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ScammersViewSelfScan/1.0; privacy self-audit)",
        Accept: "text/html,application/xhtml+xml;q=0.9,application/rss+xml;q=0.8,application/atom+xml;q=0.8,text/xml;q=0.7,text/plain;q=0.6",
        "Accept-Language": "en",
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, check.url).href;
      continue;
    }
    break;
  }
  if (!res || !res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml|text\/plain|xml/i.test(type)) return null;

  // Read with a byte cap.
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const html = new TextDecoder().decode(Buffer.concat(chunks));
  const base = new URL(current);
  const host = base.hostname.toLowerCase();
  const metaOnly = hostMatches(host, META_ONLY);

  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim() || meta(html, "og:title");
  const description = meta(html, "og:description") || meta(html, "description") || meta(html, "twitter:description");

  const abs = (u: string) => {
    try {
      return new URL(decode(u), base).href;
    } catch {
      return "";
    }
  };

  const images: PageImage[] = [];
  const seenImg = new Set<string>();
  const pushImg = (u: string, alt: string, context: string) => {
    const a = abs(u);
    if (!a || !/^https?:/.test(a) || seenImg.has(a)) return;
    if (/\.svg(\?|$)|sprite|favicon|logo|icon|badge|shields\.io|pixel|tracking|spacer|emoji/i.test(a)) return;
    seenImg.add(a);
    images.push({ url: a, alt: alt.slice(0, 160), context: context.slice(0, 200) });
  };
  for (const k of ["og:image", "og:image:url", "twitter:image"]) {
    const v = meta(html, k);
    if (v) pushImg(v, "page preview image", title);
  }

  // Static data that JS-only sites still ship: JSON-LD, Next.js/Nuxt payloads.
  const structured: string[] = [];
  const collectStrings = (v: unknown, depth = 0) => {
    if (depth > 12 || structured.length > 400) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length >= 3 && t.length <= 600 && !/^(https?:)?\/\/|^[a-z0-9_-]+$|^[{[]|\.(js|css|png|jpe?g|svg|webp)$/i.test(t) && /\s/.test(t)) structured.push(t);
    } else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, depth + 1));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => collectStrings(x, depth + 1));
  };
  for (const m of html.matchAll(/<script[^>]+(?:type=["']application\/ld\+json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectStrings(JSON.parse(m[1]));
    } catch {
      /* not JSON */
    }
  }
  const feedHref = html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1];
  const isXml = /xml/i.test(type) && !/xhtml/i.test(type);
  const mailto = [...new Set([...html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => decode(m[1]).trim()))].slice(0, 20);

  let text = "";
  const links: { url: string; text: string }[] = [];
  if (isXml) {
    // RSS/Atom feed or sitemap: titles/descriptions as text, <link>/<loc> as links.
    for (const m of html.matchAll(/<(?:loc|link)[^>]*>([^<]+)<\/(?:loc|link)>|<link[^>]+href=["']([^"']+)["']/gi)) {
      const u = abs(m[1] ?? m[2] ?? "");
      if (/^https?:/.test(u)) links.push({ url: u, text: "" });
      if (links.length >= 80) break;
    }
    text = decode(html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  } else if (!metaOnly) {
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
    for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const src = tag.match(/\s(?:src|data-src)=["']([^"']+)["']/i)?.[1];
      if (!src || src.startsWith("data:")) continue;
      const w = Number(tag.match(/\swidth=["']?(\d+)/i)?.[1] ?? 0);
      if (w && w < 64) continue;
      const alt = decode(tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? "");
      const around = decode(body.slice(Math.max(0, (m.index ?? 0) - 200), (m.index ?? 0) + 300).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
      pushImg(src, alt, around);
      if (images.length >= 30) break;
    }
    const seenLink = new Set<string>();
    for (const m of body.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const u = abs(m[1]);
      if (!/^https?:/.test(u) || seenLink.has(u)) continue;
      seenLink.add(u);
      links.push({ url: u, text: decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 80) });
      if (links.length >= 80) break;
    }
    text = decode(
      body
        .replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim()
      .slice(0, MAX_TEXT);
  }
  if (structured.length) text = `${text}\n\nSTRUCTURED DATA ON PAGE:\n${[...new Set(structured)].join("\n")}`.trim().slice(0, MAX_TEXT);
  if (!text && !description && images.length === 0 && mailto.length === 0) return null;
  return { url: current, title, description, text, images: images.slice(0, 25), links, metaOnly, feedUrl: feedHref ? abs(feedHref) : undefined, mailto: mailto.length ? mailto : undefined };
}
