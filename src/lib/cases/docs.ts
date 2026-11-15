import type { CaseDoc } from "./types";
import cases from "./cases.json";

export const CASE_COLLECTION = "scam_cases";

/** Built by scripts/build-scam-cases.ts from the tagged files in data/scam-cases/. */
export function caseDocs(): CaseDoc[] {
  return cases as CaseDoc[];
}
