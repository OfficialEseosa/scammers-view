import type { AttackChain, Finding } from "@/lib/types";

/**
 * Deterministic exposure model, so before/after is instant and explainable.
 *
 *   facts  = 55 * (1 - exp(-T / 45))   where T = sum over categories of
 *            sum_i (riskWeight_i * confidence_i * 0.6^i), items sorted high to low
 *            (the 2nd fact in a category counts 60%, the 3rd 36%, ...)
 *   chains = 35 * (1 - exp(-S / 14))   where S = sum of severity of INTACT chains
 *   score  = clamp(facts + chains), scaled so the untouched scan equals `anchor`.
 *
 * A chain is broken when any step has lost every one of its findingIds.
 */

const DECAY = 0.6;
const FACT_CAP = 55;
const FACT_SCALE = 45;
const CHAIN_CAP = 35;
const CHAIN_SCALE = 14;

export type ChainState = { broken: boolean; brokenStepIds: string[] };

export interface ExposureResult {
  /** Whole number 0..100. */
  score: number;
  /** Unrounded; used for ranking. */
  exactScore: number;
  /** Score with nothing removed (after anchoring). */
  baselineScore: number;
  brokenChainIds: string[];
  chainStatus: Record<string, ChainState>;
}

export function chainStatusFor(
  chains: AttackChain[],
  removed: ReadonlySet<string>,
): Record<string, ChainState> {
  const out: Record<string, ChainState> = {};
  for (const c of chains) {
    const brokenStepIds = c.steps
      .filter((s) => s.findingIds.length > 0 && s.findingIds.every((id) => removed.has(id)))
      .map((s) => s.id);
    out[c.id] = { broken: brokenStepIds.length > 0, brokenStepIds };
  }
  return out;
}

function rawScore(
  findings: Finding[],
  chains: AttackChain[],
  removed: ReadonlySet<string>,
  status: Record<string, ChainState>,
): number {
  const byCat = new Map<string, number[]>();
  for (const f of findings) {
    if (removed.has(f.id)) continue;
    const c = (f.riskWeight * f.confidence);
    const list = byCat.get(f.category) ?? [];
    list.push(c);
    byCat.set(f.category, list);
  }
  let total = 0;
  for (const list of byCat.values()) {
    list.sort((a, b) => b - a);
    list.forEach((c, i) => {
      total += c * Math.pow(DECAY, i);
    });
  }
  const facts = FACT_CAP * (1 - Math.exp(-total / FACT_SCALE));
  let sev = 0;
  for (const c of chains) if (!status[c.id]?.broken) sev += c.severity;
  const chain = CHAIN_CAP * (1 - Math.exp(-sev / CHAIN_SCALE));
  return facts + chain;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function computeExposure(
  findings: Finding[],
  chains: AttackChain[],
  removedFindingIds: Iterable<string> = [],
  /** The server's model-derived score; the untouched result is scaled to land on it. */
  anchor?: number,
): ExposureResult {
  const removed = new Set(removedFindingIds);
  const none = new Set<string>();
  const base = rawScore(findings, chains, none, chainStatusFor(chains, none));
  const scale = anchor != null && base > 0 ? Math.max(0.5, Math.min(2, anchor / base)) : 1;

  const chainStatus = chainStatusFor(chains, removed);
  const exactScore = clamp(rawScore(findings, chains, removed, chainStatus) * scale);
  return {
    score: Math.round(exactScore),
    exactScore,
    baselineScore: Math.round(clamp(base * scale)),
    brokenChainIds: chains.filter((c) => chainStatus[c.id].broken).map((c) => c.id),
    chainStatus,
  };
}
