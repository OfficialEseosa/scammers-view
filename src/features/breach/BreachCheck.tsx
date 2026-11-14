"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { Chip } from "@/design/Badge";
import { ErrorState, Skeleton } from "@/design/states";
import { cn } from "@/design/utils";
import { breachFixes, breachesToFindings, classRule, type BreachFix } from "@/lib/breach/toFindings";
import { PROVIDER_NAME, type BreachInfo, type BreachOutcome, type BreachResult } from "@/lib/breach/types";

export interface BreachCheckProps {
  /** Hide the email in the header. */
  masked?: boolean;
  /** Shown in the header only. The request never carries it. */
  email?: string;
  /** Skip the network and show this outcome after the click. For labs and demos. */
  fixture?: BreachOutcome;
  /** Fires with the result so other views can reuse the findings. */
  onResult?: (result: BreachResult) => void;
  className?: string;
}

type View = { status: "idle" } | { status: "loading" } | BreachOutcome;

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"•".repeat(5)}@${"•".repeat(5)}${domain.slice(domain.lastIndexOf("."))}`;
}

function isHigh(dataClass: string): boolean {
  return (classRule(dataClass)?.weight ?? 0) >= 7;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  // Providers that only know a year are normalised to Jan 1.
  if (m === "01" && d === "01") return y;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `${month} ${y}`;
}

export function BreachCheck({ masked, email, fixture, onResult, className }: BreachCheckProps) {
  const [view, setView] = useState<View>({ status: "idle" });
  const [until, setUntil] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setView({ status: "loading" });
    let next: View;
    try {
      if (fixture) {
        await new Promise((r) => setTimeout(r, 700));
        next = fixture;
      } else {
        const res = await fetch("/api/breach", { cache: "no-store", signal: ac.signal });
        if (res.status === 401) next = { status: "error", message: "Sign in to check your email." };
        else {
          const json = (await res.json()) as BreachOutcome;
          next = json && typeof json === "object" && "status" in json ? json : { status: "error", message: "Unexpected reply." };
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      next = { status: "error", message: "Could not reach the server." };
    }
    setView(next);
    if (next.status === "ok") onResult?.(next.result);
    if (next.status === "rate_limited") setUntil(Date.now() + next.retryAfterSeconds * 1000);
  }, [fixture, onResult]);

  const shownEmail = email ? (masked ? maskEmail(email) : email) : null;

  return (
    <Card className={cn("flex flex-col gap-6", className)} aria-live="polite">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-semibold">Breach check</h2>
          {shownEmail && <p className="sv-evidence mt-1 truncate text-sm text-muted">{shownEmail}</p>}
        </div>
        {view.status !== "idle" && view.status !== "loading" && (
          <Button variant="secondary" size="sm" onClick={run}>
            Check again
          </Button>
        )}
      </header>

      {view.status === "idle" && (
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={run}>Check my email</Button>
          <span className="text-sm text-muted">Sends your sign-in email to a breach service.</span>
        </div>
      )}

      {view.status === "loading" && <BreachSkeleton />}

      {view.status === "error" && (
        <ErrorState title="Check failed" detail={view.message} action={<Button variant="secondary" size="sm" onClick={run}>Try again</Button>} />
      )}

      {view.status === "not_configured" && (
        <div className="rounded-card border border-dashed border-edge-strong p-5">
          <p className="font-display text-lg font-semibold">Not set up</p>
          <p className="mt-1 text-muted">Add HIBP_API_KEY to turn this on.</p>
        </div>
      )}

      {view.status === "rate_limited" && (
        <RateLimited seconds={view.retryAfterSeconds} until={until} onRetry={run} />
      )}

      {view.status === "ok" && <Results result={view.result} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ states */

function BreachSkeleton() {
  return (
    <div role="status" aria-label="Checking" className="flex flex-col gap-6">
      <span className="sv-skeleton block h-8 w-2/3" />
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <span className="sv-skeleton block h-4 w-1/3" />
            <span className="sv-skeleton block h-6 w-3/4" />
          </div>
        ))}
      </div>
      <Skeleton lines={2} label="Loading fixes" />
    </div>
  );
}

function RateLimited({ seconds, until, onRetry }: { seconds: number; until: number | null; onRetry: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil(((until ?? now + seconds * 1000) - now) / 1000));
  const label = left >= 120 ? `${Math.ceil(left / 60)} min` : `${left} s`;
  return (
    <div className="rounded-card border border-warn/60 bg-surface p-5">
      <p className="flex items-center gap-2 font-display text-lg font-semibold">
        <span aria-hidden className="size-2 rounded-full bg-warn" />
        Too many checks
      </p>
      <p className="mt-1 text-muted">
        Try again in <span className="sv-num text-fg">{label}</span>.
      </p>
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={onRetry} disabled={left > 0}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ results */

function Results({ result }: { result: BreachResult }) {
  const { breaches } = result;
  const fixes = useMemo(() => breachFixes(result), [result]);
  const findings = useMemo(() => breachesToFindings(result), [result]);
  const withPw = breaches.filter((b) => b.dataClasses.some((c) => classRule(c)?.kind === "password")).length;
  const src = PROVIDER_NAME[result.provider];

  return (
    <div className="flex flex-col gap-8">
      {breaches.length === 0 ? (
        <div className="flex items-center gap-3">
          <span aria-hidden className="size-3 rounded-full bg-safe" />
          <p className="font-display text-2xl font-semibold">Not in any known breach</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <p data-testid="breach-summary" className="flex flex-col">
              <span className="sv-num text-6xl leading-none">{breaches.length}</span>
              <span className="mt-2 text-lg">{breaches.length === 1 ? "breach" : "breaches"}</span>
            </p>
            {withPw > 0 && (
              <p className="flex flex-col">
                <span className="sv-num text-6xl leading-none text-danger-fg">{withPw}</span>
                <span className="mt-2 text-lg">with a password</span>
              </p>
            )}
            <p className="flex flex-col">
              <span className="sv-num text-6xl leading-none">{findings.length}</span>
              <span className="mt-2 text-lg">risky exposures</span>
            </p>
          </div>
          <ClassChart breaches={breaches} />
          <Timeline breaches={breaches} />
          {fixes.length > 0 && <Fixes fixes={fixes} />}
        </>
      )}
      <p className="text-sm text-muted">
        Source:{" "}
        <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-fg underline underline-offset-4">
          {src.name}
        </a>
        . Checked {new Date(result.checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
      </p>
    </div>
  );
}

function ClassChart({ breaches }: { breaches: BreachInfo[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of breaches) for (const c of new Set(b.dataClasses)) m.set(c, (m.get(c) ?? 0) + 1);
    return [...m.entries()]
      .map(([k, v]) => ({ k, v, hot: isHigh(k) }))
      .sort((a, b) => Number(b.hot) - Number(a.hot) || b.v - a.v || a.k.localeCompare(b.k))
      .slice(0, 8);
  }, [breaches]);
  const top = Math.max(1, ...rows.map((r) => r.v));
  return (
    <section aria-label="Data exposed">
      <h3 className="mb-3 font-display text-lg font-semibold">What was exposed</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.k} className="grid grid-cols-[minmax(0,9.5rem)_1fr_2ch] items-center gap-3 sm:grid-cols-[14rem_1fr_2ch]">
            <span className="truncate text-muted" title={r.k}>{r.k}</span>
            <span className="relative h-4 overflow-hidden rounded-r-[4px] bg-[color-mix(in_srgb,var(--text)_7%,transparent)]">
              <span
                className={`absolute inset-y-0 left-0 origin-left animate-[sv-grow_700ms_var(--ease-out)_both] rounded-r-[4px] ${r.hot ? "bg-danger" : "bg-fg"}`}
                style={{ width: `${(r.v / top) * 100}%` }}
              />
            </span>
            <span className="sv-num text-right text-base text-fg">{r.v}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Timeline({ breaches }: { breaches: BreachInfo[] }) {
  return (
    <section aria-label="Breaches">
      <h3 className="mb-3 font-display text-lg font-semibold">Timeline</h3>
      <ol className="flex flex-col">
        {breaches.map((b) => (
          <li key={`${b.name}-${b.date}`} className="grid grid-cols-[4.5rem_1fr] gap-x-4 border-t border-edge py-4 first:border-t-0 first:pt-0 sm:grid-cols-[5.5rem_1fr]">
            <time dateTime={b.date} className="sv-num pt-0.5 text-sm text-muted">{fmtDate(b.date)}</time>
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2 font-semibold">
                {b.name}
                {b.domain && <span className="sv-evidence text-sm font-normal text-subtle">{b.domain}</span>}
                {b.verified === false && <span className="text-sm font-normal text-muted">unverified</span>}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {[...b.dataClasses]
                  .sort((a, c) => Number(isHigh(c)) - Number(isHigh(a)))
                  .map((c) => (
                    <li key={c}>
                      <Chip className={cn(isHigh(c) && "border-transparent bg-[var(--danger-tint)] text-danger-fg")}>
                        {isHigh(c) && <span aria-hidden className="size-1.5 rounded-full bg-danger" />}
                        {c}
                      </Chip>
                    </li>
                  ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Fixes({ fixes }: { fixes: BreachFix[] }) {
  return (
    <section aria-label="Fixes">
      <h3 className="mb-3 font-display text-lg font-semibold">What to do</h3>
      <ol className="flex flex-col gap-3">
        {fixes.map((f, i) => (
          <li key={f.id} className="rounded-card border border-edge p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">
                <span className="sv-num mr-2 text-muted">{i + 1}</span>
                {f.title}
              </p>
              <Chip className="shrink-0">{f.effort}</Chip>
            </div>
            <p className="mt-1 text-muted">{f.why}</p>
            <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-muted marker:text-subtle">
              {f.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            {f.link && (
              <a href={f.link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center text-fg underline underline-offset-4">
                Open the service&apos;s 2FA guide
              </a>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
