"use client";

import { useEffect, useMemo, useState } from "react";
import type { AttackChain, Finding } from "@/lib/types";
import { exposedCategories } from "@/lib/cases/match";
import { CaseResponse, type CaseHit } from "@/lib/cases/types";

export interface RealCases {
  status: "idle" | "loading" | "ready" | "error";
  engine: CaseResponse["engine"] | null;
  /** Closest published cases per attack chain, best first. */
  byChain: Record<string, CaseHit[]>;
  /** Every case returned, once each, best first. */
  all: CaseHit[];
}

const EMPTY: RealCases = { status: "idle", engine: null, byChain: {}, all: [] };
const MAX_CHAINS = 8;

function chainText(c: AttackChain): string {
  return [c.target, ...c.steps.map((s) => `${s.title}. ${s.description}`)].join(". ").slice(0, 600);
}

/**
 * Looks up real, published scam reports that fit this scan: once per set of chains, against
 * everything found (ticked fixes are applied on screen, not by asking again).
 */
export function useRealCases(findings: Finding[], chains: AttackChain[]): RealCases {
  const body = useMemo(() => {
    if (!chains.length || !findings.length) return null;
    return JSON.stringify({
      exposed: exposedCategories(findings),
      queries: chains.slice(0, MAX_CHAINS).map((c) => ({ id: c.id, text: chainText(c) })),
      limit: 4,
    });
  }, [findings, chains]);

  const [result, setResult] = useState<{ key: string; data: RealCases } | null>(null);

  useEffect(() => {
    if (!body) return;
    const ctrl = new AbortController();
    fetch("/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body, signal: ctrl.signal })
      .then(async (res) => {
        const parsed = CaseResponse.safeParse(await res.json().catch(() => null));
        if (!res.ok || !parsed.success) throw new Error("cases");
        const seen = new Map<string, CaseHit>();
        for (const hits of Object.values(parsed.data.byQuery)) {
          for (const h of hits) if ((seen.get(h.id)?.score ?? -1) < h.score) seen.set(h.id, h);
        }
        const all = [...seen.values()].sort((a, b) => b.score - a.score || b.year - a.year);
        setResult({ key: body, data: { status: "ready", engine: parsed.data.engine, byChain: parsed.data.byQuery, all } });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setResult({ key: body, data: { ...EMPTY, status: "error" } });
      });
    return () => ctrl.abort();
  }, [body]);

  if (!body) return EMPTY;
  return result?.key === body ? result.data : { ...EMPTY, status: "loading" };
}
