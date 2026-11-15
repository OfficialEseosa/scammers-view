"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  ScanEvent,
  type AttackChain,
  type ExposureScore,
  type Finding,
  type SourceType,
} from "@/lib/types";
import { buildMockTimeline } from "@/hooks/mockScan";

export type ScanPhase = "connecting" | "running" | "done" | "error";

export interface SourceStatus {
  status: "running" | "done";
  count: number;
  query?: string;
}

export interface ScanState {
  phase: ScanPhase;
  message: string;
  sources: Partial<Record<SourceType, SourceStatus>>;
  findings: Finding[];
  score: ExposureScore | null;
  chains: AttackChain[];
  error: string | null;
}

const initial: ScanState = {
  phase: "connecting",
  message: "Connecting",
  sources: {},
  findings: [],
  score: null,
  chains: [],
  error: null,
};

type Action =
  | { type: "event"; event: ScanEvent }
  | { type: "fail"; message: string }
  | { type: "reset" }
  | { type: "hydrate"; state: ScanState };

function reducer(state: ScanState, action: Action): ScanState {
  if (action.type === "reset") return initial;
  if (action.type === "hydrate") return action.state;
  if (action.type === "fail") {
    if (state.phase === "done") return state;
    return { ...state, phase: "error", error: action.message };
  }
  const e = action.event;
  const running: ScanState = state.phase === "connecting" ? { ...state, phase: "running", message: "Scanning" } : state;
  switch (e.type) {
    case "status":
      return { ...running, message: e.message };
    case "source_started":
      return {
        ...running,
        sources: { ...running.sources, [e.sourceType]: { status: "running", count: running.sources[e.sourceType]?.count ?? 0, query: e.query } },
      };
    case "source_done":
      return {
        ...running,
        sources: { ...running.sources, [e.sourceType]: { status: "done", count: e.count, query: running.sources[e.sourceType]?.query } },
      };
    case "finding":
      if (running.findings.some((f) => f.id === e.finding.id)) return running;
      return { ...running, findings: [e.finding, ...running.findings] };
    case "score":
      return { ...running, score: e.score };
    case "chain":
      return { ...running, chains: [...running.chains.filter((c) => c.id !== e.chain.id), e.chain] };
    case "done":
      return { ...running, phase: "done", message: "Scan complete" };
    case "error":
      return { ...running, phase: "error", error: e.message };
  }
}

/**
 * Streams ScanEvents from GET /api/scan (SSE), or a built-in fictional sequence when `mock` is set.
 * Every event is validated with zod; malformed events are dropped.
 * Nothing starts until `enabled` is true; flipping it back to false closes the stream and wipes the state.
 * Pass a finished `restore` snapshot to show prior results after a refresh without re-running the scan.
 */
export function useScanStream(mock: boolean, enabled = true, restore: ScanState | null = null) {
  const [state, dispatch] = useReducer(reducer, restore?.phase === "done" ? restore : initial);
  const [run, setRun] = useState(0);
  const restoredDone = restore?.phase === "done";
  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  }, [restore]);

  useEffect(() => {
    if (restoredDone && run === 0) {
      const snap = restoreRef.current;
      if (snap) dispatch({ type: "hydrate", state: snap });
      return;
    }
    dispatch({ type: "reset" });
    if (!enabled) return;
    let closed = false;
    const cleanups: Array<() => void> = [];

    const handle = (raw: unknown) => {
      const parsed = ScanEvent.safeParse(raw);
      if (!parsed.success) {
        console.warn("Ignoring malformed scan event", parsed.error.issues[0]);
        return;
      }
      dispatch({ type: "event", event: parsed.data });
    };

    if (mock) {
      for (const step of buildMockTimeline()) {
        const id = window.setTimeout(() => handle(step.event), step.at);
        cleanups.push(() => window.clearTimeout(id));
      }
    } else {
      // Deferred so a React dev double-mount never opens a (billable) connection twice.
      const startId = window.setTimeout(() => {
        const es = new EventSource("/api/scan");
        cleanups.push(() => es.close());
        es.onmessage = (msg) => {
          let data: unknown;
          try {
            data = JSON.parse(msg.data);
          } catch {
            return;
          }
          handle(data);
          const t = (data as { type?: string } | null)?.type;
          if (t === "done" || t === "error") es.close();
        };
        es.onerror = () => {
          // EventSource would silently reconnect and restart the scan; stop it instead.
          es.close();
          if (!closed) dispatch({ type: "fail", message: "The connection to the scan was lost. Check that you are signed in, then try again." });
        };
      }, 150);
      cleanups.push(() => window.clearTimeout(startId));
    }

    return () => {
      closed = true;
      cleanups.forEach((c) => c());
    };
  }, [mock, run, enabled, restoredDone]);

  const restart = useCallback(() => setRun((n) => n + 1), []);
  return { ...state, restart };
}
