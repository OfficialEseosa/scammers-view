import type { AttackChain, ExposureScore, Finding } from "@/lib/types";
import { computeExposure } from "@/lib/fixes/score";

/**
 * Findings the user marked "not me" are dropped before anything reads them.
 * A chain loses those ids from its steps; a chain whose step is left with no
 * evidence at all can't happen, so it goes too. The score is re-scored as if
 * those facts were never found.
 */
export function excludeNotMe(
  findings: Finding[],
  chains: AttackChain[],
  score: ExposureScore | null,
  hidden: ReadonlySet<string>,
): { findings: Finding[]; chains: AttackChain[]; score: ExposureScore | null } {
  if (!hidden.size) return { findings, chains, score };
  const kept = findings.filter((f) => !hidden.has(f.id));
  const keptChains: AttackChain[] = [];
  for (const c of chains) {
    const steps = c.steps.map((s) => ({ ...s, findingIds: s.findingIds.filter((id) => !hidden.has(id)) }));
    if (steps.some((s, i) => c.steps[i].findingIds.length > 0 && s.findingIds.length === 0)) continue;
    keptChains.push({ ...c, steps });
  }
  const rescored = score && {
    ...score,
    score: computeExposure(findings, chains, hidden, score.score).score,
    topFindingIds: score.topFindingIds.filter((id) => !hidden.has(id)),
  };
  return { findings: kept, chains: keptChains, score: rescored };
}
