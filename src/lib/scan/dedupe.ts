/**
 * Pure helpers for de-duplicating findings by meaning (no I/O; unit-testable).
 * classify() says whether a candidate is the same fact as an existing one:
 * "dup" (merge), "new" (emit), or "ambiguous" (ask the model).
 */

export interface Comparable {
  category: string;
  label: string;
  value: string;
  sourceType: string;
  imageUrl?: string;
  sourceUrl?: string;
}

const PLATFORM_HOSTS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(x|twitter)\.com$/, "x"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)bsky\.app$/, "bluesky"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)devpost\.com$/, "devpost"],
  [/(^|\.)facebook\.com$/, "facebook"],
  [/(^|\.)youtube\.com$/, "youtube"],
  [/(^|\.)medium\.com$/, "medium"],
  [/(^|\.)venmo\.com$/, "venmo"],
  [/(^|\.)cash\.app$/, "cashapp"],
  [/(^|\.)linktr\.ee$/, "linktree"],
];
const PLATFORM_WORDS: [RegExp, string][] = [
  [/instagram|\binsta\b|\big\b/i, "instagram"],
  [/tiktok/i, "tiktok"],
  [/\btwitter\b|\bx\b/i, "x"],
  [/github/i, "github"],
  [/linkedin/i, "linkedin"],
  [/bluesky|bsky/i, "bluesky"],
  [/reddit/i, "reddit"],
  [/devpost/i, "devpost"],
  [/venmo/i, "venmo"],
  [/cash ?app|cashtag/i, "cashapp"],
  [/facebook/i, "facebook"],
  [/youtube/i, "youtube"],
];

export function canonicalUrl(u: string): string {
  try {
    const url = new URL(/^https?:/i.test(u.trim()) ? u.trim() : "https://" + u.trim());
    return (url.hostname.replace(/^www\.|^m\./, "") + url.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

const looksLikeUrl = (v: string) => /^https?:\/\//i.test(v) || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(v);

/** Platform + handle for handle-like findings, e.g. {platform:"instagram", handle:"jdoe"}. */
export function handleKey(f: Comparable): { platform: string; handle: string } | null {
  const v = f.value.trim();
  if (looksLikeUrl(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)) {
    const c = canonicalUrl(v);
    const host = c.split("/")[0];
    const path = c.split("/").slice(1).filter(Boolean);
    for (const [re, p] of PLATFORM_HOSTS) {
      if (re.test(host)) {
        const seg = (p === "bluesky" && path[0] === "profile" ? path[1] : p === "venmo" && path[0] === "u" ? path[1] : path[0]) ?? "";
        return seg ? { platform: p, handle: seg.replace(/^@|^\$/, "").toLowerCase() } : null;
      }
    }
    return { platform: "site", handle: c };
  }
  const handle = v.replace(/^[@$]/, "").toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(handle)) return null;
  for (const [re, p] of PLATFORM_WORDS) if (re.test(f.label)) return { platform: p, handle };
  if (/^\$/.test(v)) return { platform: "cashapp", handle };
  return { platform: f.sourceType || "unknown", handle };
}

const STOP = new Set(["the", "of", "at", "a", "an", "and", "in", "for", "on", "to", "my", "her", "his", "their"]);
const SUFFIX = new Set(["university", "univ", "college", "school", "inc", "llc", "ltd", "corp", "corporation", "company", "co", "institute", "technologies", "technology", "labs", "high", "hs", "usa", "us"]);

export function tokens(v: string): string[] {
  return v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9@.\s]+/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

function initials(v: string): string {
  return v
    .split(/[\s-]+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()) && /^[A-Za-z]/.test(w))
    .map((w) => w[0].toLowerCase())
    .join("");
}

function isAcronymOf(a: string, b: string): boolean {
  const s = a.trim();
  if (!/^[A-Za-z&]{2,7}$/.test(s) || /\s/.test(s)) return false;
  const ini = initials(b);
  return ini.length >= 2 && ini === s.toLowerCase().replace(/&/g, "");
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Exact key: same category + canonical value (handles keyed by platform+handle, photos by image URL). */
export function exactKey(f: Comparable): string {
  if (f.category === "photo") return `photo|${canonicalUrl(f.imageUrl ?? f.value)}`;
  // One finding per public video post (captions can repeat across videos).
  if (f.category === "video") return `video|${canonicalUrl(f.sourceUrl ?? f.value)}`;
  if (f.category === "email") return `email|${f.value.trim().toLowerCase()}`;
  if (f.category === "handle") {
    const h = handleKey(f);
    if (h) return `handle|${h.platform}|${h.handle}`;
  }
  if (looksLikeUrl(f.value)) return `${f.category}|${canonicalUrl(f.value)}`;
  return `${f.category}|${tokens(f.value).join(" ")}`;
}

export type Verdict = "dup" | "new" | "ambiguous";

/** Rule-based comparison of two findings of the same category. */
export function classify(a: Comparable, b: Comparable): Verdict {
  if (a.category !== b.category) return "new";
  if (exactKey(a) === exactKey(b)) return "dup";
  switch (a.category) {
    case "photo":
    case "video":
    case "email":
      return "new";
    case "phone": {
      const d = (s: string) => s.replace(/\D/g, "").slice(-10);
      const x = d(a.value), y = d(b.value);
      if (x.length >= 7 && y.length >= 7) return x.endsWith(y) || y.endsWith(x) ? "dup" : "new";
      return "ambiguous";
    }
    case "handle": {
      const x = handleKey(a), y = handleKey(b);
      if (x && y) {
        if (x.handle === y.handle && (x.platform === y.platform || x.platform === "unknown" || y.platform === "unknown")) return "dup";
        return "new";
      }
      return "ambiguous";
    }
  }
  if (isAcronymOf(a.value, b.value) || isAcronymOf(b.value, a.value)) return "dup";
  const ta = tokens(a.value), tb = tokens(b.value);
  const j = jaccard(ta, tb);
  if (j >= 0.8) return "dup";
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const contained = small.length > 0 && small.every((t) => big.includes(t));
  if (contained) {
    const extra = big.filter((t) => !small.includes(t));
    if (extra.every((t) => SUFFIX.has(t))) return "dup";
    return "ambiguous";
  }
  if (j >= 0.3) return "ambiguous";
  // Same label and short values often restate one fact ("Hometown: Atlanta" vs "Atlanta, GA").
  if (a.label.toLowerCase() === b.label.toLowerCase() && ta.length && tb.length && ta[0] === tb[0]) return "ambiguous";
  return "new";
}

/** Merge preference: richer (more specific) value wins when it extends the other. */
export function richer(a: string, b: string): string {
  const ta = tokens(a), tb = tokens(b);
  if (tb.length > ta.length && ta.every((t) => tb.includes(t))) return b;
  if (/^[A-Za-z&]{2,7}$/.test(a.trim()) && isAcronymOf(a, b)) return b;
  return a;
}

export const ANCHOR_RANK: Record<string, number> = { unconfirmed: 0, school: 1, github: 2, email: 3, face: 4 };

const GENERIC_INTERESTS = new Set([
  "programming", "coding", "software", "software development", "software engineering", "web development", "computer science",
  "technology", "tech", "open source", "javascript", "python", "typescript", "java", "c++", "react", "ai", "machine learning",
  "artificial intelligence", "data science", "music", "sports", "travel", "reading", "gaming", "games", "movies", "art", "design",
]);

/** Interests only count when specific enough to be used in a pretext. */
export function isUsefulInterest(value: string, riskWeight: number): boolean {
  const v = value.trim().toLowerCase();
  if (GENERIC_INTERESTS.has(v)) return false;
  if (tokens(v).length === 1 && v.length < 5) return false;
  return riskWeight >= 3;
}
