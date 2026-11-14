import type { Finding, IdentityAnchor, ScanSubject } from "@/lib/types";

/**
 * Finding the subject's own social accounts when nothing public links to them.
 *
 * People reuse usernames and build handles from their own name, so the scan
 * tries a short list of handles derived ONLY from the signed-in person's own
 * identity (name, email, GitHub login, handles already tied to them), reads
 * each candidate's public profile, and keeps one only if the profile itself
 * points back at the subject. Nothing here takes a handle from request input,
 * and a relative's or friend's account can never be a candidate.
 */

export type HandleStrength = "exact" | "name" | "weak";

export interface HandleCandidate {
  handle: string;
  /** exact: reused from their email / GitHub / a confirmed handle. name: built from the full name. weak: partial name. */
  strength: HandleStrength;
  /** Which identity fact the handle came from. */
  from: "email" | "github" | "handle" | "name";
}

export interface ProfileEvidence {
  handle: string;
  displayName?: string;
  bio?: string;
  location?: string;
  links?: string[];
}

export interface Ownership {
  accepted: boolean;
  confidence: number;
  anchor: IdentityAnchor;
  /** Short reason shown to the user. */
  why: string;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function nameTokens(name: string): string[] {
  return fold(name)
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1);
}

const BARE_HANDLE = /^@?([A-Za-z0-9._]{3,30})$/;
const PROFILE_URL = /(?:instagram\.com|tiktok\.com\/@|x\.com|twitter\.com|github\.com|threads\.net\/@|reddit\.com\/user|medium\.com\/@|dev\.to|linktr\.ee)\/?@?([A-Za-z0-9._-]{3,30})(?:[/?#]|$)/i;

/** Handles already tied to the subject elsewhere: the "people reuse usernames" signal. */
function reusedHandles(findings: Finding[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    if (f.category !== "handle" || f.anchor === "unconfirmed" || f.confidence < 0.7) continue;
    const fromUrl = f.value.match(PROFILE_URL)?.[1];
    const bare = f.value.trim().match(BARE_HANDLE)?.[1];
    const h = fromUrl ?? bare;
    if (h) out.push(h);
  }
  return out;
}

/**
 * Ordered candidates for one platform, strongest first.
 * `maxLen` and `allowDots` follow the platform's handle rules.
 */
export function candidateHandles(
  subject: ScanSubject,
  findings: Finding[],
  opts: { maxLen?: number; allowDots?: boolean; limit?: number } = {},
): HandleCandidate[] {
  const { maxLen = 30, allowDots = true, limit = 8 } = opts;
  const out: HandleCandidate[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined, strength: HandleStrength, from: HandleCandidate["from"]) => {
    if (!raw) return;
    let h = fold(raw).replace(/^@/, "").replace(/[^a-z0-9._]/g, "");
    if (!allowDots) h = h.replace(/\./g, "");
    if (h.length < 4 || h.length > maxLen || seen.has(h)) return;
    seen.add(h);
    out.push({ handle: h, strength, from });
  };

  const local = subject.email.split("@")[0]?.split("+")[0];
  push(local, "exact", "email");
  if (local?.includes(".")) push(local.replace(/\./g, ""), "exact", "email");
  push(subject.githubLogin, "exact", "github");
  for (const h of reusedHandles(findings)) push(h, "exact", "handle");

  const t = nameTokens(subject.name);
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    push(first + last, "name", "name");
    push(t.join(""), "name", "name");
    push(`${first}.${last}`, "name", "name");
    push(`${first}_${last}`, "name", "name");
    push(last + first, "name", "name");
    push(first[0] + last, "weak", "name");
    push(first + last[0], "weak", "name");
    push(first, "weak", "name");
  }
  return out.slice(0, limit);
}

/** Words from the subject's confirmed context that a real profile of theirs might mention. */
export function contextTerms(subject: ScanSubject, findings: Finding[]): string[] {
  const terms = new Set<string>();
  const add = (s?: string) => {
    const v = fold(s ?? "").trim();
    if (v.length >= 4) terms.add(v);
  };
  add(subject.school);
  add(subject.githubLogin);
  add(subject.email);
  for (const f of findings) {
    if (f.anchor === "unconfirmed" || f.confidence < 0.7) continue;
    if (f.category === "school" || f.category === "employer") add(f.value.length <= 60 ? f.value : undefined);
    if (f.category === "handle") {
      try {
        const host = new URL(f.value).hostname.replace(/^www\./, "");
        // A personal domain is evidence; a big platform's domain is not.
        if (!/(instagram|tiktok|twitter|x|github|linkedin|facebook|youtube|google|bsky|reddit|medium)\./.test(`${host}.`)) add(host);
      } catch {
        /* not a URL */
      }
    }
  }
  // Initialism of a multi-word school name ("Example State University" -> "esu").
  const school = nameTokens(subject.school ?? "").filter((w) => !["of", "the", "at", "and"].includes(w));
  if (school.length >= 3) terms.add(school.map((w) => w[0]).join(""));
  return [...terms];
}

/**
 * Does this public profile point back at the subject? Lenient by design:
 * a handle reused from their email or GitHub login needs little else, while
 * a handle that is only part of their name needs the profile to carry it.
 */
export function judgeOwnership(
  subject: ScanSubject,
  candidate: HandleCandidate,
  profile: ProfileEvidence,
  context: string[],
): Ownership {
  const t = nameTokens(subject.name);
  const first = t[0] ?? "";
  const last = t[t.length - 1] ?? "";
  const display = fold(profile.displayName ?? "");
  const displayTokens = new Set(nameTokens(profile.displayName ?? ""));
  const hasFirst = !!first && (displayTokens.has(first) || display.replace(/[^a-z]/g, "").includes(first));
  const hasLast = !!last && t.length >= 2 && (displayTokens.has(last) || display.replace(/[^a-z]/g, "").includes(last));
  const nameFull = hasFirst && hasLast;
  const namePartial = hasFirst || hasLast;

  const hay = fold([profile.bio, profile.location, ...(profile.links ?? []), profile.displayName].filter(Boolean).join(" \n "));
  const hit = context.find((term) => (term.length <= 4 ? new RegExp(`\\b${term}\\b`).test(hay) : hay.includes(term)));
  const empty = !profile.displayName && !profile.bio && !(profile.links ?? []).length;

  const anchorFor = (): IdentityAnchor =>
    candidate.from === "email" ? "email" : candidate.from === "github" ? "github" : hit && subject.school && hay.includes(fold(subject.school)) ? "school" : "unconfirmed";
  const sourceText = { email: "your email address", github: "your GitHub username", handle: "a username you use elsewhere", name: "your name" }[candidate.from];
  const yes = (confidence: number, why: string): Ownership => ({ accepted: true, confidence, anchor: anchorFor(), why });
  const no: Ownership = { accepted: false, confidence: 0, anchor: "unconfirmed", why: "" };

  if (candidate.strength === "exact") {
    if (nameFull) return yes(0.92, `Same username as ${sourceText}, and the profile carries your name`);
    if (hit) return yes(0.9, `Same username as ${sourceText}, and the profile mentions ${hit}`);
    if (namePartial) return yes(0.85, `Same username as ${sourceText}, and the profile carries part of your name`);
    if (empty) return yes(0.72, `Same username as ${sourceText}`);
    return no;
  }
  if (candidate.strength === "name") {
    if (nameFull) return yes(0.85, "The username is your full name and the profile carries it");
    if (hit) return yes(0.85, `The username is your full name and the profile mentions ${hit}`);
    if (namePartial) return yes(0.78, "The username is your full name and the profile carries part of it");
    // A long full-name handle is distinctive enough on its own.
    if (empty && candidate.handle.replace(/[._]/g, "").length >= 10) return yes(0.7, "The username is your full name");
    return no;
  }
  if (nameFull && hit) return yes(0.82, `The profile carries your full name and mentions ${hit}`);
  if (nameFull) return yes(0.72, "The profile carries your full name");
  return no;
}

/** Best accepted candidate, if any. Order in `judged` breaks ties (strongest candidates come first). */
export function pickOwned<T extends { ownership: Ownership }>(judged: T[]): T | null {
  let best: T | null = null;
  for (const j of judged) {
    if (!j.ownership.accepted) continue;
    if (!best || j.ownership.confidence > best.ownership.confidence) best = j;
  }
  return best;
}
