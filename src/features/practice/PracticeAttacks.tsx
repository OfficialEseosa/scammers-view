"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Finding } from "@/lib/types";
import { maskValue } from "@/components/scan/mask";
import {
  SCENARIOS,
  type PracticeKind,
  type PracticeMessage,
  type PracticeResponse,
  type PracticeScenario,
  type Tell,
  type TellCategory,
  type TellsOnly,
} from "@/lib/practice/schema";
import { segmentBody, visibleTells } from "./segments";
import { SegmentedTabs } from "@/design/SegmentedTabs";
import { Button } from "@/design/Button";
import { PracticeMark } from "@/design/PracticeMark";
import { ErrorState } from "@/design/states";
import { RedactedValue } from "@/design/RedactedValue";
import { cn } from "@/design/utils";

export type PracticeAttacksProps = {
  /** The signed-in person's own findings. */
  findings: Finding[];
  /** Mask personal values (for projecting). */
  masked?: boolean;
};

const CATEGORY_LABEL: Record<TellCategory, string> = {
  urgency: "Pressure to act fast",
  spoofed_sender: "Fake sender",
  personal_detail: "Uses your public info",
  link: "Suspicious link",
  payment_request: "Asks for money",
  too_good: "Too good to be true",
  other: "Red flag",
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PracticeResponse };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Masks every known personal value (findings + the name the message used) in a string. */
function makeMasker(findings: Finding[], extra: string[], on: boolean) {
  if (!on) return (s: string) => s;
  const values = [
    ...findings.map((f) => ({ v: f.value.trim(), c: f.category })),
    ...extra.map((v) => ({ v: v.trim(), c: undefined })),
  ]
    .filter((x) => x.v.length >= 3)
    .sort((a, b) => b.v.length - a.v.length);
  return (s: string) => {
    let out = s;
    for (const { v, c } of values) out = out.replace(new RegExp(escapeRe(v), "gi"), maskValue(v, c));
    return out;
  };
}

export function PracticeAttacks({ findings, masked = false }: PracticeAttacksProps) {
  const [kind, setKind] = useState<PracticeKind>("sms");
  const [scenario, setScenario] = useState<PracticeScenario>("financial_aid_refund");
  const [state, setState] = useState<State>({ status: "idle" });
  const req = useRef(0);

  const generate = useCallback(
    async (k: PracticeKind, sc: PracticeScenario) => {
      const id = ++req.current;
      setState({ status: "loading" });
      try {
        const res = await fetch("/api/practice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ findings, kind: k, scenario: sc }),
        });
        if (id !== req.current) return;
        if (res.status === 401) {
          setState({ status: "error", message: "Sign in to see practice messages built from your own footprint." });
          return;
        }
        if (!res.ok) {
          setState({ status: "error", message: "The practice message didn't load." });
          return;
        }
        const data = (await res.json()) as PracticeResponse;
        if (id === req.current) setState({ status: "ready", data });
      } catch {
        if (id === req.current) setState({ status: "error", message: "Couldn't reach the server." });
      }
    },
    [findings],
  );

  // The message is there the moment the tab opens; tells stay hidden until "Show me".
  useEffect(() => {
    // Deferred so a dev double-mount cancels the first call instead of firing two.
    const t = window.setTimeout(() => void generate(kind, scenario), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickKind = (k: PracticeKind) => {
    setKind(k);
    void generate(k, scenario);
  };
  const pickScenario = (sc: PracticeScenario) => {
    setScenario(sc);
    void generate(kind, sc);
  };

  return (
    <section className="flex flex-col gap-6" aria-label="Practice attacks">
      <header className="flex flex-col gap-5">
        <h2 className="sv-display text-[clamp(2rem,4.4vw,3rem)] leading-[1]">A scam written for you</h2>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs
            role="radiogroup"
            label="Message type"
            value={kind}
            onChange={pickKind}
            items={[
              { id: "sms", label: "Text" },
              { id: "email", label: "Email" },
            ]}
          />
          <div role="radiogroup" aria-label="Scenario" className="sv-scroll-x flex gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={scenario === s.id}
                onClick={() => pickScenario(s.id)}
                className={cn(
                  "sv-press min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium",
                  scenario === s.id ? "border-fg text-fg" : "border-edge text-muted hover:text-fg",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {state.status === "error" && (
        <ErrorState
          title={state.message}
          action={
            <Button variant="secondary" onClick={() => void generate(kind, scenario)}>
              Try again
            </Button>
          }
        />
      )}
      {(state.status === "loading" || state.status === "idle") && <LoadingStage kind={kind} />}
      {state.status === "ready" && state.data.mode === "message" && (
        <MessageLesson key={state.data.body} data={state.data} findings={findings} masked={masked} onAnother={() => void generate(kind, scenario)} />
      )}
      {state.status === "ready" && state.data.mode === "tellsOnly" && <TellsOnlyLesson data={state.data} findings={findings} masked={masked} />}
    </section>
  );
}

/* --------------------------------- Lesson --------------------------------- */

function MessageLesson({ data, findings, masked, onAnother }: { data: PracticeMessage; findings: Finding[]; masked: boolean; onAnother: () => void }) {
  const mask = makeMasker(findings, [data.addressedTo], masked);
  const tells = useMemo(() => visibleTells(data.body, data.tells), [data.body, data.tells]);
  const [revealed, setRevealed] = useState(false);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = tells.find((t) => t.id === activeId) ?? null;
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);

  function pick(t: Tell) {
    setActiveId(t.id);
    if (!revealed) setFound((prev) => new Set(prev).add(t.id));
  }

  const body = <TellBody body={data.body} tells={data.tells} revealed={revealed} found={found} activeId={activeId} onPick={pick} mask={mask} masked={masked} />;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-10">
      <div className="flex min-w-0 flex-col gap-4">
        {data.kind === "sms" ? (
          <PhoneFrame from={mask(data.from.name)} number={data.from.address}>
            {body}
          </PhoneFrame>
        ) : (
          <EmailFrame fromName={mask(data.from.name)} fromAddress={data.from.address} to={mask(data.addressedTo)} subject={mask(data.subject ?? "")}>
            {body}
          </EmailFrame>
        )}
        {data.basedOn && (
          <p className="text-sm text-muted">
            Modelled on{" "}
            <a href={data.basedOn.url} target="_blank" rel="noopener noreferrer" className="text-fg underline underline-offset-4">
              {data.basedOn.title}
            </a>{" "}
            <span className="font-mono text-xs">
              {data.basedOn.source}, {data.basedOn.year}
            </span>
          </p>
        )}
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            onClick={() => {
              const next = !revealed;
              setRevealed(next);
              if (next && !activeId && tells[0]) setActiveId(tells[0].id);
            }}
            aria-pressed={revealed}
          >
            {revealed ? "Hide red flags" : "Show me"}
          </Button>
          <Button variant="ghost" onClick={onAnother}>
            New message
          </Button>
        </div>
        <p className="text-muted" aria-live="polite">
          {revealed ? (
            <>
              <span className="sv-num text-fg">{tells.length}</span> red flags
            </>
          ) : (
            <>
              Tap what looks off. <span className="sv-num text-fg">{found.size}</span> of {tells.length} found
            </>
          )}
        </p>
        <TellCard tell={active} finding={active?.findingId ? byId.get(active.findingId) : undefined} masked={masked} mask={mask} />
        <WhatToDo items={data.whatToDo.map(mask)} />
      </aside>
    </div>
  );
}

function TellBody({
  body,
  tells,
  revealed,
  found,
  activeId,
  onPick,
  mask,
  masked,
}: {
  body: string;
  tells: Tell[];
  masked: boolean;
  revealed: boolean;
  found: Set<string>;
  activeId: string | null;
  onPick: (t: Tell) => void;
  mask: (s: string) => string;
}) {
  const segments = useMemo(() => segmentBody(body, tells), [body, tells]);
  let order = 0;
  return (
    <div
      className="whitespace-pre-wrap break-words select-none"
      style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {segments.map((s, i) => {
        if (!s.tell) return <span key={i}>{mask(s.text)}</span>;
        const t = s.tell;
        const shown = revealed || found.has(t.id);
        const personal = t.category === "personal_detail";
        const isActive = activeId === t.id;
        const idx = order++;
        // A <span role="button"> (not <button>) so the phrase wraps inline with the sentence.
        return (
          <span
            key={i}
            role="button"
            data-tell={t.id}
            tabIndex={shown ? 0 : -1}
            aria-label={shown ? `Red flag: ${CATEGORY_LABEL[t.category]}` : undefined}
            onClick={() => onPick(t)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(t);
              }
            }}
            onMouseEnter={shown ? () => onPick(t) : undefined}
            onFocus={shown ? () => onPick(t) : undefined}
            data-on={shown}
            data-tone={personal ? "personal" : undefined}
            data-active={isActive && shown ? true : undefined}
            className={cn("sv-hl [--hl-bg:var(--frame-ink)] [--hl-fg:var(--frame-screen)]", shown ? "cursor-pointer" : "cursor-text")}
            style={{ ["--hl-i" as string]: revealed ? idx : 0 }}
          >
            {masked && personal ? maskValue(s.text) : mask(s.text)}
          </span>
        );
      })}
    </div>
  );
}

function PhoneFrame({ from, number, children }: { from: string; number: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[23rem]">
      <div className="rounded-[2.75rem] border border-[var(--frame-bezel-edge)] bg-[var(--frame-bezel)] p-2.5 shadow-pop">
        <PracticeMark onLight ink="var(--frame-ink)" className="flex min-h-[32rem] flex-col overflow-hidden rounded-[2.2rem] bg-[var(--frame-screen)] text-[var(--frame-ink)]">
          <div className="mx-auto mt-2.5 h-6 w-24 rounded-full bg-[var(--frame-bezel)]" aria-hidden />
          <div className="flex flex-col items-center gap-1 border-b border-[var(--frame-line)] px-4 pb-3 pt-3">
            <div className="grid size-11 place-items-center rounded-full bg-[var(--frame-bubble)] text-base font-semibold text-[var(--frame-muted)]" aria-hidden>
              {from.slice(0, 1).toUpperCase()}
            </div>
            <p className="text-center text-base font-semibold leading-tight">{from}</p>
            <p className="sv-evidence text-sm text-[var(--frame-muted)]">{number}</p>
          </div>
          <div className="flex flex-1 flex-col gap-1 px-3 py-4">
            <p className="mb-2 text-center text-sm text-[var(--frame-muted)]">Today</p>
            <div className="max-w-[88%] rounded-[1.25rem] rounded-bl-md bg-[var(--frame-bubble)] px-4 py-3 text-[1.0625rem] leading-snug">{children}</div>
          </div>
          <div className="m-3 rounded-full border border-[var(--frame-line)] px-4 py-2 text-sm text-[var(--frame-muted)]" aria-hidden>
            Text message
          </div>
        </PracticeMark>
      </div>
    </div>
  );
}

function EmailFrame({ fromName, fromAddress, to, subject, children }: { fromName: string; fromAddress: string; to: string; subject: string; children: ReactNode }) {
  return (
    <PracticeMark onLight ink="var(--frame-ink)" className="overflow-hidden rounded-card border border-edge bg-[var(--frame-screen)] text-[var(--frame-ink)] shadow-pop">
      <div className="flex items-center gap-1.5 border-b border-[var(--frame-line)] bg-[var(--frame-chrome)] px-4 py-3" aria-hidden>
        <span className="size-2.5 rounded-full bg-[var(--frame-line)]" />
        <span className="size-2.5 rounded-full bg-[var(--frame-line)]" />
        <span className="size-2.5 rounded-full bg-[var(--frame-line)]" />
        <span className="ml-3 text-sm text-[var(--frame-muted)]">Inbox</span>
      </div>
      <div className="border-b border-[var(--frame-line)] px-5 pb-4 pt-5 sm:px-7">
        <p className="pr-24 font-display text-xl font-semibold leading-snug">{subject}</p>
        <div className="mt-3 flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--frame-bubble)] text-sm font-semibold text-[var(--frame-muted)]" aria-hidden>
            {fromName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 text-sm leading-tight">
            <p>
              <span className="font-semibold">{fromName}</span> <span className="sv-evidence break-all text-[var(--frame-muted)]">&lt;{fromAddress}&gt;</span>
            </p>
            <p className="mt-0.5 text-[var(--frame-muted)]">to {to}</p>
          </div>
        </div>
      </div>
      <div className="min-h-[14rem] px-5 py-5 text-[1.0625rem] leading-relaxed sm:px-7">{children}</div>
    </PracticeMark>
  );
}

function FindingSource({ finding, masked, mask }: { finding: Finding; masked: boolean; mask: (s: string) => string }) {
  return (
    <div className="border-t border-edge pt-3 text-sm">
      <p className="text-muted">From your public</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{finding.label}</span>
        <RedactedValue value={finding.value} redacted={masked} label={finding.label} />
      </p>
      <a href={finding.sourceUrl} target="_blank" rel="noopener noreferrer" className="sv-evidence mt-1 inline-block break-all underline underline-offset-2">
        {mask(finding.sourceTitle ?? new URL(finding.sourceUrl, "https://x.example").hostname)}
      </a>
    </div>
  );
}

function TellCard({ tell, finding, masked, mask }: { tell: Tell | null; finding?: Finding; masked: boolean; mask: (s: string) => string }) {
  if (!tell) return null;
  const personal = tell.category === "personal_detail";
  return (
    <div className="sv-card flex animate-[sv-enter_240ms_var(--ease-out)_both] flex-col gap-3 p-5" aria-live="polite">
      <p className="flex items-center gap-2 font-semibold">
        <span aria-hidden className={cn("size-2 rounded-full", personal ? "bg-danger" : "bg-fg")} />
        {CATEGORY_LABEL[tell.category]}
      </p>
      <blockquote className="border-l-2 border-fg pl-3 font-display text-lg leading-snug">&ldquo;{masked && personal ? maskValue(tell.quote) : mask(tell.quote)}&rdquo;</blockquote>
      <p className="text-muted">{mask(tell.explanation)}</p>
      {finding && <FindingSource finding={finding} masked={masked} mask={mask} />}
    </div>
  );
}

function WhatToDo({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="border-t border-edge pt-4">
      <h3 className="mb-3 font-display text-lg font-semibold">If it lands in your inbox</h3>
      <ul className="flex flex-col gap-2.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span aria-hidden className="mt-[0.55em] size-2 shrink-0 rounded-[2px] bg-fg" />
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LoadingStage({ kind }: { kind: PracticeKind }) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-10" role="status" aria-label={`Writing a practice ${kind === "sms" ? "text" : "email"}`}>
      {kind === "sms" ? (
        <div className="mx-auto w-full max-w-[23rem] rounded-[2.75rem] border border-edge p-2.5">
          <div className="flex min-h-[32rem] flex-col gap-3 rounded-[2.2rem] bg-surface p-6">
            <span className="sv-skeleton mx-auto block size-11 rounded-full" />
            <span className="sv-skeleton mx-auto block h-3 w-28" />
            <div className="mt-8 flex flex-col gap-2.5">
              <span className="sv-skeleton block h-3.5 w-[85%]" />
              <span className="sv-skeleton block h-3.5 w-[70%]" />
              <span className="sv-skeleton block h-3.5 w-[78%]" />
              <span className="sv-skeleton block h-3.5 w-[52%]" />
            </div>
          </div>
        </div>
      ) : (
        <div className="sv-card flex min-h-80 flex-col gap-3 p-7">
          <span className="sv-skeleton block h-5 w-1/2" />
          <span className="sv-skeleton block h-3 w-1/3" />
          <span className="sv-skeleton mt-6 block h-3.5 w-[90%]" />
          <span className="sv-skeleton block h-3.5 w-[82%]" />
          <span className="sv-skeleton block h-3.5 w-[64%]" />
        </div>
      )}
      <div className="flex flex-col gap-3">
        <span className="sv-skeleton block h-14 w-40 rounded-control" />
        <span className="sv-skeleton block h-3.5 w-48" />
      </div>
    </div>
  );
}

/* ------------------------------ Tells only -------------------------------- */

function TellsOnlyLesson({ data, findings, masked }: { data: TellsOnly; findings: Finding[]; masked: boolean }) {
  const mask = makeMasker(findings, [], masked);
  const byId = new Map(findings.map((f) => [f.id, f]));
  return (
    <PracticeMark className="sv-card flex flex-col gap-5 overflow-hidden p-5 sm:p-6">
      <p className="max-w-[62ch] pr-24">{data.reason}</p>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">Red flags it would contain</h3>
          <ul className="flex flex-col divide-y divide-edge border-y border-edge">
            {data.tells.map((t) => {
              const f = t.findingId ? byId.get(t.findingId) : undefined;
              return (
                <li key={t.id} className="py-3">
                  <p className="flex items-center gap-2 font-semibold">
                    <span aria-hidden className={cn("size-2 rounded-full", t.category === "personal_detail" ? "bg-danger" : "bg-fg")} />
                    {CATEGORY_LABEL[t.category]}
                  </p>
                  <p className="mt-1 text-muted">{mask(t.explanation)}</p>
                  {f && (
                    <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm underline underline-offset-2">
                      Where this is public
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <WhatToDo items={data.whatToDo.map(mask)} />
      </div>
    </PracticeMark>
  );
}
