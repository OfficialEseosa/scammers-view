"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceType } from "@/lib/types";
import type { ScanPhase, SourceStatus } from "@/hooks/useScanStream";

/**
 * "Finishing scan in about N" from real progress: sources finished vs sources started,
 * projected linearly from the elapsed time, plus a tail for the reasoning pass that
 * follows the search. The finish time is smoothed so the text doesn't jump around.
 */

/** Reasoning after the search, as a share of the search time. */
const TAIL = 0.3;
/** Once the score is in, only chains and wrap-up are left. */
const AFTER_SCORE_MS = 8000;
const MIN_ELAPSED_MS = 4000;
/** Share of the gap to the new estimate closed each tick. */
const ALPHA = 0.3;
const TICK_MS = 1000;

export interface EtaInput {
  elapsedMs: number;
  sources: Partial<Record<SourceType, SourceStatus>>;
  hasScore: boolean;
  /** When every started source had finished, if they have. */
  searchDoneMs?: number;
}

/** Milliseconds left, or null while there's too little progress to say. */
export function estimateRemainingMs({ elapsedMs, sources, hasScore, searchDoneMs }: EtaInput): number | null {
  const all = Object.values(sources);
  const total = all.length;
  const done = all.filter((s) => s?.status === "done").length;
  if (elapsedMs < MIN_ELAPSED_MS || total === 0) return null;
  if (done === 0 || (done < 2 && total > 3)) return null;
  const searchMs = done < total ? (elapsedMs * total) / done : (searchDoneMs ?? elapsedMs);
  let left = searchMs * (1 + TAIL) - elapsedMs;
  if (hasScore) left = Math.min(left, AFTER_SCORE_MS);
  return Math.max(0, left);
}

/** Minutes from 90s up, otherwise seconds rounded to 5 (under 30s) or 10. */
export function formatEta(ms: number): string {
  const s = ms / 1000;
  if (s <= 5) return "Almost done";
  if (s >= 90) return `Finishing scan in about ${Math.round(s / 60)} minutes`;
  const r = s < 30 ? Math.round(s / 5) * 5 : Math.round(s / 10) * 10;
  return `Finishing scan in about ${r} seconds`;
}

interface EtaScan {
  phase: ScanPhase;
  sources: Partial<Record<SourceType, SourceStatus>>;
  score: unknown;
}

/** Null while estimating (or not running); otherwise the text to show. */
export function useScanEta(scan: EtaScan): { running: boolean; text: string | null } {
  const running = scan.phase === "connecting" || scan.phase === "running";
  const live = useRef(scan);
  useEffect(() => {
    live.current = scan;
  });
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    let finishAt: number | null = null;
    let searchDoneMs: number | undefined;
    const tick = () => {
      const now = Date.now();
      const s = live.current;
      const elapsedMs = now - start;
      const all = Object.values(s.sources);
      if (all.length > 0 && all.every((x) => x?.status === "done")) searchDoneMs ??= elapsedMs;
      else searchDoneMs = undefined;
      const left = estimateRemainingMs({ elapsedMs, sources: s.sources, hasScore: s.score != null, searchDoneMs });
      if (left != null) {
        const target = now + left;
        finishAt = finishAt == null ? target : finishAt + ALPHA * (target - finishAt);
      }
      setText(finishAt == null ? null : formatEta(finishAt - now));
    };
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [running]);

  return { running, text: running ? text : null };
}
