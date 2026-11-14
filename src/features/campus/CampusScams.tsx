"use client";

import { useMemo, useState } from "react";
import type { Finding } from "@/lib/types";
import { maskValue } from "@/components/scan/mask";
import { Card, Divider } from "@/design/Card";
import { Chip, RiskBadge } from "@/design/Badge";
import { riskLevel, riskTextColor } from "@/design/risk";
import { cn } from "@/design/utils";
import { matchPatterns, type PatternMatch } from "@/lib/campus/match";
import { CAMPUS_STATS, PATTERNS, type PatternId } from "@/lib/campus/patterns";

export type CampusScamsProps = {
  findings: Finding[];
  /** Named in the heading only. Nothing school-specific is claimed. */
  school?: string;
  /** Projector mode: finding values and the school name are masked. */
  masked?: boolean;
  /** Where a finding chip links. Default is an in-page anchor. */
  findingHref?: (findingId: string) => string;
};

const INITIAL = 4;

export function CampusScams({ findings, school, masked = false, findingHref = (id) => `#finding-${id}` }: CampusScamsProps) {
  const matches = useMemo(() => matchPatterns(findings), [findings]);
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const [filter, setFilter] = useState<PatternId | "all">("all");
  const [showAll, setShowAll] = useState(false);

  const ranked = useMemo(() => {
    const seen = new Set(matches.map((m) => m.pattern.id));
    const rest: PatternMatch[] = PATTERNS.filter((p) => !seen.has(p.id)).map((pattern) => ({ pattern, matchedFindingIds: [], fitScore: 0 }));
    return [...matches, ...rest];
  }, [matches]);

  const visible = ranked.filter((m) => filter === "all" || m.pattern.id === filter);
  const limit = filter === "all" && !showAll ? Math.min(INITIAL, Math.max(matches.length, 1)) : visible.length;
  const shown = visible.slice(0, limit);
  const hidden = visible.length - shown.length;
  const schoolLabel = school ? (masked ? maskValue(school, "school") : school) : null;

  return (
    <section aria-labelledby="campus-h" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 id="campus-h" className="sv-display text-2xl sm:text-3xl">Most likely to work on you</h2>
        {schoolLabel && <Chip>{schoolLabel}</Chip>}
      </header>

      <StatsStrip />

      <div role="group" aria-label="Filter by scam type" className="sv-scroll-x -mx-4 flex gap-2 px-4 pb-1 [mask-image:linear-gradient(to_right,#000_92%,transparent)]">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
        {ranked.map((m) => (
          <FilterChip key={m.pattern.id} active={filter === m.pattern.id} onClick={() => setFilter(m.pattern.id)} dim={!m.fitScore}>
            {m.pattern.name}
          </FilterChip>
        ))}
      </div>

      {matches.length === 0 && (
        <p className="text-muted">Nothing public matches these scams yet. Here is what targets students anyway.</p>
      )}

      <ol className="flex flex-col gap-4">
        {shown.map((m, i) => (
          <li key={m.pattern.id}>
            <ScamCard match={m} rank={filter === "all" ? i + 1 : undefined} byId={byId} masked={masked} findingHref={findingHref} />
          </li>
        ))}
      </ol>

      {hidden > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className="sv-press min-h-12 self-start rounded-control border border-edge-strong px-5 font-semibold hover:border-fg">
          Show {hidden} more
        </button>
      )}
    </section>
  );
}

function FilterChip({ active, dim, onClick, children }: { active: boolean; dim?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "sv-press min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 font-medium",
        active ? "border-accent bg-accent text-on-accent" : cn("border-edge-strong hover:border-fg", dim ? "text-muted" : "text-fg"),
      )}
    >
      {children}
    </button>
  );
}

function StatsStrip() {
  return (
    <ul className="grid gap-3 sm:grid-cols-3" aria-label="Headline numbers">
      {CAMPUS_STATS.map((s) => (
        <li key={s.id} className="sv-card flex flex-col gap-1 p-4">
          <span className="sv-num text-3xl">{s.figure}</span>
          <span className="text-muted">{s.label}</span>
          <a href={s.source.url} target="_blank" rel="noopener noreferrer" className="mt-1 text-sm underline underline-offset-4 hover:text-fg">
            {s.source.title}, {s.year}
          </a>
        </li>
      ))}
    </ul>
  );
}

function ScamCard({
  match,
  rank,
  byId,
  masked,
  findingHref,
}: {
  match: PatternMatch;
  rank?: number;
  byId: Map<string, Finding>;
  masked: boolean;
  findingHref: (id: string) => string;
}) {
  const { pattern, matchedFindingIds, fitScore } = match;
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const facts = matchedFindingIds.map((id) => byId.get(id)).filter((f): f is Finding => !!f);
  const whyByCategory = new Map(pattern.fuel.map((f) => [f.category, f.why]));

  return (
    <Card as="article" className="flex flex-col gap-5" aria-labelledby={`p-${pattern.id}`}>
      <div className="flex items-start gap-4">
        {rank !== undefined && <span className="sv-num w-8 shrink-0 text-3xl text-muted" aria-hidden>{rank}</span>}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={`p-${pattern.id}`} className="sv-display text-xl">{pattern.name}</h3>
          <p className="text-muted">{pattern.tagline}</p>
        </div>
        {fitScore > 0 ? (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="sv-num text-3xl" style={{ color: riskTextColor(fitScore) }}>{fitScore}</span>
            <RiskBadge level={riskLevel(fitScore)}>{fitScore >= 70 ? "Likely" : fitScore >= 40 ? "Possible" : "Weak"}</RiskBadge>
          </div>
        ) : (
          <Chip className="shrink-0">No match</Chip>
        )}
      </div>

      {facts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="font-display text-lg font-semibold">Facts that feed it</h4>
          <ul className="flex flex-col gap-2">
            {facts.map((f) => (
              <li key={f.id} className="flex flex-col items-start gap-1">
                <a href={findingHref(f.id)} className="sv-evidence rounded-chip border border-edge px-2 py-0.5 text-sm hover:border-fg">
                  {f.label}: {masked ? maskValue(f.value, f.category) : f.value}
                </a>
                <span className="text-sm text-muted">{whyByCategory.get(f.category) ?? "Makes the pitch sound specific to you."}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h4 className="font-display text-lg font-semibold">Red flags</h4>
        <ul className="flex flex-col">
          {pattern.redFlags.map((flag, i) => (
            <li key={flag}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                <input
                  type="checkbox"
                  checked={checked.has(i)}
                  onChange={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className="mt-0.5 size-5 shrink-0 cursor-pointer"
                />
                <span className={cn(checked.has(i) && "text-muted line-through")}>{flag}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-control border border-edge-strong p-4">
        <span className="font-display text-lg font-semibold">Do this</span>
        <p className="mt-1 font-medium">{pattern.action}</p>
      </div>

      <details className="group">
        <summary className="min-h-11 cursor-pointer select-none py-2 font-semibold text-muted hover:text-fg">How it starts, where to report, sources</summary>
        <div className="flex flex-col gap-4 pt-2">
          <p>{pattern.opener}</p>
          <Divider />
          <LinkRow label="Report to" items={pattern.report} />
          <LinkRow label="Sources" items={pattern.sources} />
        </div>
      </details>
    </Card>
  );
}

function LinkRow({ label, items }: { label: string; items: { title: string; url: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-semibold text-muted">{label}</span>
      <ul className="flex flex-col gap-1">
        {items.map((s) => (
          <li key={s.url + s.title}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4 hover:text-fg">
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
