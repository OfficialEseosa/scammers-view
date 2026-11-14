"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Finding } from "@/lib/types";
import {
  CATEGORY_LABEL,
  CATEGORY_TIP,
  QuizResponse,
  type MissedCategory,
  type QuizAnswer,
  type QuizItem,
  type QuizResult,
} from "@/lib/quiz/schema";
import { Button } from "@/design/Button";
import { PracticeMark } from "@/design/PracticeMark";
import { RiskBadge } from "@/design/Badge";
import { ErrorState } from "@/design/states";
import { Icon3D } from "@/design/Icon3D";

export type ScamQuizProps = {
  findings: Finding[];
  /** Mask personal values (names, finding values) for projectors. */
  masked?: boolean;
  onComplete?: (result: QuizResult) => void;
};

type Phase =
  | { t: "intro" }
  | { t: "loading" }
  | { t: "error"; message: string }
  | { t: "play" }
  | { t: "done"; result: QuizResult };

const MASK = "••••";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Mark = { quote: string; n: number; tone: "tell" | "good" };

/** Splits body into plain and marked segments (first occurrence of each quote; overlaps skipped). */
function segment(body: string, marks: Mark[]): { text: string; mark?: Mark }[] {
  const placed = marks
    .map((m) => ({ m, i: body.indexOf(m.quote) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  const out: { text: string; mark?: Mark }[] = [];
  let pos = 0;
  for (const { m, i } of placed) {
    if (i < pos) continue;
    if (i > pos) out.push({ text: body.slice(pos, i) });
    out.push({ text: m.quote, mark: m });
    pos = i + m.quote.length;
  }
  if (pos < body.length) out.push({ text: body.slice(pos) });
  return out;
}

export function ScamQuiz({ findings, masked = false, onComplete }: ScamQuizProps) {
  const [phase, setPhase] = useState<Phase>({ t: "intro" });
  const [quiz, setQuiz] = useState<QuizResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const nextRef = useRef<HTMLButtonElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const findingById = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);

  const mask = useMemo(() => {
    if (!masked) return (s: string) => s;
    const words = new Set<string>();
    for (const f of findings) if (f.value.trim().length >= 3) words.add(f.value.trim());
    for (const w of (quiz?.recipient ?? "").split(/\s+/)) if (w.length >= 3) words.add(w);
    const list = [...words].sort((a, b) => b.length - a.length);
    if (list.length === 0) return (s: string) => s;
    const re = new RegExp(list.map(escapeRe).join("|"), "gi");
    return (s: string) => s.replace(re, MASK);
  }, [masked, findings, quiz?.recipient]);

  const start = useCallback(async () => {
    setPhase({ t: "loading" });
    setIndex(0);
    setAnswers([]);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findings }),
      });
      if (res.status === 401) {
        setPhase({ t: "error", message: "Sign in to take the quiz." });
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const parsed = QuizResponse.safeParse(await res.json());
      if (!parsed.success) throw new Error("bad response");
      setQuiz(parsed.data);
      setPhase({ t: "play" });
    } catch {
      setPhase({ t: "error", message: "The quiz could not load. Check your connection and try again." });
    }
  }, [findings]);

  const item: QuizItem | undefined = quiz?.items[index];
  const answered = answers.length > index ? answers[index] : undefined;

  const answer = useCallback(
    (said: "real" | "scam") => {
      if (!item || answered) return;
      setAnswers((prev) => [
        ...prev,
        { itemId: item.id, said, isScam: item.isScam, correct: (said === "scam") === item.isScam },
      ]);
    },
    [item, answered],
  );

  // Keyboard shortcuts: R = real, S = scam.
  useEffect(() => {
    if (phase.t !== "play" || answered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "r" || e.key === "R") answer("real");
      else if (e.key === "s" || e.key === "S") answer("scam");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.t, answered, answer]);

  // Move focus to "Next" after answering, so keyboard users land on the reveal.
  useEffect(() => {
    if (!answered) return;
    nextRef.current?.focus({ preventScroll: true });
    revealRef.current?.scrollIntoView({ block: "start" });
  }, [answered]);

  // Move focus to the heading on new phase / new question.
  useEffect(() => {
    if (phase.t === "done" || (phase.t === "play" && !answered)) headingRef.current?.focus();
  }, [phase.t, index, answered]);

  const finish = useCallback(() => {
    if (!quiz) return;
    const missed: MissedCategory[] = [];
    answers.forEach((a, i) => {
      if (a.correct) return;
      const it = quiz.items[i];
      if (it.isScam) {
        for (const t of it.tells) if (!missed.includes(t.category)) missed.push(t.category);
      } else if (!missed.includes("false_alarm")) {
        missed.push("false_alarm");
      }
    });
    const result: QuizResult = {
      score: answers.filter((a) => a.correct).length,
      total: quiz.items.length,
      answers,
      missedCategories: missed,
    };
    setPhase({ t: "done", result });
    onComplete?.(result);
  }, [quiz, answers, onComplete]);

  const goNext = () => {
    if (!quiz) return;
    if (index + 1 >= quiz.items.length) finish();
    else setIndex(index + 1);
  };

  const score = answers.filter((a) => a.correct).length;

  /* --------------------------------- screens --------------------------------- */

  if (phase.t === "intro" || phase.t === "loading" || phase.t === "error") {
    return (
      <section aria-label="Spot the scam quiz" className="mx-auto w-full max-w-3xl">
        <div className="sv-card relative overflow-hidden p-6 sm:p-10">
          <div aria-hidden className="absolute -right-6 -top-6 max-sm:hidden">
            <Icon3D name="target" size={150} motion="float" />
          </div>
          <h2 className="sv-display relative text-[clamp(2.2rem,5vw,3.5rem)] leading-[0.98]">Real or scam?</h2>
          <p className="relative mt-3 text-lg text-muted">
            <span className="sv-num text-fg">6</span> messages
          </p>
          {phase.t === "error" && <ErrorState className="relative mt-6" title={phase.message} />}
          <Button size="lg" onClick={start} disabled={phase.t === "loading"} className="relative mt-8 w-full sm:w-auto">
            {phase.t === "loading" ? "Writing your messages" : phase.t === "error" ? "Try again" : "Start the quiz"}
          </Button>
          {phase.t === "loading" && (
            <div className="relative mt-6 flex flex-col gap-2.5" aria-hidden>
              <span className="sv-skeleton block h-3.5 w-[80%]" />
              <span className="sv-skeleton block h-3.5 w-[64%]" />
              <span className="sv-skeleton block h-3.5 w-[72%]" />
            </div>
          )}
        </div>
      </section>
    );
  }

  if (phase.t === "done") {
    const { result } = phase;
    const missed = result.missedCategories;
    const perfect = result.score === result.total;
    return (
      <section aria-label="Quiz results" className="mx-auto w-full max-w-3xl">
        <div className="sv-card p-6 sm:p-10">
          <h2 ref={headingRef} tabIndex={-1} className="sv-display text-[clamp(2.4rem,6vw,4rem)] leading-none outline-none">
            <span className={perfect ? "text-safe-fg" : ""}>{result.score}</span>
            <span className="text-muted">/{result.total}</span>
          </h2>

          <ul className="mt-6 flex gap-1.5" aria-label="Your answers">
            {result.answers.map((a, i) => (
              <li key={a.itemId} className={`h-2 flex-1 rounded-full ${a.correct ? "bg-safe" : "bg-danger"}`} title={`Message ${i + 1}: ${a.correct ? "correct" : "missed"}`}>
                <span className="sr-only">
                  Message {i + 1}: {a.correct ? "correct" : "missed"}
                </span>
              </li>
            ))}
          </ul>

          {missed.length > 0 && (
            <ul className="mt-8 flex flex-col divide-y divide-edge border-y border-edge">
              {missed.map((c) => (
                <li key={c} className="py-4">
                  <p className="font-display text-xl font-semibold">{CATEGORY_LABEL[c]}</p>
                  <p className="mt-1 text-lg text-muted">{CATEGORY_TIP[c]}</p>
                </li>
              ))}
            </ul>
          )}

          <Button size="lg" onClick={start} className="mt-8 w-full sm:w-auto">
            Play again
          </Button>
        </div>
      </section>
    );
  }

  // phase.t === "play"
  if (!quiz || !item) return null;

  const byPos = <T extends { quote: string }>(xs: T[]) => [...xs].sort((a, b) => item.body.indexOf(a.quote) - item.body.indexOf(b.quote));
  const tells = byPos(item.tells);
  const goodSigns = byPos(item.goodSigns);
  const marks: Mark[] = item.isScam
    ? tells.map((t, i) => ({ quote: t.quote, n: i + 1, tone: "tell" as const }))
    : goodSigns.map((g, i) => ({ quote: g.quote, n: i + 1, tone: "good" as const }));
  const parts = segment(item.body, marks);

  return (
    <section aria-label="Spot the scam quiz" className="mx-auto w-full max-w-5xl">
      <header className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <h2 ref={headingRef} tabIndex={-1} className="sv-display text-2xl outline-none sm:text-3xl">
          <span className="sv-num">{index + 1}</span>
          <span className="text-muted">/{quiz.items.length}</span>
        </h2>
        <p className="text-lg text-muted" aria-live="polite">
          Score <span className="sv-num text-fg">{score}</span>
        </p>
        <ol className="ml-auto flex w-full gap-1.5 sm:w-64" aria-label="Progress">
          {quiz.items.map((it, i) => {
            const a = answers[i];
            return (
              <li key={it.id} className={`h-2 flex-1 rounded-full transition-colors duration-300 ${a ? (a.correct ? "bg-safe" : "bg-danger") : i === index ? "bg-fg" : "bg-edge-strong"}`}>
                <span className="sr-only">
                  Message {i + 1}: {a ? (a.correct ? "correct" : "missed") : i === index ? "current" : "not yet"}
                </span>
              </li>
            );
          })}
        </ol>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,27rem)_1fr] lg:items-start lg:gap-10">
        <PracticeMark
          key={item.id}
          onLight
          ink="var(--frame-ink)"
          className="mx-auto w-full max-w-[27rem] animate-[sv-enter_240ms_var(--ease-out)_both] select-none overflow-hidden rounded-frame border border-[var(--frame-bezel-edge)] bg-[var(--frame-screen)] text-[var(--frame-ink)] shadow-pop"
          onCopy={(e: React.ClipboardEvent) => e.preventDefault()}
          onCut={(e: React.ClipboardEvent) => e.preventDefault()}
          onContextMenu={(e: React.MouseEvent) => e.preventDefault()}
          onDragStart={(e: React.DragEvent) => e.preventDefault()}
        >
          <div className="border-b border-[var(--frame-line)] bg-[var(--frame-chrome)] px-5 py-4 pr-28">
            <p className="text-sm text-[var(--frame-muted)]">{item.kind === "sms" ? "Text from" : "Email from"}</p>
            <p className="text-lg font-semibold leading-snug">{mask(item.from.name)}</p>
            <p className="sv-evidence break-all text-sm text-[var(--frame-muted)]">{mask(item.from.address)}</p>
          </div>
          <div className="min-h-[16rem] px-5 py-5">
            {item.kind === "email" && item.subject && <p className="mb-3 font-display text-xl font-semibold leading-snug">{mask(item.subject)}</p>}
            <div className={item.kind === "sms" ? "rounded-[1.25rem] rounded-tl-md bg-[var(--frame-bubble)] px-4 py-3" : ""}>
              <p className="whitespace-pre-wrap text-xl leading-relaxed">
                {parts.map((p, i) =>
                  "mark" in p && p.mark ? (
                    <span
                      key={i}
                      data-on={!!answered}
                      className="sv-hl bg-transparent [--hl-bg:var(--frame-ink)] [--hl-fg:var(--frame-screen)]"
                      style={{ ["--hl-i" as string]: p.mark.n - 1 }}
                    >
                      {mask(p.text)}
                      {answered && <sup className="ml-0.5 text-sm font-bold">{p.mark.n}</sup>}
                    </span>
                  ) : (
                    <Fragment key={i}>{mask(p.text)}</Fragment>
                  ),
                )}
              </p>
            </div>
          </div>
        </PracticeMark>

        <div className="flex flex-col gap-5">
          {!answered ? (
            <div>
              <p className="sv-display text-2xl sm:text-3xl">Real or scam?</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Button variant="secondary" size="lg" onClick={() => answer("real")} className="min-h-16 text-xl">
                  Real <kbd className="ml-1 rounded-chip border border-edge px-1.5 text-sm text-muted">R</kbd>
                </Button>
                <Button variant="secondary" size="lg" onClick={() => answer("scam")} className="min-h-16 text-xl">
                  Scam <kbd className="ml-1 rounded-chip border border-edge px-1.5 text-sm text-muted">S</kbd>
                </Button>
              </div>
            </div>
          ) : (
            <div ref={revealRef} aria-live="polite" className="flex scroll-mt-4 flex-col gap-5">
              <div className="flex items-start gap-3">
                <RiskBadge level={answered.correct ? "safe" : "danger"} className="mt-1.5 shrink-0">
                  {answered.correct ? "Correct" : "Missed"}
                </RiskBadge>
                <div>
                  <p className="sv-display text-2xl">{item.isScam ? "Practice scam" : "Real-style message"}</p>
                  <p className="mt-1 text-lg text-muted">{mask(item.summary)}</p>
                </div>
              </div>

              <ol className="flex flex-col divide-y divide-edge border-y border-edge">
                {item.isScam
                  ? tells.map((t, i) => {
                      const f = t.findingId ? findingById.get(t.findingId) : undefined;
                      return (
                        <Reason key={t.id} n={i + 1} title={CATEGORY_LABEL[t.category]} text={mask(t.explanation)}>
                          {f && (
                            <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                              <span className="size-1.5 rounded-full bg-danger" aria-hidden />
                              From your public {f.label.toLowerCase()}
                            </p>
                          )}
                        </Reason>
                      );
                    })
                  : goodSigns.map((g, i) => <Reason key={g.id} n={i + 1} title="Why it's fine" text={mask(g.explanation)} />)}
              </ol>

              <Button ref={nextRef} size="lg" onClick={goNext} className="w-full sm:w-auto sm:self-start">
                {index + 1 >= quiz.items.length ? "See your results" : "Next message"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Reason({ n, title, text, children }: { n: number; title: string; text: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-4">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg font-display text-sm font-semibold text-canvas">{n}</span>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-lg">{text}</p>
        {children}
      </div>
    </li>
  );
}
