"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AttackChain, ExposureScore, Finding } from "@/lib/types";
import { maskIn } from "@/components/scan/mask";
import { riskColor, riskTextColor } from "@/design/risk";
import { buttonClass } from "@/design/Button";
import { Chip, RiskBadge, RiskDot } from "@/design/Badge";
import { EmptyState, WarnNote } from "@/design/states";
import { NumberTicker } from "@/design/NumberTicker";
import { RedactedValue } from "@/design/RedactedValue";
import { FixDropBars } from "@/design/charts";
import { planFixes } from "@/lib/fixes/plan";
import { computeExposure } from "@/lib/fixes/score";
import type { Fix } from "@/lib/fixes/types";
import { mailtoHref } from "@/lib/fixes/optout";

export interface FixListProps {
  findings: Finding[];
  chains: AttackChain[];
  /** The server's score; the deterministic model is scaled to match it. */
  score: ExposureScore | null;
  /** Projector mode: finding values are masked wherever they appear. */
  masked: boolean;
  /** Emits every finding the user has fixed so far (the attack map greys these out). */
  onRemovedChange?: (removedFindingIds: string[]) => void;
}

export function FixList({ findings, chains, score, masked, onRemovedChange }: FixListProps) {
  const anchor = score?.score;
  const fixes = useMemo(() => planFixes(findings, chains, anchor), [findings, chains, anchor]);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  // Drop ticks for fixes that no longer exist (the scan can stream in more findings).
  const liveDone = useMemo(() => new Set(fixes.filter((f) => done.has(f.id)).map((f) => f.id)), [fixes, done]);

  const removedIds = useMemo(() => {
    const s = new Set<string>();
    for (const f of fixes) if (liveDone.has(f.id)) for (const id of f.removesFindingIds) s.add(id);
    return [...s].sort();
  }, [fixes, liveDone]);

  const result = useMemo(() => computeExposure(findings, chains, removedIds, anchor), [findings, chains, removedIds, anchor]);

  const notify = useRef(onRemovedChange);
  useEffect(() => {
    notify.current = onRemovedChange;
  });
  const key = removedIds.join("|");
  useEffect(() => {
    notify.current?.(key ? key.split("|") : []);
  }, [key]);

  const toggle = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const top = useMemo(() => fixes.filter((f) => f.removesFindingIds.length > 0).slice(0, 3), [fixes]);
  const rest = useMemo(() => fixes.filter((f) => !top.includes(f)), [fixes, top]);

  const topResult = useMemo(
    () => computeExposure(findings, chains, top.flatMap((f) => f.removesFindingIds), anchor),
    [findings, chains, top, anchor],
  );

  if (!findings.length) {
    return <EmptyState className="mx-4 mt-6 sm:mx-0">Nothing public turned up, so there is nothing to lock down.</EmptyState>;
  }

  const minutesTotal = top.reduce((n, f) => n + minutes(f), 0);

  return (
    <section aria-labelledby="fixes-h" className="relative">
      <Meter before={result.baselineScore} after={result.score} broken={result.brokenChainIds.length} total={chains.length} doneCount={liveDone.size} />

      <div className="px-4 pt-10 sm:px-0">
        <h2 id="fixes-h" className="sv-display text-[clamp(2.2rem,5vw,3.5rem)] leading-[0.98]">
          Fix these {top.length === 1 ? "first" : `${top.length} first`}
        </h2>
        <dl className="mt-6 grid grid-cols-3 divide-x divide-edge border-y border-edge">
          <Stat label="Points off" value={`−${result.baselineScore - topResult.score}`} tone="safe" />
          <Stat label="Ways in cut" value={chains.length ? `${topResult.brokenChainIds.length}/${chains.length}` : "0"} />
          <Stat label="Minutes" value={`~${minutesTotal}`} />
        </dl>
        <FixDropBars
          className="mt-6"
          fixes={top.map((f) => ({ id: f.id, title: f.title, drop: f.scoreDrop, done: liveDone.has(f.id) }))}
        />
        <ChainStrip chains={chains} status={result.chainStatus} />
      </div>

      <ol className="mt-8 grid gap-4 px-4 sm:px-0">
        {top.map((f, i) => (
          <li key={f.id}>
            <FixCard
              fix={f}
              rank={i + 1}
              featured
              done={liveDone.has(f.id)}
              onToggle={() => toggle(f.id)}
              findings={findings}
              chains={chains}
              masked={masked}
              afterAbove={i > 0}
            />
          </li>
        ))}
      </ol>

      {rest.length > 0 && (
        <>
          <h3 className="mt-14 px-4 font-display text-2xl font-semibold sm:px-0">Then these</h3>
          <ul className="mt-4 grid gap-2 px-4 sm:px-0">
            {rest.map((f) => (
              <li key={f.id}>
                <FixCard
                  fix={f}
                  featured={false}
                  done={liveDone.has(f.id)}
                  onToggle={() => toggle(f.id)}
                  findings={findings}
                  chains={chains}
                  masked={masked}
                  afterAbove
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function minutes(f: Fix) {
  return f.effort === "1 min" ? 1 : f.effort === "5 min" ? 5 : 15;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "safe" }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-4 first:pl-0 sm:px-5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`sv-num text-3xl leading-none sm:text-4xl ${tone === "safe" ? "text-safe-fg" : ""}`}>{value}</dd>
    </div>
  );
}

/* ------------------------------ sticky before / after ------------------------------ */

function Meter({ before, after, broken, total, doneCount }: { before: number; after: number; broken: number; total: number; doneCount: number }) {
  const drop = before - after;
  return (
    <div className="sticky top-[4.1rem] z-20 border-b border-edge bg-canvas/90 px-4 py-3 backdrop-blur-xl sm:px-0" role="status" aria-live="polite">
      <div className="flex items-center gap-4">
        <div className="flex items-baseline gap-3">
          <span className="sv-num text-2xl leading-none tabular-nums" style={{ color: riskTextColor(before) }} aria-label={`Before ${before}`}>
            {before}
          </span>
          <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden className="text-muted">
            <path d="M1 6h18M14 1.5 19.5 6 14 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="sv-num text-5xl leading-none tabular-nums sm:text-6xl" style={{ color: drop > 0 ? "var(--safe-fg)" : riskTextColor(after) }} aria-label={`After ${after}`}>
            <NumberTicker value={after} />
          </span>
          <span className="text-sm text-muted max-sm:hidden">exposure</span>
        </div>
        <div className="ml-auto text-right">
          <div className="sv-num text-2xl leading-none">
            {broken}
            <span className="text-muted">/{total}</span>
          </div>
          <div className="mt-1 text-sm text-muted">cut</div>
        </div>
      </div>
      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)]" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-full opacity-35" style={{ width: `${before}%`, background: riskColor(before) }} />
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-700 ease-[var(--ease-out)] motion-reduce:transition-none"
          style={{ width: `${after}%`, background: drop > 0 ? "var(--safe)" : riskColor(after) }}
        />
      </div>
      <p className="mt-2 text-sm text-muted">{doneCount === 0 ? "Tick each fix as you do it" : `${doneCount} done, −${drop}`}</p>
    </div>
  );
}

function ChainStrip({ chains, status }: { chains: AttackChain[]; status: Record<string, { broken: boolean }> }) {
  if (!chains.length) return null;
  return (
    <ul className="mt-6 grid gap-2 sm:grid-cols-2">
      {chains.map((c) => {
        const broken = status[c.id]?.broken;
        return (
          <li key={c.id} className="flex min-h-12 items-center gap-3 rounded-control border border-edge px-3 transition-colors duration-300 motion-reduce:transition-none">
            {broken ? (
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden className="shrink-0 text-safe">
                <path d="M4 10.5 8 14.5 16 5.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <RiskDot level="danger" />
            )}
            <span className={broken ? "text-muted line-through decoration-safe" : ""}>{c.target}</span>
            <span className="ml-auto text-sm text-muted">{broken ? "Cut" : "Open"}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------ cards ------------------------------ */

interface CardProps {
  fix: Fix;
  rank?: number;
  featured: boolean;
  done: boolean;
  onToggle: () => void;
  findings: Finding[];
  chains: AttackChain[];
  masked: boolean;
  afterAbove: boolean;
}

function FixCard(p: CardProps) {
  const { fix, featured, done } = p;
  const body = (
    <>
      <ol className="mt-5 grid list-decimal gap-2 pl-6 text-lg leading-snug marker:font-display marker:text-muted">
        {fix.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <DoneToggle done={done} onToggle={p.onToggle} />
        {fix.link && (
          <a href={fix.link} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "md")}>
            {fix.kind === "broker" ? "Open opt-out page" : fix.kind === "takedown" ? "Open the page" : fix.kind === "2fa" ? "Open security settings" : "Open settings"}
          </a>
        )}
      </div>
      {fix.link && fix.linkConfirmed === false && <WarnNote className="mt-3 text-sm">Link not verified. Search the app&apos;s settings if it doesn&apos;t open.</WarnNote>}
      {fix.extraLinks && fix.extraLinks.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-base">
          {fix.extraLinks.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-muted">
                {l.label}
              </a>
              {!l.confirmed && <span className="ml-1 text-sm text-warn-fg">unverified</span>}
            </li>
          ))}
        </ul>
      )}
      {fix.optout && <OptOut fix={fix} findings={p.findings} masked={p.masked} />}
      <Why {...p} />
    </>
  );

  const head = (
    <div className="flex items-start gap-4">
      {featured && p.rank != null && (
        <span
          aria-hidden
          className={`grid size-11 shrink-0 place-items-center rounded-full font-display text-xl font-semibold transition-colors duration-300 ${done ? "bg-safe text-black" : "bg-fg text-canvas"}`}
        >
          {done ? (
            <svg width="18" height="18" viewBox="0 0 20 20">
              <path d="M4 10.5 8 14.5 16 5.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            p.rank
          )}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className={`font-display font-semibold leading-tight ${featured ? "text-2xl sm:text-[1.75rem]" : "text-lg"} ${done ? "text-muted line-through decoration-safe decoration-2" : ""}`}>{fix.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip>{fix.effort}</Chip>
          {fix.scoreDrop > 0 ? (
            <RiskBadge level="safe">
              −{fix.scoreDrop}
              {p.afterAbove ? " after the above" : ""}
            </RiskBadge>
          ) : (
            <Chip>{fix.kind === "2fa" ? "No score change" : "Counted above"}</Chip>
          )}
          {fix.breaksChainIds.length > 0 && <RiskBadge level="danger">Cuts a way in</RiskBadge>}
        </div>
      </div>
    </div>
  );

  if (featured) {
    return (
      <article className={`sv-card p-5 transition-colors duration-300 motion-reduce:transition-none sm:p-6 ${done ? "border-safe/60" : ""}`}>
        {head}
        <div className="sm:pl-15">{body}</div>
      </article>
    );
  }
  return (
    <details className={`group sv-card p-4 ${done ? "border-safe/50" : ""}`}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">{head}</div>
          <span aria-hidden className="mt-0.5 grid size-8 place-items-center rounded-full border border-edge text-muted transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none">
            +
          </span>
        </div>
      </summary>
      <div className="pt-1">{body}</div>
    </details>
  );
}

function DoneToggle({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={done}
      onClick={onToggle}
      className={`sv-press inline-flex min-h-12 items-center gap-2.5 rounded-control px-5 text-base font-semibold ${
        done ? "bg-safe text-black" : "bg-accent text-on-accent hover:opacity-90"
      }`}
    >
      <span aria-hidden className={`grid size-5 place-items-center rounded-[4px] border-[1.5px] ${done ? "border-black bg-black text-safe" : "border-current"}`}>
        {done && (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {done ? "Done" : "I did this"}
    </button>
  );
}

/* ------------------------------ "see why this matters" ------------------------------ */

function Why({ fix, findings, chains, masked }: CardProps) {
  const ids = new Set(fix.removesFindingIds);
  const facts = findings.filter((f) => ids.has(f.id));
  const involved = chains
    .map((c) => ({
      chain: c,
      steps: c.steps.filter((s) => s.findingIds.some((id) => ids.has(id))),
    }))
    .filter((x) => x.steps.length > 0);
  if (!facts.length && !involved.length) return null;
  return (
    <details className="group/why mt-5 border-t border-edge pt-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-muted transition-transform duration-200 group-open/why:rotate-90">›</span>
        Why
      </summary>
      <div className="mt-2 flex flex-col gap-4">
        <p className="max-w-[62ch] text-muted">{maskIn(fix.why, findings, masked)}</p>
        {facts.length > 0 && (
          <ul className="grid gap-1.5 text-base">
            {facts.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-muted">{f.label}</span>
                <RedactedValue value={f.value} redacted={masked} label={f.label} />
              </li>
            ))}
          </ul>
        )}
        {involved.map(({ chain, steps }) => {
          const breaks = fix.breaksChainIds.includes(chain.id);
          return (
            <div key={chain.id}>
              <p className="font-semibold">
                {chain.target} <span className={`text-sm font-normal ${breaks ? "text-safe-fg" : "text-muted"}`}>{breaks ? "cut" : "weakened"}</span>
              </p>
              <ul className="mt-1 grid gap-2 text-base text-muted">
                {steps.map((s) => {
                  const lost = s.findingIds.every((id) => ids.has(id));
                  return (
                    <li key={s.id}>
                      <span className="text-fg">{s.title}.</span> {maskIn(s.description, findings, masked)}{" "}
                      <span className={lost ? "text-safe-fg" : "text-warn-fg"}>{lost ? "Nothing left to use." : "Other facts still feed this."}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}

/* ------------------------------ removal email draft ------------------------------ */

function OptOut({ fix, findings, masked }: { fix: Fix; findings: Finding[]; masked: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const o = fix.optout!;

  async function draft() {
    setState("loading");
    try {
      const fields = findings
        .filter((f) => o.findingIds.includes(f.id))
        .map((f) => ({ label: f.label, value: f.value }));
      const res = await fetch("/api/fixes/optout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ broker: o.broker, listingUrl: o.listingUrl, fields }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { subject: string; body: string; source: string };
      setSubject(d.subject);
      setText(d.body);
      setSource(d.source);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-5 rounded-control border border-edge bg-sunken p-4">
      {state !== "ready" && (
        <div className="flex flex-col items-start gap-3">
          <button type="button" onClick={draft} disabled={state === "loading"} className={buttonClass("secondary", "md")}>
            {state === "loading" ? "Drafting" : "Draft the removal email"}
          </button>
          <p className="text-sm text-muted">You send it yourself.</p>
          {state === "error" && <p className="text-base text-danger-fg">Drafting failed. Try again, or use the opt-out page.</p>}
        </div>
      )}
      {state === "ready" && (
        <>
          <p className="text-base font-semibold">{masked ? maskIn(subject, findings, true) : subject}</p>
          <textarea
            value={masked ? maskIn(text, findings, true) : text}
            onChange={(e) => setText(e.target.value)}
            readOnly={masked}
            rows={11}
            aria-label="Removal email draft"
            className="sv-evidence mt-2 w-full rounded-control border border-edge bg-canvas p-3 text-sm leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a href={mailtoHref({ subject, body: text })} className={buttonClass("primary", "md")}>
              Open in my mail app
            </a>
            <button type="button" onClick={() => navigator.clipboard?.writeText(text)} className={buttonClass("secondary", "md")}>
              Copy
            </button>
          </div>
          <p className="mt-2 text-sm text-muted">
            {source === "claude" ? "Drafted by Claude" : "From a template"}. Add the broker&apos;s privacy address.
            {masked && " Masked on screen only."}
          </p>
        </>
      )}
    </div>
  );
}
