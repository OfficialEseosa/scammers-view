import type { Finding, FindingCategory } from "@/lib/types";

/** Categories that still have at least one public fact once the ticked fixes are taken out. */
export function exposedCategories(findings: Pick<Finding, "id" | "category">[], removed: Iterable<string> = []): FindingCategory[] {
  const gone = new Set(removed);
  return [...new Set(findings.filter((f) => !gone.has(f.id)).map((f) => f.category))].sort();
}

/** A case is possible only while every fact it relies on is still public. */
export function caseOpen(needs: readonly string[], exposed: Iterable<string>): boolean {
  const have = new Set(exposed);
  return needs.every((n) => have.has(n));
}

/** The facts whose removal closed the case. */
export function missingNeeds(needs: readonly string[], exposed: Iterable<string>): string[] {
  const have = new Set(exposed);
  return needs.filter((n) => !have.has(n));
}
