import type { AttackChain, Finding } from "@/lib/types";
import { buildCandidates } from "./catalog";
import { computeExposure } from "./score";
import type { Effort, Fix } from "./types";

const EFFORT_RANK: Record<Effort, number> = { "1 min": 0, "5 min": 1, "15 min": 2 };

/**
 * Ranked lock-down list. Greedy: each pick is the fix that removes the most score
 * points given the picks above it, so the scoreDrop values add up to the total reduction.
 * breaksChainIds is measured for the fix on its own against the untouched scan.
 * Fixes that change no public fact (2FA) come last with scoreDrop 0.
 */
export function planFixes(findings: Finding[], chains: AttackChain[], anchor?: number): Fix[] {
  const candidates = buildCandidates(findings);
  const hygiene = candidates.filter((c) => c.removesFindingIds.length === 0);
  let pool = candidates.filter((c) => c.removesFindingIds.length > 0);

  const chainName = new Map(chains.map((c) => [c.id, c.target]));
  const removed = new Set<string>();
  let prev = computeExposure(findings, chains, removed, anchor);
  const picked: Fix[] = [];

  while (pool.length) {
    let best = 0;
    let bestDrop = -1;
    let bestRes = prev;
    pool.forEach((c, i) => {
      const res = computeExposure(findings, chains, [...removed, ...c.removesFindingIds], anchor);
      const drop = prev.exactScore - res.exactScore;
      const tie = Math.abs(drop - bestDrop) <= 1e-9;
      const cur = pool[best];
      const better =
        drop > bestDrop + 1e-9 ||
        (tie && i > 0 && (EFFORT_RANK[c.effort] < EFFORT_RANK[cur.effort] || (c.effort === cur.effort && c.id < cur.id)));
      if (better) {
        best = i;
        bestDrop = drop;
        bestRes = res;
      }
    });
    const c = pool[best];
    pool = pool.filter((_, i) => i !== best);
    for (const id of c.removesFindingIds) removed.add(id);

    const breaks = computeExposure(findings, chains, c.removesFindingIds, anchor).brokenChainIds;
    const why =
      breaks.length > 0
        ? `${c.why} Doing this breaks: ${breaks.map((id) => chainName.get(id) ?? id).join("; ")}.`
        : c.why;
    picked.push({ ...c, why, scoreDrop: prev.score - bestRes.score, breaksChainIds: breaks });
    prev = bestRes;
  }

  const rest: Fix[] = hygiene.map((c) => ({ ...c, scoreDrop: 0, breaksChainIds: [] }));
  return [...picked, ...rest];
}

export { computeExposure } from "./score";
export type { Fix } from "./types";
