import type { Finding, FindingCategory, IdentityAnchor, SourceType } from "@/lib/types";
import type { FactKind, PhotoFact, PhotoReadout, VideoFact, VideoReadout } from "./schema";

/**
 * Post-processing for Gemini readouts: clamps lengths and numbers (structured
 * output ignores maxLength), enforces the identity guard on the OUTPUT too
 * (a name-like fact not read from visible/spoken text is dropped), drops
 * invalid boxes, and maps facts to scan Findings.
 */

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

/** Kinds whose value names a person; allowed only when read from text or speech. */
const NAMES_A_PERSON: ReadonlySet<FactKind> = new Set(["name", "relative"]);

/** Phrases that would mean the model tried to recognise someone. */
const RECOGNITION = /\b(looks like|resembl\w*|appears to be [A-Z]|recogni[sz]\w*|identified as|face match\w*|lookalike)\b/i;

export function keepFact(f: Pick<PhotoFact, "kind" | "fromVisibleText" | "evidence" | "value" | "label">): boolean {
  if (!f.value.trim() || !f.label.trim()) return false;
  if (NAMES_A_PERSON.has(f.kind) && !f.fromVisibleText) return false;
  if (RECOGNITION.test(f.evidence) || RECOGNITION.test(f.value)) return false;
  return true;
}

/** A usable box: 4 numbers in 0..1000, ordered, not a sliver, not the whole frame. */
export function validBox(b: number[] | null | undefined): [number, number, number, number] | null {
  if (!b || b.length !== 4 || b.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) return null;
  const [y0, x0, y1, x1] = b;
  if (y1 <= y0 || x1 <= x0) return null;
  const area = ((y1 - y0) * (x1 - x0)) / 1_000_000;
  if (area < 0.002 || area > 0.95) return null;
  return [y0, x0, y1, x1];
}

function cleanBase<T extends PhotoFact | VideoFact>(f: T): T {
  return {
    ...f,
    label: clip(f.label, 48),
    value: clip(f.value, 100),
    evidence: clip(f.evidence, 200),
    risk: Math.round(clamp(f.risk, 0, 10)),
    confidence: clamp(f.confidence, 0, 1),
  };
}

export function cleanPhotoReadout(r: PhotoReadout): PhotoReadout {
  const facts = r.facts
    .map((f) => cleanBase({ ...f, box: validBox(f.box) ?? [] }))
    .filter(keepFact)
    .slice(0, 10);
  const guess = r.otherPeople.relationshipGuess ? clip(r.otherPeople.relationshipGuess, 40) : null;
  return {
    facts,
    otherPeople: {
      count: Math.round(clamp(r.otherPeople.count, 0, 50)),
      // A relationship guess must not smuggle a name in.
      relationshipGuess: guess && !/[A-Z][a-z]+ [A-Z][a-z]+/.test(guess) && !RECOGNITION.test(guess) ? guess : null,
    },
    scammerLearns: clip(r.scammerLearns, 160),
  };
}

const TS = /^\d{1,2}:\d{2}$/;

export function cleanVideoReadout(r: VideoReadout): VideoReadout {
  return {
    hasSpeech: !!r.hasSpeech,
    facts: r.facts
      .map((f) => cleanBase({ ...f, at: f.at && TS.test(f.at.trim()) ? f.at.trim() : null }))
      .filter(keepFact)
      .slice(0, 14),
    scammerLearns: clip(r.scammerLearns, 160),
  };
}

const CATEGORY: Record<FactKind, FindingCategory> = {
  place: "location",
  landmark: "location",
  school: "school",
  employer: "employer",
  event: "schedule",
  text: "other",
  pet: "pet",
  vehicle: "other",
  routine: "schedule",
  birthday: "birthday",
  relative: "relative",
  name: "other",
  other: "other",
};

export function sourceTypeOf(url: string): SourceType {
  let h = "";
  try {
    h = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (/(^|\.)instagram\.com$|cdninstagram\.com$|fbcdn\.net$/.test(h)) return "instagram";
  if (/(^|\.)tiktok\.com$|tiktokcdn/.test(h)) return "tiktok";
  if (/(^|\.)(x|twitter)\.com$|twimg\.com$/.test(h)) return "x";
  if (/(^|\.)linkedin\.com$|licdn\.com$/.test(h)) return "linkedin";
  if (/(^|\.)github\.com$|githubusercontent\.com$/.test(h)) return "github";
  if (/(^|\.)bsky\.(app|social)$/.test(h)) return "bluesky";
  if (/\.edu$|\.ac\.[a-z]{2}$|\.sch\.[a-z]{2}$/.test(h)) return "school";
  return "web";
}

/** Small stable hash for deterministic finding ids (same fact twice merges). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

interface Origin {
  findingId: string;
  sourceUrl: string;
  sourceTitle?: string;
  anchor: IdentityAnchor;
  now?: string;
}

function toFinding(f: PhotoFact | VideoFact, o: Origin, prefix: string, snippet: string): Finding {
  return {
    id: `${prefix}-${fnv1a(`${o.findingId}|${f.kind}|${f.value.toLowerCase()}`)}`,
    category: CATEGORY[f.kind],
    label: f.label,
    value: f.value,
    sourceType: sourceTypeOf(o.sourceUrl),
    sourceUrl: o.sourceUrl,
    sourceTitle: o.sourceTitle,
    snippet,
    anchor: o.anchor,
    confidence: f.confidence,
    riskWeight: f.risk,
    foundAt: o.now ?? new Date().toISOString(),
  };
}

/** Photo facts as Findings. `anchor: 'face'`: the user matched themselves to this photo on their device. */
export function photoFindings(r: PhotoReadout, o: Omit<Origin, "anchor">): Finding[] {
  const out = r.facts.map((f) => toFinding(f, { ...o, anchor: "face" }, "gphoto", `Seen in your photo: ${f.evidence}`));
  if (r.otherPeople.count > 0) {
    const n = r.otherPeople.count;
    const who = r.otherPeople.relationshipGuess ? ` (${r.otherPeople.relationshipGuess})` : "";
    out.push({
      id: `gphoto-${fnv1a(`${o.findingId}|people`)}`,
      category: "relative",
      label: "People with you",
      value: `${n} ${n === 1 ? "other person" : "other people"}${who}`,
      sourceType: sourceTypeOf(o.sourceUrl),
      sourceUrl: o.sourceUrl,
      sourceTitle: o.sourceTitle,
      snippet: "Counted in your photo. Nobody was identified.",
      anchor: "face",
      confidence: 0.6,
      riskWeight: 2,
      foundAt: o.now ?? new Date().toISOString(),
    });
  }
  return out;
}

const CHANNEL_WORD = { speech: "Said", screen: "On screen", scene: "Shown" } as const;

export function videoFindings(r: VideoReadout, o: Origin): Finding[] {
  return r.facts.map((f) => toFinding(f, o, "gvideo", `${CHANNEL_WORD[f.channel]}${f.at ? ` at ${f.at}` : ""} in your video: ${f.evidence}`));
}
