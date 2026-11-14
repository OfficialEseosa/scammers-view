export type Effort = "1 min" | "5 min" | "15 min";

export type FixKind = "privacy" | "security-question" | "broker" | "takedown" | "2fa";

export interface FixLink {
  label: string;
  url: string;
  /** True only when the URL was checked against the service's own help pages. */
  confirmed: boolean;
}

export interface Fix {
  id: string;
  kind: FixKind;
  title: string;
  why: string;
  steps: string[];
  /** Primary link (direct settings page or the service's own help article). */
  link?: string;
  /** False when the link could not be checked; the UI says so. */
  linkConfirmed?: boolean;
  extraLinks?: FixLink[];
  removesFindingIds: string[];
  /** Score points this fix removes at its rank (marginal, so the list sums to the total). */
  scoreDrop: number;
  breaksChainIds: string[];
  effort: Effort;
  /** Present on broker fixes: enables the "draft the removal email" action. */
  optout?: { broker: string; listingUrl: string; findingIds: string[] };
}

/** A fix before scoring. */
export type FixTemplate = Omit<Fix, "scoreDrop" | "breaksChainIds" | "why"> & { why: string };
