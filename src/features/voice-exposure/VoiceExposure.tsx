"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Finding } from "@/lib/types";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { Chip, RiskBadge } from "@/design/Badge";
import { Icon3D, SOURCE_ICON } from "@/design/Icon3D";
import { ErrorState } from "@/design/states";
import { cn } from "@/design/utils";
import { MIN_SECONDS, RECORD_SECONDS, useRecorder } from "@/features/voice/useRecorder";
import { PASSAGE, Waveform } from "@/features/voice/VoiceDemo";
import { buildReference, decodeTo16kMono, fetchMedia, loadVoiceModels, NotEnoughSpeechError, verifyClip, type ClipResult } from "@/lib/voice-exposure/client";
import { getVoiceEmbedding, getVoiceSample, hasVoiceReference, setVoiceEmbedding, setVoiceSample, subscribeVoice, voiceVersion } from "@/lib/voice-exposure/store";
import { CLONE_MIN_SEC, CLONE_RECOMMENDED_SEC } from "@/lib/voice-exposure/verify";
import { ExposureChart } from "./ExposureChart";

export interface VoiceExposureProps {
  findings: Finding[];
  /** Presentation mode: blur captions and thumbnails. */
  masked?: boolean;
  /** Receives the derived "Your voice, N seconds, public" finding (empty array when nothing matched). */
  onDerived?: (findings: Finding[]) => void;
  /** Lab only: a same-origin fixture clip used as the reference instead of the microphone. */
  fixtureReference?: string;
}

type RowState =
  | { k: "borrowed" }
  | { k: "queued" }
  | { k: "checking" }
  | { k: "done"; r: ClipResult }
  | { k: "failed"; message: string };

type Phase =
  | { k: "idle" }
  | { k: "record" }
  | { k: "loading"; loaded: number; total: number }
  | { k: "running" }
  | { k: "done" }
  | { k: "error"; message: string };

const ELEVENLABS_DOCS = "https://elevenlabs.io/docs/product-guides/voices/voice-cloning/instant-voice-cloning";
const CLONE_TIP = `ElevenLabs Instant Voice Cloning: samples must add up to at least ${CLONE_MIN_SEC} seconds; 1 to 2 minutes of clear audio is recommended.`;

/** int8 weights: 8.9 MB instead of 28.8 MB, same separation on the lab fixtures. */
const VOICE_DTYPE = "q8";

const PLATFORM: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram" };

export function VoiceExposure({ findings, masked = false, onDerived, fixtureReference }: VoiceExposureProps) {
  const videos = useMemo(() => findings.filter((f) => f.category === "video" && f.mediaUrl && f.id !== DERIVED_ID), [findings]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [includeBorrowed, setIncludeBorrowed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useSyncExternalStore(subscribeVoice, voiceVersion, () => 0);
  const hasReference = !!fixtureReference || hasVoiceReference();

  useEffect(() => () => abortRef.current?.abort(), []);

  const stateOf = (f: Finding): RowState => rows[f.id] ?? (f.soundOriginal === false && !includeBorrowed ? { k: "borrowed" } : { k: "queued" });

  const run = useCallback(
    async (opts: { borrowed: boolean }) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        setPhase({ k: "loading", loaded: 0, total: 0 });
        await loadVoiceModels(VOICE_DTYPE, (loaded, total) => {
          if (!ac.signal.aborted) setPhase({ k: "loading", loaded, total });
        });
        let reference = getVoiceEmbedding();
        if (!reference) {
          const sample = getVoiceSample();
          const bytes = fixtureReference ? await fetchMedia(fixtureReference, ac.signal) : sample ? await sample.arrayBuffer() : null;
          if (!bytes) {
            setPhase({ k: "record" });
            return;
          }
          const ref = await buildReference(await decodeTo16kMono(bytes));
          setVoiceEmbedding(ref.embedding); // drops the raw sample
          reference = ref.embedding;
        }
        if (ac.signal.aborted) return;
        setPhase({ k: "running" });
        const todo = videos.filter((f) => opts.borrowed || f.soundOriginal !== false);
        setRows((cur) => {
          const next = { ...cur };
          for (const f of todo) if (next[f.id]?.k !== "done") next[f.id] = { k: "queued" };
          return next;
        });
        for (const f of todo) {
          if (ac.signal.aborted) return;
          if (rows[f.id]?.k === "done") continue;
          setRows((cur) => ({ ...cur, [f.id]: { k: "checking" } }));
          try {
            const r = await verifyClip(() => fetchMedia(f.mediaUrl!, ac.signal), reference);
            setRows((cur) => ({ ...cur, [f.id]: { k: "done", r } }));
          } catch (e) {
            if (ac.signal.aborted) return;
            setRows((cur) => ({ ...cur, [f.id]: { k: "failed", message: e instanceof Error ? e.message : "failed" } }));
          }
        }
        setPhase({ k: "done" });
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof NotEnoughSpeechError) {
          setVoiceSample(null);
          setPhase({ k: "error", message: "Not enough speech in your recording. Record again." });
        } else setPhase({ k: "error", message: "The voice check couldn't run in this browser." });
      }
    },
    [videos, fixtureReference, rows],
  );

  const rec = useRecorder((blob) => {
    setVoiceSample(blob);
    void run({ borrowed: includeBorrowed });
  });

  // Totals over finished rows.
  const results = videos.map((f) => ({ f, s: stateOf(f) }));
  const matched = results.filter((x): x is { f: Finding; s: { k: "done"; r: ClipResult } } => x.s.k === "done" && x.s.r.matched);
  const totalSec = Math.round(matched.reduce((a, x) => a + x.s.r.matchedSeconds, 0));
  const doneCount = results.filter((x) => x.s.k === "done" || x.s.k === "failed").length;
  const borrowedCount = videos.filter((f) => f.soundOriginal === false).length;

  // Feed the attack story: one derived finding once the run is finished.
  const derivedKey = phase.k === "done" ? matched.map((x) => `${x.f.id}:${x.s.r.matchedSeconds}`).join("|") : null;
  const onDerivedRef = useRef(onDerived);
  useEffect(() => {
    onDerivedRef.current = onDerived;
  });
  useEffect(() => {
    if (derivedKey === null) return;
    onDerivedRef.current?.(matched.length ? [derivedFinding(matched.map((x) => x.f), totalSec)] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derivedKey captures matched/totalSec
  }, [derivedKey]);

  if (!videos.length) {
    return (
      <section aria-labelledby="vx-h" className="mx-auto w-full max-w-3xl">
        <Header />
        <Card className="mt-6">
          <p className="text-muted">No public videos found on your accounts.</p>
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="vx-h" className="mx-auto w-full max-w-3xl space-y-6">
      <Header />

      <Card className="space-y-5">
        <Headline seconds={totalSec} pending={phase.k !== "done"} started={phase.k !== "idle" && phase.k !== "record"} />
        <CloneMeter seconds={totalSec} />
        {phase.k === "idle" && (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => (hasReference ? void run({ borrowed: includeBorrowed }) : setPhase({ k: "record" }))}>
              Check {videos.length - (includeBorrowed ? 0 : borrowedCount)} videos
            </Button>
            <span className="text-sm text-muted">On this device. Nothing is uploaded or saved.</span>
          </div>
        )}
        {phase.k === "loading" && (
          <p role="status" className="flex items-center gap-3 text-muted">
            <span className="sv-pulse size-2 rounded-full bg-fg" aria-hidden />
            Loading the voice model{phase.total > 0 && <span className="sv-num">{Math.round((phase.loaded / phase.total) * 100)}%</span>}
          </p>
        )}
        {phase.k === "running" && (
          <p role="status" className="flex items-center gap-3 text-muted">
            <span className="sv-pulse size-2 rounded-full bg-fg" aria-hidden />
            Listening <span className="sv-num">{doneCount}</span>/<span className="sv-num">{results.filter((x) => x.s.k !== "borrowed").length}</span>
          </p>
        )}
        {phase.k === "error" && <ErrorState title="That didn't work" detail={phase.message} action={<Button variant="secondary" onClick={() => setPhase({ k: "record" })}>Record again</Button>} />}
      </Card>

      {phase.k === "record" && (
        <Card>
          <p className="text-muted">We need your voice to compare. Read aloud. It stays on this device.</p>
          <blockquote className={cn("mt-3 border-l-2 border-fg pl-4 font-display text-xl leading-relaxed", rec.state === "recording" ? "text-fg" : "text-muted")}>{PASSAGE}</blockquote>
          <Waveform level={rec.level} active={rec.state === "recording"} />
          <div className="mt-5 flex flex-wrap items-center gap-5">
            {rec.state !== "recording" ? (
              <Button size="lg" onClick={() => void rec.start()} disabled={rec.state === "starting"}>
                <span className="size-3 rounded-full bg-danger" aria-hidden="true" />
                {rec.state === "starting" ? "Waiting for microphone" : "Start recording"}
              </Button>
            ) : (
              <Button variant="secondary" size="lg" onClick={rec.stop} disabled={rec.elapsed < MIN_SECONDS}>
                {rec.elapsed < MIN_SECONDS ? (
                  <>
                    Keep reading <span className="sv-num">{MIN_SECONDS - rec.elapsed}</span>
                  </>
                ) : (
                  "Finish now"
                )}
              </Button>
            )}
            {rec.state === "recording" && <div className="sv-num text-3xl tabular-nums">0:{String(Math.max(0, RECORD_SECONDS - rec.elapsed)).padStart(2, "0")}</div>}
          </div>
          {rec.state === "denied" && <ErrorState className="mt-4" title="Microphone blocked" detail="Allow it in your browser's site settings, then try again." />}
          {rec.state === "unsupported" && <ErrorState className="mt-4" title="This browser can't record audio" />}
          {rec.state === "error" && <ErrorState className="mt-4" title="No microphone found" />}
        </Card>
      )}

      <Card flush>
        <ul className="divide-y divide-edge" aria-label="Your public videos">
          {results.map(({ f, s }) => (
            <VideoRow key={f.id} f={f} s={s} masked={masked} />
          ))}
        </ul>
        {borrowedCount > 0 && !includeBorrowed && phase.k !== "running" && phase.k !== "loading" && (
          <div className="border-t border-edge px-4 py-3 sm:px-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIncludeBorrowed(true);
                if (phase.k === "done") void run({ borrowed: true });
              }}
            >
              Check borrowed audio too
            </Button>
          </div>
        )}
      </Card>

      {doneCount > 0 && (
        <Card>
          <h3 className="text-sm font-medium text-muted">Seconds of your voice, per video</h3>
          <ExposureChart
            className="mt-4"
            points={results
              .filter((x) => x.s.k === "done")
              .map((x, i) => ({ name: `${i + 1}`, seconds: x.s.k === "done" ? x.s.r.matchedSeconds : 0 }))}
          />
        </Card>
      )}

      {phase.k === "done" && <Fixes matched={matched.map((x) => x.f)} masked={masked} />}
    </section>
  );
}

function Header() {
  return (
    <header className="flex items-center gap-4">
      <Icon3D name="mic" size={64} motion="float" />
      <h2 id="vx-h" className="sv-display text-[clamp(2rem,4.4vw,3rem)] leading-[1]">
        Your voice, in public
      </h2>
    </header>
  );
}

function Headline({ seconds, pending, started }: { seconds: number; pending: boolean; started: boolean }) {
  if (!started) return <p className="font-display text-2xl">How much of your real voice is out there?</p>;
  return (
    <p className="font-display text-2xl" aria-live="polite">
      <span className={cn("sv-num text-[clamp(2.5rem,6vw,4rem)] leading-none", seconds >= CLONE_MIN_SEC && "text-danger-fg")}>{seconds} s</span>{" "}
      of your voice is public{pending && <span className="text-muted"> so far</span>}
    </p>
  );
}

/** Seconds found vs what instant cloning needs. */
function CloneMeter({ seconds }: { seconds: number }) {
  const max = Math.max(CLONE_RECOMMENDED_SEC * 1.25, seconds * 1.1);
  const pct = (x: number) => `${Math.min(100, (x / max) * 100)}%`;
  return (
    <div>
      <div className="relative h-3 rounded-full bg-[color-mix(in_srgb,var(--text)_8%,transparent)]" role="meter" aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={seconds} aria-label="Seconds of your voice found">
        <span className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 motion-reduce:transition-none", seconds >= CLONE_MIN_SEC ? "bg-danger" : "bg-fg")} style={{ width: pct(seconds) }} />
        <Marker at={pct(CLONE_MIN_SEC)} />
        <Marker at={pct(CLONE_RECOMMENDED_SEC)} />
      </div>
      <div className="relative mt-2 h-10 text-sm text-muted">
        <MarkerLabel at={pct(CLONE_MIN_SEC)} label={`${CLONE_MIN_SEC} s: enough to clone`} />
        <MarkerLabel at={pct(CLONE_RECOMMENDED_SEC)} label={`${CLONE_RECOMMENDED_SEC} s: a good clone`} />
      </div>
    </div>
  );
}

function Marker({ at }: { at: string }) {
  return <span aria-hidden className="absolute -inset-y-1 w-0.5 bg-fg" style={{ left: at }} />;
}

function MarkerLabel({ at, label }: { at: string; label: string }) {
  const tip = useId();
  return (
    <span className="group absolute -translate-x-1/2 whitespace-nowrap" style={{ left: at }}>
      <a href={ELEVENLABS_DOCS} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-4 hover:text-fg focus-visible:text-fg" aria-describedby={tip}>
        {label}
      </a>
      <span id={tip} role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 whitespace-normal rounded-control border border-edge bg-elevated p-3 text-fg opacity-0 shadow-pop transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {CLONE_TIP}
      </span>
    </span>
  );
}

function VideoRow({ f, s, masked }: { f: Finding; s: RowState; masked: boolean }) {
  return (
    <li className="flex items-center gap-4 px-4 py-3 sm:px-6">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-control border border-edge bg-surface">
        {f.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- platform CDN thumbnails
          <img src={f.imageUrl} alt="" referrerPolicy="no-referrer" className={cn("size-full object-cover", masked && "blur-md grayscale")} />
        ) : (
          <span className="grid size-full place-items-center">
            <Icon3D name={SOURCE_ICON[f.sourceType]} size={36} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-medium", masked && "blur-sm")}>{f.value.replace(/^Video:\s*/, "")}</p>
        <p className="truncate text-sm text-muted">
          {PLATFORM[f.sourceType] ?? f.sourceType}
          {f.durationSec ? ` · ${Math.round(f.durationSec)} s` : ""}
          {f.soundTitle ? ` · ${f.soundTitle}` : ""}
        </p>
      </div>
      <Verdict s={s} />
    </li>
  );
}

function Verdict({ s }: { s: RowState }) {
  switch (s.k) {
    case "borrowed":
      return <Chip>Borrowed audio</Chip>;
    case "queued":
      return <Chip className="opacity-60">Waiting</Chip>;
    case "checking":
      return (
        <Chip>
          <span className="sv-pulse size-1.5 rounded-full bg-fg" aria-hidden />
          Listening
        </Chip>
      );
    case "failed":
      return (
        <span title={s.message}>
          <Chip>Couldn&rsquo;t load</Chip>
        </span>
      );
    case "done":
      if (s.r.kind === "yours")
        return (
          <RiskBadge level="danger">
            Your voice <span className="sv-num">{Math.round(s.r.matchedSeconds)} s</span>
          </RiskBadge>
        );
      return (
        <span title={`Best match ${s.r.similarity}`}>
          <Chip>{s.r.kind === "no_speech" ? "No speech" : "Someone else"}</Chip>
        </span>
      );
  }
}

function Fixes({ matched, masked }: { matched: Finding[]; masked: boolean }) {
  const platforms = [...new Set(matched.map((f) => PLATFORM[f.sourceType] ?? f.sourceType))];
  return (
    <Card>
      <h3 className="sv-display text-2xl">Cut it down</h3>
      <ul className="mt-4 flex flex-col divide-y divide-edge">
        <li className="flex items-start gap-4 py-4">
          <Icon3D name="lock" size={48} />
          <div>
            <p className="font-semibold">Make {platforms.length ? platforms.join(" and ") : "your accounts"} private</p>
            <p className="text-muted">Strangers can&rsquo;t download what they can&rsquo;t see.</p>
          </div>
        </li>
        <li className="flex items-start gap-4 py-4">
          <Icon3D name="trash" size={48} />
          <div className="min-w-0">
            <p className="font-semibold">{matched.length ? `Remove or mute ${matched.length} ${matched.length === 1 ? "video" : "videos"}` : "Keep talking videos private"}</p>
            {matched.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1 text-muted">
                {matched.map((f) => (
                  <li key={f.id} className={cn("truncate", masked && "blur-sm")}>
                    <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-fg">
                      {f.value.replace(/^Video:\s*/, "")}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
        <li className="flex items-start gap-4 py-4">
          <Icon3D name="key" size={48} />
          <div>
            <p className="font-semibold">Set a family safe word</p>
            <p className="text-muted">A cloned voice can&rsquo;t guess it.</p>
          </div>
        </li>
      </ul>
    </Card>
  );
}

export const DERIVED_ID = "voice-exposure";

/** One finding that tells the attack map how much of your voice is public. */
export function derivedFinding(matched: Finding[], seconds: number): Finding {
  const first = matched[0];
  return {
    id: DERIVED_ID,
    category: "video",
    label: `Your voice, ${seconds} seconds, public`,
    value: `${seconds} s of your own voice across ${matched.length} public ${matched.length === 1 ? "video" : "videos"}`,
    sourceType: first.sourceType,
    sourceUrl: first.sourceUrl,
    sourceTitle: first.sourceTitle,
    sources: matched.map((f) => ({ url: f.sourceUrl, title: f.sourceTitle, sourceType: f.sourceType })),
    anchor: first.anchor,
    confidence: 0.9,
    riskWeight: seconds >= CLONE_MIN_SEC ? 9 : 6,
    foundAt: new Date().toISOString(),
    durationSec: seconds,
    soundOriginal: true,
  };
}
