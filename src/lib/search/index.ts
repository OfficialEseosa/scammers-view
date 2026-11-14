import { localSearch } from "./local";
import { createTypesenseSearch, typesenseConfig } from "./typesense";
import type { FixHit, PatternHit, ScamSearch } from "./types";

export type { FixHit, PatternHit, ScamSearch } from "./types";
export { findSpans, CUES, type Span } from "./cues";

/** Typesense when TYPESENSE_HOST and TYPESENSE_API_KEY are set, otherwise the local scorer. */
export function getScamSearch(): ScamSearch {
  const cfg = typesenseConfig();
  return cfg ? createTypesenseSearch(cfg) : localSearch;
}

/** Runs on Typesense and quietly falls back to the local scorer if it is down or empty. */
export async function searchPatterns(text: string, limit: number): Promise<{ engine: ScamSearch["name"]; hits: PatternHit[] }> {
  const s = getScamSearch();
  if (s.name === "typesense") {
    try {
      const hits = await s.searchPatterns(text, limit);
      if (hits.length) return { engine: "typesense", hits };
    } catch (e) {
      console.warn("[search] typesense unavailable, using local:", e instanceof Error ? e.message.split(":")[0] : "error");
    }
  }
  return { engine: "local", hits: await localSearch.searchPatterns(text, limit) };
}

export async function searchFixes(query: string, limit: number): Promise<{ engine: ScamSearch["name"]; hits: FixHit[] }> {
  const s = getScamSearch();
  if (s.name === "typesense") {
    try {
      return { engine: "typesense", hits: await s.searchFixes(query, limit) };
    } catch (e) {
      console.warn("[search] typesense unavailable, using local:", e instanceof Error ? e.message.split(":")[0] : "error");
    }
  }
  return { engine: "local", hits: await localSearch.searchFixes(query, limit) };
}
