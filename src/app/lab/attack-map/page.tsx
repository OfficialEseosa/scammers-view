"use client";

import { useEffect, useRef, useState } from "react";
import type { AttackChain, ExposureScore, Finding } from "@/lib/types";
import { AttackMap } from "@/features/attack-map";
import {
  MOCK_CHAINS,
  MOCK_FINDINGS,
  MOCK_KEY_FACTS,
  MOCK_SCORE,
  MOCK_SUBJECT,
} from "@/features/attack-map/mock";

export default function AttackMapLab() {
  const [findings, setFindings] = useState<Finding[]>(MOCK_FINDINGS);
  const [chains, setChains] = useState<AttackChain[]>(MOCK_CHAINS);
  const [score, setScore] = useState<ExposureScore | undefined>(MOCK_SCORE);
  const [masked, setMasked] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const stream = () => {
    clearTimers();
    setFindings([]);
    setChains([]);
    setScore(undefined);
    setRemoved([]);
    setStreaming(true);
    const gap = 650;
    MOCK_FINDINGS.forEach((f, i) => {
      timers.current.push(setTimeout(() => setFindings((cur) => [...cur, f]), 400 + i * gap));
    });
    const after = 400 + MOCK_FINDINGS.length * gap + 400;
    timers.current.push(setTimeout(() => setScore(MOCK_SCORE), after));
    MOCK_CHAINS.forEach((c, i) => {
      timers.current.push(setTimeout(() => setChains((cur) => [...cur, c]), after + 600 + i * 900));
    });
    timers.current.push(
      setTimeout(() => setStreaming(false), after + 600 + MOCK_CHAINS.length * 900),
    );
  };

  const btn =
    "min-h-11 rounded-lg border border-edge bg-elevated px-4 text-[15px] font-semibold hover:border-muted aria-pressed:border-edge-strong aria-pressed:text-fg";

  return (
    <main className="flex h-dvh flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-surface px-4 py-2">
        <span className="mr-2 font-display text-lg font-bold">Attack map lab</span>
        <button type="button" className={btn} onClick={stream} disabled={streaming}>
          {streaming ? "Streaming…" : "Stream in findings one by one"}
        </button>
        <button type="button" className={btn} aria-pressed={masked} onClick={() => setMasked((m) => !m)}>
          {masked ? "Unmask values" : "Mask values"}
        </button>
        <button
          type="button"
          className={btn}
          aria-pressed={removed.length > 0}
          onClick={() => setRemoved((r) => (r.length ? [] : MOCK_KEY_FACTS))}
        >
          {removed.length ? "Restore removed facts" : "Remove 2 key facts"}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <AttackMap
          findings={findings}
          chains={chains}
          score={score}
          subjectName={MOCK_SUBJECT}
          masked={masked}
          removedFindingIds={removed}
        />
      </div>
    </main>
  );
}
