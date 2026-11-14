"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AttackChain, ExposureScore, Finding } from "@/lib/types";
import { CALL_SCENARIOS, type CallMode, type CallScenarioId, type CallView, type LiveJoin, type Scorecard, type TranscriptLine } from "@/lib/call/schema";
import { planFixes } from "@/lib/fixes/plan";
import { maskIn } from "@/components/scan/mask";
import { useRecorder, MIN_SECONDS } from "@/features/voice/useRecorder";
import { SegmentedTabs } from "@/design/SegmentedTabs";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { ErrorState, PanelSkeleton, WarnNote } from "@/design/states";
import { cn } from "@/design/utils";
import { LABEL, Transcript } from "./parts";

const LiveCall = dynamic(() => import("./LiveCall").then((m) => m.LiveCall), {
  ssr: false,
  loading: () => <PanelSkeleton className="h-64" label="Connecting the call" />,
});

export type PracticeCallProps = {
  /** The signed-in person's own findings. */
  findings: Finding[];
  chains: AttackChain[];
  score?: ExposureScore | null;
  subjectName: string;
  masked?: boolean;
  /** Scenario handed over from the scam checker. */
  initialScenario?: CallScenarioId | null;
};

const BRIEF: Record<CallScenarioId, string> = {
  "fake-recruiter": "A recruiter who knows your school offers a fast-track internship.",
  "professor-gift-cards": "Someone you work or study with needs a quick, quiet favor.",
  "family-voice-clone": "You play your parent. The caller sounds like you, in trouble.",
};

type Phase =
  | { status: "setup" }
  | { status: "starting" }
  | { status: "live"; call: CallView; join?: LiveJoin }
  | { status: "done"; call: CallView }
  | { status: "error"; message: string };

export function PracticeCall({ findings, chains, score, masked = false, initialScenario }: PracticeCallProps) {
  const [scenario, setScenario] = useState<CallScenarioId>(initialScenario ?? "fake-recruiter");
  const [mode, setMode] = useState<CallMode>("simulated");
  const [phase, setPhase] = useState<Phase>({ status: "setup" });
  const [liveOn, setLiveOn] = useState<boolean | null>(null);
  const [sample, setSample] = useState<Blob | null>(null);

  const [handoff, setHandoff] = useState(initialScenario);
  if (initialScenario && initialScenario !== handoff) {
    setHandoff(initialScenario);
    setScenario(initialScenario);
  }

  useEffect(() => {
    let live = true;
    fetch("/api/call")
      .then((r) => r.json() as Promise<{ live: boolean }>)
      .then((d) => live && setLiveOn(Boolean(d.live)))
      .catch(() => live && setLiveOn(false));
    return () => {
      live = false;
    };
  }, []);

  const callId = phase.status === "live" || phase.status === "done" ? phase.call.id : null;
  // Leaving the tab mid-call (or unmounting) drops the ticket on the server.
  useEffect(() => {
    if (!callId) return;
    return () => {
      void fetch(`/api/call/${callId}`, { method: "DELETE", keepalive: true }).catch(() => {});
    };
  }, [callId]);

  async function start(mode: CallMode) {
    setPhase({ status: "starting" });
    try {
      const voiceSample = mode === "live" && scenario === "family-voice-clone" && sample ? { base64: await toBase64(sample), type: sample.type } : undefined;
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findings, scenario, mode, voiceSample }),
      });
      if (!res.ok) {
        const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        setPhase({ status: "error", message: res.status === 401 ? "Sign in to practise a call built from your own footprint." : (msg ?? "The call didn't start.") });
        return;
      }
      const { join, ...call } = (await res.json()) as CallView & { join?: LiveJoin };
      setPhase({ status: "live", call, join });
    } catch {
      setPhase({ status: "error", message: "Couldn't reach the server." });
    }
  }

  const reset = useCallback(() => setPhase({ status: "setup" }), []);
  const done = useCallback((call: CallView) => setPhase({ status: "done", call }), []);
  const fallback = () => {
    setMode("simulated");
    void start("simulated");
  };

  return (
    <section aria-label="Practice call" className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h2 className="sv-display text-[clamp(2rem,4.4vw,3rem)] leading-[1]">Take the call</h2>
        <p className="max-w-[60ch] text-muted">A scammer calls using what&apos;s public about you. Spot it, push back, hang up. You get a scorecard at the end.</p>
      </header>

      {(phase.status === "setup" || phase.status === "starting" || phase.status === "error") && (
        <div className="flex flex-col gap-5">
          <div role="radiogroup" aria-label="Scenario" className="sv-scroll-x flex gap-2">
            {CALL_SCENARIOS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={scenario === id}
                onClick={() => setScenario(id)}
                className={cn("sv-press min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium", scenario === id ? "border-fg text-fg" : "border-edge text-muted hover:text-fg")}
              >
                {LABEL[id]}
              </button>
            ))}
          </div>
          <p className="text-muted">{BRIEF[scenario]}</p>

          <div className="flex flex-wrap items-center gap-3">
            <SegmentedTabs
              role="radiogroup"
              label="How to take the call"
              value={mode}
              onChange={(m) => setMode(m)}
              items={[
                { id: "simulated", label: "Type or speak, turn by turn" },
                { id: "live", label: "Live voice call", hint: liveOn ? undefined : "not set up on this server" },
              ]}
            />
          </div>
          {mode === "simulated" && <p className="text-sm text-subtle">If you use Speak, your browser may send your speech to its own speech service to transcribe it.</p>}
          {mode === "live" && liveOn === false && <WarnNote>Live calls aren&apos;t set up on this server yet. Use the turn-by-turn version for now.</WarnNote>}
          {mode === "live" && liveOn && <p className="text-sm text-subtle">Uses your microphone. Audio goes through LiveKit and Deepgram for this call only.</p>}
          {mode === "live" && liveOn && scenario === "family-voice-clone" && <VoiceSample sample={sample} onSample={setSample} />}

          {phase.status === "error" && <ErrorState title={phase.message} />}
          <Button size="lg" className="w-fit" onClick={() => void start(mode)} disabled={phase.status === "starting" || (mode === "live" && !liveOn)}>
            {phase.status === "starting" ? "Connecting…" : mode === "live" ? "Start the live call" : "Start the call"}
          </Button>
          <p className="text-sm text-subtle">Nothing is recorded. Numbers you say are blanked before anything is kept, and the call is wiped once you see your score.</p>
        </div>
      )}

      {phase.status === "live" && phase.call.mode === "simulated" && (
        <SimulatedCall call={phase.call} findings={findings} masked={masked} onDone={done} onGone={reset} />
      )}
      {phase.status === "live" && phase.call.mode === "live" && phase.join && (
        <LiveCall call={phase.call} join={phase.join} findings={findings} masked={masked} onDone={done} onGone={reset} onFallback={fallback} />
      )}
      {phase.status === "done" && phase.call.scorecard && (
        <Results card={phase.call.scorecard} transcript={phase.call.transcript} findings={findings} chains={chains} score={score} masked={masked} onAgain={reset} />
      )}
    </section>
  );
}

/* ------------------------------ simulated call ------------------------------ */

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function speak(text: string, on: boolean) {
  if (!on || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

function SimulatedCall({
  call,
  findings,
  masked,
  onDone,
  onGone,
}: {
  call: CallView;
  findings: Finding[];
  masked: boolean;
  onDone: (c: CallView) => void;
  onGone: () => void;
}) {
  const [transcript, setTranscript] = useState<TranscriptLine[]>(call.transcript);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(true);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const [canListen] = useState(() => typeof window !== "undefined" && getRecognition() !== null);

  useEffect(() => {
    speak(call.transcript.at(-1)?.text ?? "", true);
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      recRef.current?.stop();
    };
  }, [call.transcript]);

  const send = useCallback(
    async (utterance: string, hangup = false) => {
      if (busy) return;
      setBusy(true);
      if (utterance.trim()) setTranscript((t) => [...t, { speaker: "you", text: utterance.trim() }]);
      setDraft("");
      try {
        const res = await fetch(`/api/call/${call.id}/turn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ utterance, hangup }),
        });
        if (res.status === 404) return onGone();
        if (!res.ok) throw new Error();
        const data = (await res.json()) as CallView & { line: string | null; ended: boolean };
        setTranscript(data.transcript);
        if (data.line) speak(data.line, sound);
        if (data.ended) onDone(data);
      } catch {
        setTranscript((t) => [...t, { speaker: "scammer", text: "(The line crackled. Say that again?)" }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, call.id, onDone, onGone, sound],
  );

  function listen() {
    const rec = getRecognition();
    if (!rec) return;
    recRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" ").trim();
      if (said) void send(said);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.trim()) void send(draft);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-10">
      <Card className="flex min-w-0 flex-col gap-4">
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-danger" /> Unknown caller · {LABEL[call.scenario]}
        </p>
        <Transcript lines={transcript} findings={findings} masked={masked} />
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <label htmlFor="call-reply" className="sr-only">
            Your reply
          </label>
          <input
            id="call-reply"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={600}
            disabled={busy}
            placeholder={busy ? "They're talking…" : "Say something back"}
            className="min-h-12 min-w-0 flex-1 rounded-control border border-edge bg-surface px-4 outline-none focus:border-fg"
          />
          <Button type="submit" variant="secondary" disabled={busy || !draft.trim()}>
            Reply
          </Button>
          {canListen && (
            <Button variant="secondary" onClick={listen} disabled={busy || listening} aria-pressed={listening}>
              {listening ? "Listening…" : "Speak"}
            </Button>
          )}
        </form>
      </Card>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        <Button variant="destructive" size="lg" onClick={() => void send("", true)} disabled={busy}>
          Hang up
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} className="accent-[var(--amber)]" />
          Read the caller&apos;s lines aloud
        </label>
        <p className="text-sm text-subtle">Tip: a real person won&apos;t mind if you hang up and call back on a number you already have.</p>
      </aside>
    </div>
  );
}

function VoiceSample({ sample, onSample }: { sample: Blob | null; onSample: (b: Blob | null) => void }) {
  const rec = useRecorder(onSample);
  return (
    <Card className="flex flex-col gap-3">
      <p className="font-semibold">Optional: make the caller sound like you</p>
      <p className="text-sm text-muted">Read anything aloud for {MIN_SECONDS}–30 seconds. The clone is made when the call connects and deleted when it ends.</p>
      <div className="flex flex-wrap items-center gap-3">
        {rec.state === "recording" ? (
          <Button variant="secondary" onClick={rec.stop} disabled={rec.elapsed < MIN_SECONDS}>
            Stop ({rec.elapsed}s)
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => void rec.start()} disabled={rec.state === "starting"}>
            {sample ? "Record again" : "Record a sample"}
          </Button>
        )}
        {sample && rec.state !== "recording" && (
          <Button variant="ghost" onClick={() => onSample(null)}>
            Use a stock voice
          </Button>
        )}
        {sample && <span className="text-sm text-muted">Sample ready</span>}
        {rec.state === "denied" && <WarnNote>Microphone access was blocked.</WarnNote>}
        {rec.state === "unsupported" && <WarnNote>This browser can&apos;t record audio.</WarnNote>}
      </div>
    </Card>
  );
}

async function toBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ------------------------------ results ------------------------------ */

const VERDICT: Record<Scorecard["verdict"], { title: string; className: string }> = {
  safe: { title: "You'd have been fine", className: "text-fg" },
  close: { title: "Close call", className: "text-warn-fg" },
  caught: { title: "They'd have got you", className: "text-danger-fg" },
};

function Results({
  card,
  transcript,
  findings,
  chains,
  score,
  masked,
  onAgain,
}: {
  card: Scorecard;
  transcript: TranscriptLine[];
  findings: Finding[];
  chains: AttackChain[];
  score?: ExposureScore | null;
  masked: boolean;
  onAgain: () => void;
}) {
  const fixes = useMemo(() => {
    const all = planFixes(findings, chains, score?.score);
    const used = new Set(card.usedFindingIds);
    const relevant = all.filter((f) => f.removesFindingIds.some((id) => used.has(id)));
    return (relevant.length ? relevant : all.filter((f) => f.scoreDrop > 0)).slice(0, 3);
  }, [findings, chains, score, card.usedFindingIds]);
  const v = VERDICT[card.verdict];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-10">
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={cn("font-display text-3xl font-semibold", v.className)}>{v.title}</p>
            <p className="text-muted">{transcript.filter((l) => l.speaker === "you").length} replies</p>
          </div>
          <p className="sv-num text-6xl leading-none">
            {card.score}
            <span className="text-2xl text-muted">/100</span>
          </p>
        </Card>
        <ul className="flex flex-col gap-2">
          {card.checks.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-control border border-edge px-4 py-3">
              <span aria-hidden className={cn("mt-1 size-3 shrink-0 rounded-full", c.passed ? "bg-fg" : "border-2 border-danger")} />
              <div>
                <p className="font-semibold">
                  <span className="sr-only">{c.passed ? "Passed: " : "Missed: "}</span>
                  {c.label}
                </p>
                <p className="text-sm text-muted">{maskIn(c.detail, findings, masked)}</p>
              </div>
            </li>
          ))}
        </ul>
        <Button variant="secondary" className="w-fit" onClick={onAgain}>
          Practise again
        </Button>
      </div>
      <aside className="flex flex-col gap-3">
        <h3 className="font-display text-xl font-semibold">Fixes that make this call harder</h3>
        {fixes.length === 0 && <p className="text-muted">This call didn&apos;t lean on anything a fix can remove. The habits on the left are your defence.</p>}
        {fixes.map((f) => (
          <Card key={f.id} className="flex flex-col gap-2">
            <p className="font-semibold">{f.title}</p>
            <p className="text-sm text-muted">
              {f.scoreDrop > 0 ? (
                <>
                  Cuts your exposure by <span className="sv-num text-fg">{f.scoreDrop}</span> · {f.effort}
                </>
              ) : (
                f.effort
              )}
            </p>
            {f.link && (
              <a href={f.link} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">
                Open the setting
              </a>
            )}
          </Card>
        ))}
      </aside>
    </div>
  );
}
