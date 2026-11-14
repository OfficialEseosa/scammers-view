"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Finding } from "@/lib/types";
import type { ItemState } from "./client";

/**
 * Per-item Gemini reads, one at a time, only on an explicit click.
 * `onFindings` receives every derived finding so far (all items), so the
 * results shell can merge them like breach findings.
 */
export function useVision(
  items: Finding[],
  run: (item: Finding, signal: AbortSignal) => Promise<ItemState>,
  { cap, onFindings }: { cap: number; onFindings?: (findings: Finding[]) => void },
) {
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [runningAll, setRunningAll] = useState(false);
  const acRef = useRef<AbortController | null>(null);
  const runRef = useRef(run);
  const onRef = useRef(onFindings);
  useEffect(() => {
    runRef.current = run;
    onRef.current = onFindings;
  });
  useEffect(() => () => acRef.current?.abort(), []);

  // Report derived findings whenever a result lands.
  useEffect(() => {
    const out: Finding[] = [];
    for (const s of Object.values(states)) if (s.k === "done") out.push(...s.res.findings);
    onRef.current?.(out);
  }, [states]);

  const controller = () => {
    if (!acRef.current || acRef.current.signal.aborted) acRef.current = new AbortController();
    return acRef.current;
  };

  const analyseOne = useCallback(async (item: Finding) => {
    const ac = controller();
    setStates((s) => ({ ...s, [item.id]: { k: "busy" } }));
    try {
      const next = await runRef.current(item, ac.signal);
      if (!ac.signal.aborted) setStates((s) => ({ ...s, [item.id]: next }));
    } catch (e) {
      if (ac.signal.aborted) return;
      setStates((s) => ({ ...s, [item.id]: { k: "failed", message: e instanceof Error ? e.message : "Failed" } }));
    }
  }, []);

  const done = Object.values(states).filter((s) => s.k === "done" || s.k === "skipped").length;
  const todo = items.filter((i) => {
    const k = states[i.id]?.k;
    return !k || k === "idle" || k === "failed";
  });
  const remainingCap = Math.max(0, cap - done);

  const analyseAll = useCallback(async () => {
    setRunningAll(true);
    try {
      for (const item of todo.slice(0, remainingCap)) {
        if (acRef.current?.signal.aborted) break;
        await analyseOne(item);
      }
    } finally {
      setRunningAll(false);
    }
  }, [todo, remainingCap, analyseOne]);

  const stop = useCallback(() => {
    acRef.current?.abort();
    setStates((s) => Object.fromEntries(Object.entries(s).map(([id, st]) => [id, st.k === "busy" ? { k: "idle" } : st])) as Record<string, ItemState>);
    setRunningAll(false);
  }, []);

  return {
    stateOf: (id: string): ItemState => states[id] ?? { k: "idle" },
    analyseOne,
    analyseAll,
    stop,
    runningAll,
    busy: Object.values(states).some((s) => s.k === "busy"),
    canAnalyseAll: todo.length > 0 && remainingCap > 0,
    atCap: remainingCap === 0 && todo.length > 0,
    done,
  };
}
