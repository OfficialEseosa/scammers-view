import { localSearch } from "./local";
import type { FixHit, PatternHit } from "./types";

export type { FixHit, PatternHit, ScamSearch } from "./types";
export { findSpans, CUES, type Span } from "./cues";

export function searchPatterns(text: string, limit: number): Promise<PatternHit[]> {
  return localSearch.searchPatterns(text, limit);
}

export function searchFixes(query: string, limit: number): Promise<FixHit[]> {
  return localSearch.searchFixes(query, limit);
}
