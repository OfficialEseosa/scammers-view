"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import type { CallScenarioId } from "@/lib/call/schema";
import type { FixHit, Span } from "@/lib/search";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { Highlight } from "@/design/Highlighter";
import { ErrorState } from "@/design/states";
import { cn } from "@/design/utils";

export type ScamCheckProps = {
  /** Called with the closest practice call when the user wants to rehearse a match live. */
  onPractise?: (scenario: CallScenarioId) => void;
};

type Match = {
  id: string;
  name: string;
  tagline: string;
  score: number;
  signs: string[];
  redFlags: string[];
  action: string;
  report: { title: string; url: string }[];
  practice?: CallScenarioId;
};

type CheckResult = { engine: "typesense" | "local"; level: "high" | "some" | "low"; spans: Span[]; matches: Match[] };

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; text: string; data: CheckResult };

const EXAMPLE =
  "Hi, it's Professor Lee, texting from my personal number. Are you free? I need a quick favor for a surprise for the department. " +
  "Can you buy 4 gift cards right now and send me the card numbers? Keep it between us, I'll pay you back tonight.";

const LEVEL: Record<CheckResult["level"], { label: string; className: string }> = {
  high: { label: "Several warning signs", className: "border-danger text-danger-fg" },
  some: { label: "Some warning signs", className: "border-warn text-warn-fg" },
  low: { label: "No obvious warning signs", className: "border-edge-strong text-muted" },
};

export function ScamCheck({ onPractise }: ScamCheckProps) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const req = useRef(0);

  async function check(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    const id = ++req.current;
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: body }) });
      if (id !== req.current) return;
      if (!res.ok) {
        setState({ status: "error", message: res.status === 400 ? "Paste up to 4,000 characters." : "The check didn't run." });
        return;
      }
      setState({ status: "ready", text: body, data: (await res.json()) as CheckResult });
    } catch {
      if (id === req.current) setState({ status: "error", message: "Couldn't reach the server." });
    }
  }

  return (
    <section aria-label="Is this a scam?" className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h2 className="sv-display text-[clamp(2rem,4.4vw,3rem)] leading-[1]">Is this a scam?</h2>
        <p className="max-w-[60ch] text-muted">Paste a text, email or DM you got. It&apos;s compared with known scams and never stored.</p>
      </header>

      <form onSubmit={check} className="flex flex-col gap-3">
        <label htmlFor="scam-check-text" className="sr-only">
          Message to check
        </label>
        <textarea
          id="scam-check-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          rows={6}
          placeholder="Paste the message here"
          className="w-full resize-y rounded-card border border-edge bg-surface p-4 text-base outline-none focus:border-fg"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={!text.trim() || state.status === "loading"}>
            {state.status === "loading" ? "Checking…" : "Check it"}
          </Button>
          <Button variant="ghost" onClick={() => setText(EXAMPLE)}>
            Try an example
          </Button>
          <span className="ml-auto text-sm text-subtle">{text.length}/4000</span>
        </div>
      </form>

      {state.status === "error" && <ErrorState title={state.message} action={<Button variant="secondary" onClick={() => void check()}>Try again</Button>} />}
      {state.status === "ready" && <CheckReport text={state.text} data={state.data} onPractise={onPractise} />}

      <FixSearch />
    </section>
  );
}

function CheckReport({ text, data, onPractise }: { text: string; data: CheckResult; onPractise?: (s: CallScenarioId) => void }) {
  const level = LEVEL[data.level];
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-10">
      <Card className="flex min-w-0 flex-col gap-4">
        <p className={cn("inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-semibold", level.className)} aria-live="polite">
          {level.label}
        </p>
        <MarkedText text={text} spans={data.spans} />
        {data.spans.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-muted">
            {[...new Set(data.spans.map((s) => s.why))].map((why) => (
              <li key={why}>• {why}</li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-col gap-4">
        <h3 className="font-display text-xl font-semibold">Closest known scams</h3>
        {data.matches.length === 0 && <p className="text-muted">Nothing close in the library. If it still feels off, check with the sender on a number you already have.</p>}
        {data.matches.map((m, i) => (
          <Card key={m.id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-lg font-semibold">{m.name}</p>
              {i === 0 && <span className="shrink-0 text-sm text-muted">best match</span>}
            </div>
            <p className="text-muted">{m.tagline}</p>
            {m.signs.length > 0 && (
              <p className="text-sm">
                <span className="text-muted">Seen here: </span>
                {m.signs.join(" · ")}
              </p>
            )}
            <p className="text-sm">
              <span className="font-semibold">What to do: </span>
              {m.action}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {m.report.map((r) => (
                <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className="text-muted underline underline-offset-4 hover:text-fg">
                  Report: {r.title}
                </a>
              ))}
            </div>
            {m.practice && onPractise && (
              <Button variant="secondary" className="w-fit" onClick={() => onPractise(m.practice!)}>
                Practise this one live
              </Button>
            )}
          </Card>
        ))}
        <p className="text-sm text-subtle">Matched with {data.engine === "typesense" ? "Typesense" : "the built-in matcher"}.</p>
      </div>
    </div>
  );
}

function MarkedText({ text, spans }: { text: string; spans: Span[] }) {
  const parts = useMemo(() => {
    const out: { text: string; span?: Span }[] = [];
    let at = 0;
    for (const s of spans) {
      if (s.start > at) out.push({ text: text.slice(at, s.start) });
      out.push({ text: text.slice(s.start, s.end), span: s });
      at = s.end;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return out;
  }, [text, spans]);
  let k = 0;
  return (
    <p className="whitespace-pre-wrap break-words text-lg leading-relaxed">
      {parts.map((p, i) =>
        p.span ? (
          <Highlight key={i} on index={k++} title={p.span.why}>
            {p.text}
          </Highlight>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

function FixSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FixHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixQuery: q.trim() }) });
      setHits(res.ok ? ((await res.json()) as { fixes: FixHit[] }).fixes : []);
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-edge pt-8">
      <h3 className="font-display text-xl font-semibold">Find a fix</h3>
      <form onSubmit={search} className="flex flex-wrap gap-3">
        <label htmlFor="fix-search" className="sr-only">
          Search fixes
        </label>
        <input
          id="fix-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
          placeholder="e.g. instagram private, whitepages remove"
          className="min-h-12 min-w-0 flex-1 rounded-control border border-edge bg-surface px-4 outline-none focus:border-fg"
        />
        <Button type="submit" variant="secondary" disabled={busy || !q.trim()}>
          Search
        </Button>
      </form>
      {hits && hits.length === 0 && <p className="text-muted">No fix matches that yet.</p>}
      {hits && hits.length > 0 && (
        <ul className="flex flex-col gap-2">
          {hits.map((h) => (
            <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-3 rounded-control border border-edge px-4 py-3">
              <span className="font-medium">{h.title}</span>
              {h.link && (
                <a href={h.link} target="_blank" rel="noopener noreferrer" className="text-sm text-muted underline underline-offset-4 hover:text-fg">
                  Open
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
