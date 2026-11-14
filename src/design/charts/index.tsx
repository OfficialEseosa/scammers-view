"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  LabelList,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";
import type { AttackChain, Finding, FindingCategory, SourceType } from "@/lib/types";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/design/ui/chart";
import { riskColor, riskLevel } from "../risk";
import { usePrefersReducedMotion } from "../motion";
import { cn } from "../utils";

/*
 * Monochrome charts: ink on the page colour with grey steps. Risk colour appears
 * only on the mark that carries risk (a score, a high-risk bar end). Every chart
 * has a text equivalent (sr-only table or direct labels).
 */

const SOURCE_NAME: Record<SourceType, string> = {
  web: "Web",
  github: "GitHub",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  x: "X",
  bluesky: "Bluesky",
  tiktok: "TikTok",
  school: "School",
  broker: "Brokers",
  personal_site: "Personal site",
  news: "News",
  other: "Other",
};

const CATEGORY_NAME: Record<FindingCategory, string> = {
  school: "School",
  employer: "Work",
  email: "Email",
  phone: "Phone",
  location: "Location",
  relative: "Family",
  pet: "Pets",
  birthday: "Birthday",
  handle: "Handles",
  photo: "Photos",
  schedule: "Routine",
  interest: "Interests",
  other: "Other",
  video: "Videos",
};

const ink: ChartConfig = { v: { label: "Value", color: "var(--text)" } };

function SrTable({ caption, rows }: { caption: string; rows: [string, string | number][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------------------------------------------------------- findings over time */

/** Risk piling up as facts arrive: running sum of risk weight, in arrival order. */
export function FindingsSparkline({ findings, className, height = 72 }: { findings: Finding[]; className?: string; height?: number }) {
  const reduced = usePrefersReducedMotion();
  const data = useMemo(() => {
    // Arrival order (the feed is newest-first); y is the running sum of risk weight.
    const arrived = [...findings].reverse();
    const pts: { i: number; v: number }[] = [{ i: 0, v: 0 }];
    for (let i = 0; i < arrived.length; i++) pts.push({ i: i + 1, v: pts[i].v + arrived[i].riskWeight });
    return pts;
  }, [findings]);
  return (
    <div className={cn("w-full", className)}>
      <ChartContainer config={ink} className="aspect-auto w-full text-sm" style={{ height }} initialDimension={{ width: 320, height }}>
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <pattern id="sv-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text)" strokeWidth="1" strokeOpacity="0.28" />
            </pattern>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis hide domain={[0, "dataMax + 1"]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke="var(--text)"
            strokeWidth={2}
            fill="url(#sv-hatch)"
            isAnimationActive={!reduced}
            animationDuration={400}
            dot={false}
          />
        </AreaChart>
      </ChartContainer>
      <SrTable caption="Risk found so far" rows={[["Facts", findings.length], ["Total risk weight", data[data.length - 1].v]]} />
    </div>
  );
}

/* ---------------------------------------------------------------- by source */

/** Facts per source, horizontal bars, direct labels. High-risk sources get a red end-cap. */
export function SourceBars({ findings, className, max = 6 }: { findings: Finding[]; className?: string; max?: number }) {
  const rows = useMemo(() => {
    const m = new Map<SourceType, { n: number; risk: number }>();
    for (const f of findings) {
      const r = m.get(f.sourceType) ?? { n: 0, risk: 0 };
      r.n += 1;
      r.risk = Math.max(r.risk, f.riskWeight);
      m.set(f.sourceType, r);
    }
    return [...m.entries()]
      .map(([s, r]) => ({ name: SOURCE_NAME[s], v: r.n, hot: r.risk >= 7 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, max);
  }, [findings, max]);
  const top = Math.max(1, ...rows.map((r) => r.v));
  if (!rows.length) return <BarsSkeleton className={className} />;
  return (
    <ul className={cn("flex flex-col gap-2", className)} aria-label="Facts by source">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[6.5rem_1fr_2ch] items-center gap-3 text-sm">
          <span className="truncate text-muted">{r.name}</span>
          <span className="relative h-2.5 overflow-hidden rounded-[2px] bg-[color-mix(in_srgb,var(--text)_8%,transparent)]">
            <span
              className="absolute inset-y-0 left-0 rounded-[2px] bg-fg transition-[width] duration-500 ease-[var(--ease-out)] motion-reduce:transition-none"
              style={{ width: `${(r.v / top) * 100}%` }}
            />
            {r.hot && (
              <span
                aria-hidden
                className="absolute inset-y-0 w-1 bg-danger transition-[left] duration-500 motion-reduce:transition-none"
                style={{ left: `calc(${(r.v / top) * 100}% - 4px)` }}
              />
            )}
          </span>
          <span className="sv-num text-right text-base text-fg">{r.v}</span>
        </li>
      ))}
    </ul>
  );
}

function BarsSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-hidden>
      {[80, 56, 40].map((w) => (
        <span key={w} className="sv-skeleton block h-2.5" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- exposure by category */

/** Exposure by category: summed risk weight, as a radar. One series, ink only. */
export function ExposureRadar({ findings, className }: { findings: Finding[]; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const data = useMemo(() => {
    const m = new Map<FindingCategory, number>();
    for (const f of findings) m.set(f.category, (m.get(f.category) ?? 0) + f.riskWeight);
    const rows = [...m.entries()].map(([c, v]) => ({ k: CATEGORY_NAME[c], v: Math.round(v) }));
    rows.sort((a, b) => b.v - a.v);
    const top = rows.slice(0, 7);
    while (top.length < 3) top.push({ k: " ".repeat(top.length + 1), v: 0 });
    return top;
  }, [findings]);
  return (
    <div className={cn("w-full", className)}>
      <ChartContainer config={{ v: { label: "Risk", color: "var(--text)" } }} className="mx-auto aspect-square max-h-[320px] w-full text-sm">
        <RadarChart data={data} outerRadius="72%">
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
          <PolarGrid stroke="var(--border)" gridType="polygon" />
          <PolarAngleAxis dataKey="k" tick={{ fill: "var(--muted)", fontSize: 15 }} />
          <Radar
            dataKey="v"
            stroke="var(--text)"
            strokeWidth={2}
            fill="var(--text)"
            fillOpacity={0.14}
            dot={{ r: 3.5, fill: "var(--text)", strokeWidth: 0 }}
            isAnimationActive={!reduced}
            animationDuration={700}
          />
        </RadarChart>
      </ChartContainer>
      <SrTable caption="Risk by category" rows={data.filter((d) => d.v > 0).map((d) => [d.k, d.v])} />
    </div>
  );
}

/* ---------------------------------------------------------------- before / after */

/** Two numbers, two bars: before in its risk colour, after in safe. */
export function BeforeAfter({ before, after, className }: { before: number; after: number; className?: string }) {
  const rows = [
    { k: "Now", v: before, color: riskColor(before) },
    { k: "After the top fixes", v: after, color: "var(--safe)" },
  ];
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {rows.map((r) => (
        <div key={r.k} className="grid grid-cols-[1fr_auto] items-end gap-x-4 gap-y-2">
          <span className="text-sm text-muted">{r.k}</span>
          <span className="sv-num row-span-2 text-4xl leading-none" style={{ color: r.k === "Now" ? `var(--${riskLevel(r.v)}-fg)` : "var(--safe-fg)" }}>
            {r.v}
          </span>
          <span className="relative h-3 overflow-hidden rounded-[2px] bg-[color-mix(in_srgb,var(--text)_8%,transparent)]">
            <span
              className="absolute inset-y-0 left-0 rounded-[2px] transition-[width] duration-700 ease-[var(--ease-out)] motion-reduce:transition-none"
              style={{ width: `${r.v}%`, background: r.color }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- score drop per fix */

/** Points each fix removes, in order. Ink bars; done fixes go safe. */
export function FixDropBars({
  fixes,
  className,
}: {
  fixes: { id: string; title: string; drop: number; done: boolean }[];
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const data = fixes.filter((f) => f.drop > 0).map((f, i) => ({ k: String(i + 1), title: f.title, v: f.drop, done: f.done }));
  if (!data.length) return null;
  return (
    <div className={cn("w-full", className)}>
      <ChartContainer config={{ v: { label: "Points", color: "var(--text)" } }} className="aspect-auto h-36 w-full text-sm">
        <BarChart data={data} margin={{ top: 22, right: 4, bottom: 0, left: 4 }} barCategoryGap="22%">
          <XAxis dataKey="k" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fill: "var(--muted)", fontSize: 15 }} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(_, p) => (p?.[0]?.payload as { title?: string } | undefined)?.title ?? ""}
                formatter={(v) => <span className="sv-num text-base">−{String(v)} points</span>}
              />
            }
          />
          <Bar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={!reduced} animationDuration={500}>
            {data.map((d) => (
              <Cell key={d.k} fill={d.done ? "var(--safe)" : "var(--text)"} />
            ))}
            <LabelList dataKey="v" position="top" formatter={(v: unknown) => `−${String(v)}`} className="fill-[var(--text)] font-semibold" fontSize={15} />
          </Bar>
        </BarChart>
      </ChartContainer>
      <SrTable caption="Points each fix removes" rows={data.map((d) => [d.title, `−${d.v}`])} />
    </div>
  );
}

/* ---------------------------------------------------------------- risk distribution */

/** How many facts sit at each risk weight band. */
export function RiskHistogram({ findings, className }: { findings: Finding[]; className?: string }) {
  const bands = useMemo(() => {
    const b = [
      { k: "Low", v: 0, level: "safe" as const },
      { k: "Medium", v: 0, level: "warn" as const },
      { k: "High", v: 0, level: "danger" as const },
    ];
    for (const f of findings) b[f.riskWeight >= 7 ? 2 : f.riskWeight >= 4 ? 1 : 0].v += 1;
    return b;
  }, [findings]);
  const total = Math.max(1, findings.length);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-[2px]" aria-hidden>
        {bands.map((b) =>
          b.v ? (
            <span
              key={b.k}
              className="h-full transition-[flex-grow] duration-500 motion-reduce:transition-none"
              style={{ flexGrow: b.v, background: b.level === "danger" ? "var(--danger)" : `color-mix(in srgb, var(--text) ${b.level === "warn" ? 55 : 25}%, transparent)` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
        {bands.map((b) => (
          <li key={b.k} className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full" style={{ background: b.level === "danger" ? "var(--danger)" : `color-mix(in srgb, var(--text) ${b.level === "warn" ? 55 : 25}%, transparent)` }} />
            {b.k} <span className="sv-num text-fg">{b.v}</span>
            <span className="sr-only">of {total}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Chains still open vs cut, as a compact strip. */
export function ChainTally({ chains, broken }: { chains: AttackChain[]; broken: string[] }) {
  return (
    <ul className="flex gap-1" aria-label={`${broken.length} of ${chains.length} ways in cut`}>
      {chains.map((c) => (
        <li key={c.id} className={cn("h-2 flex-1 rounded-[2px]", broken.includes(c.id) ? "bg-safe" : "bg-fg")} />
      ))}
    </ul>
  );
}
