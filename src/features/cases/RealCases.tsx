"use client";

import { useMemo } from "react";
import type { AttackChain, Finding, FindingCategory } from "@/lib/types";
import { caseOpen, exposedCategories, missingNeeds } from "@/lib/cases/match";
import type { CaseHit } from "@/lib/cases/types";
import { RiskBadge } from "@/design/Badge";
import { Card, RedactedRule } from "@/design/Card";
import { cn } from "@/design/utils";
import type { RealCases } from "./useRealCases";

const FACT: Record<FindingCategory, string> = {
  school: "School",
  employer: "Work",
  email: "Email",
  phone: "Phone",
  location: "Location",
  relative: "Family",
  pet: "Pet",
  birthday: "Birthday",
  handle: "Handle",
  photo: "Photo",
  schedule: "Routine",
  interest: "Interest",
  other: "Other",
  video: "Video",
  connection: "Connection",
};

type Props = { cases: RealCases; findings: Finding[]; chains: AttackChain[]; removedFindingIds?: string[]; className?: string };

function Needs({ needs, exposed }: { needs: FindingCategory[]; exposed: string[] }) {
  const gone = new Set(missingNeeds(needs, exposed));
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Facts this scam relies on">
      {needs.map((n) => (
        <li
          key={n}
          className={cn("rounded-chip border px-2 py-0.5 text-xs font-medium", gone.has(n) ? "border-edge text-subtle line-through" : "border-edge-strong text-fg")}
        >
          {FACT[n]}
        </li>
      ))}
    </ul>
  );
}

function Source({ c }: { c: CaseHit }) {
  return (
    <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-mono text-xs text-muted underline underline-offset-4 hover:text-fg sm:min-h-0">
      {c.source}, {c.year}
    </a>
  );
}

/** Under the attack map: the closest published case for each way in. */
export function ChainCases({ cases, findings, chains, removedFindingIds = [], className }: Props) {
  const exposed = useMemo(() => exposedCategories(findings, removedFindingIds), [findings, removedFindingIds]);
  const rows = chains.map((chain) => ({ chain, hit: cases.byChain[chain.id]?.[0] })).filter((r): r is { chain: AttackChain; hit: CaseHit } => !!r.hit);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="chain-cases-h" className={className}>
      <RedactedRule />
      <h2 id="chain-cases-h" className="sv-display mt-5 text-[clamp(1.8rem,3.6vw,2.4rem)]">
        This has happened
      </h2>
      <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ chain, hit }) => {
          const open = caseOpen(hit.needs, exposed);
          return (
            <Card as="li" key={chain.id} className="flex min-w-0 flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-sm font-medium text-muted">{chain.target}</p>
                {!open && <RiskBadge level="safe">Cut</RiskBadge>}
              </div>
              <p className={cn("font-display text-lg font-semibold leading-snug", !open && "text-subtle line-through")}>{hit.title}</p>
              <Needs needs={hit.needs} exposed={exposed} />
              <div className="mt-auto">
                <Source c={hit} />
              </div>
            </Card>
          );
        })}
      </ul>
    </section>
  );
}

/** Under the fix list: how many published scams still fit what is public, falling as fixes are ticked. */
export function OpenCases({ cases, findings, removedFindingIds = [], className }: Omit<Props, "chains">) {
  const exposed = useMemo(() => exposedCategories(findings, removedFindingIds), [findings, removedFindingIds]);
  if (!cases.all.length) return null;
  const open = cases.all.filter((c) => caseOpen(c.needs, exposed));
  const shown = cases.all.slice(0, 6);
  return (
    <section aria-labelledby="open-cases-h" className={className}>
      <RedactedRule />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 id="open-cases-h" className="sv-display text-[clamp(1.8rem,3.6vw,2.4rem)]">
          Reported scams that fit you
        </h2>
        <p className="sv-num text-3xl" aria-live="polite">
          <span className={open.length < cases.all.length ? "text-safe-fg" : undefined}>{open.length}</span>
          <span className="text-subtle">/{cases.all.length}</span>
        </p>
      </div>
      <Card flush as="ul" className="mt-6 divide-y divide-edge overflow-hidden">
        {shown.map((c) => {
          const isOpen = caseOpen(c.needs, exposed);
          return (
            <li key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className={cn("font-medium leading-snug", !isOpen && "text-subtle line-through")}>{c.title}</p>
                <Source c={c} />
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Needs needs={c.needs} exposed={exposed} />
                {!isOpen && <RiskBadge level="safe">Cut</RiskBadge>}
              </div>
            </li>
          );
        })}
      </Card>
    </section>
  );
}
