import { PATTERNS } from "../campus/patterns";
import { fixReference } from "../fixes/catalog";
import type { FixDoc, PatternDoc } from "./types";

export const PATTERN_COLLECTION = "scam_patterns";
export const FIX_COLLECTION = "fixes";

export function patternDocs(): PatternDoc[] {
  return PATTERNS.map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    opener: p.opener,
    red_flags: p.redFlags,
    action: p.action,
    sources: p.sources.map((s) => s.title),
  }));
}

export function fixDocs(): FixDoc[] {
  return fixReference();
}
