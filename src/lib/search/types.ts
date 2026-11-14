import type { PatternId } from "../campus/patterns";
import type { FixKind } from "../fixes/types";

/** Reference documents only. Nothing about any user is ever indexed. */

export interface PatternDoc {
  id: PatternId;
  name: string;
  tagline: string;
  opener: string;
  red_flags: string[];
  action: string;
  sources: string[];
}

export interface FixDoc {
  id: string;
  kind: FixKind;
  title: string;
  steps: string[];
  link?: string;
  keywords: string[];
}

export interface PatternHit {
  id: PatternId;
  /** 0..1, comparable within one response only. */
  score: number;
}

export interface FixHit {
  id: string;
  kind: FixKind;
  title: string;
  link?: string;
  score: number;
}

export interface ScamSearch {
  name: "typesense" | "local";
  searchPatterns(text: string, limit: number): Promise<PatternHit[]>;
  searchFixes(query: string, limit: number): Promise<FixHit[]>;
}
