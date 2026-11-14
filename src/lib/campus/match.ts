import type { Finding } from "../types";
import { PATTERNS, type CampusPattern } from "./patterns";

export type PatternMatch = {
  pattern: CampusPattern;
  /** Findings that feed this scam, strongest first. */
  matchedFindingIds: string[];
  /** 0..100: how convincing this scam would be given what is public. */
  fitScore: number;
};

/** How much one finding is worth as evidence: confident, high-risk facts count most. */
function strength(f: Finding): number {
  return f.confidence * (0.5 + 0.5 * (f.riskWeight / 10));
}

function haystack(f: Finding): string {
  return `${f.label} ${f.value} ${f.snippet ?? ""} ${f.sourceTitle ?? ""}`;
}

function isEdu(f: Finding): boolean {
  return f.category === "email" && /@[^\s@]*\.edu\b/i.test(f.value);
}

/**
 * Rule-based ranking. Each fact category and each text signal is independent evidence;
 * they combine as a noisy-or, so many weak facts add up but never pass 100.
 * Patterns with no supporting finding are left out.
 */
export function matchPatterns(findings: Finding[]): PatternMatch[] {
  const out: PatternMatch[] = [];
  for (const pattern of PATTERNS) {
    const used = new Map<string, number>();
    let miss = 1;

    for (const fuel of pattern.fuel) {
      const hits = findings.filter((f) => f.category === fuel.category);
      if (!hits.length) continue;
      const best = Math.max(...hits.map(strength));
      // A school email address is stronger evidence than any other email.
      const boost = fuel.category === "email" && hits.some(isEdu) ? 1.25 : 1;
      miss *= 1 - Math.min(0.95, fuel.weight * best * boost);
      for (const h of hits) used.set(h.id, Math.max(used.get(h.id) ?? 0, strength(h)));
    }

    for (const sig of pattern.signals) {
      const hits = findings.filter((f) => sig.re.test(haystack(f)));
      if (!hits.length) continue;
      const best = Math.max(...hits.map(strength));
      miss *= 1 - Math.min(0.95, sig.weight * (0.6 + 0.4 * best));
      for (const h of hits) used.set(h.id, Math.max(used.get(h.id) ?? 0, strength(h) + 0.5));
    }

    if (!used.size) continue;
    const fitScore = Math.round((1 - miss) * 100);
    if (fitScore <= 0) continue;
    const matchedFindingIds = [...used.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    out.push({ pattern, matchedFindingIds, fitScore });
  }
  return out.sort((a, b) => b.fitScore - a.fitScore || a.pattern.name.localeCompare(b.pattern.name));
}
