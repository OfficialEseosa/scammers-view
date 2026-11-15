import { PATTERN_BY_ID } from "@/lib/campus/patterns";
import { checkReputation, isReported, type Reported } from "@/lib/reputation";
import { CUES, findSpans, searchPatterns, type Span } from "@/lib/search";

export type CheckLevel = "high" | "some" | "low";

export interface CheckMatch {
  id: string;
  name: string;
  tagline: string;
  score: number;
  signs: string[];
  redFlags: string[];
  action: string;
  report: { title: string; url: string }[];
}

export interface CheckResult {
  engine: "typesense" | "local";
  level: CheckLevel;
  spans: Span[];
  matches: CheckMatch[];
  reported: Reported;
}

/**
 * Compares a message with the reference scam patterns, marks its warning signs and looks up
 * its links and numbers in public scam reports. Nothing is stored or logged.
 */
export async function analyzeMessage(text: string, limit = 3): Promise<CheckResult> {
  const spans = findSpans(text);
  const cueIds = new Set(spans.map((s) => s.cueId));
  const [{ engine, hits }, reported] = await Promise.all([searchPatterns(text, limit), checkReputation(text)]);
  const matches = hits.map((h) => {
    const p = PATTERN_BY_ID[h.id];
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      score: h.score,
      signs: CUES.filter((c) => cueIds.has(c.id) && c.patterns.includes(p.id)).map((c) => c.why),
      redFlags: p.redFlags,
      action: p.action,
      report: p.report,
    };
  });
  const level: CheckLevel = isReported(reported) || cueIds.size >= 3 ? "high" : cueIds.size >= 1 ? "some" : "low";
  return { engine, level, spans, matches, reported };
}
