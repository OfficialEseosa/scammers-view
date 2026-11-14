"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Finding } from "@/lib/types";
import { MIN_SECONDS, RECORD_SECONDS, useRecorder } from "./useRecorder";
import { Transcript, VoicemailPlayer, type VoicemailMeta } from "./Voicemail";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { ErrorState } from "@/design/states";
import { Icon3D } from "@/design/Icon3D";
import { setVoiceSample } from "@/lib/voice-exposure/store";

export interface VoiceDemoProps {
  findings: Finding[];
  subjectName: string;
  /** Presentation mode: hide personal details on screen. */
  masked?: boolean;
}

export const PASSAGE =
  "The north wind and the sun were arguing about which of them was stronger, when a traveler came along wrapped in a warm cloak. " +
  "They agreed that whoever could make him take his cloak off first would be the winner. " +
  "The wind blew as hard as it could, but the harder it blew, the tighter he held his cloak. " +
  "Then the sun shone gently, and soon the traveler was warm enough to take it off.";

type Phase =
  | { k: "intro" }
  | { k: "record" }
  | { k: "working" }
  | { k: "result"; audio: Blob; meta: VoicemailMeta }
  | { k: "notConfigured"; meta?: VoicemailMeta }
  | { k: "error"; message: string; meta?: VoicemailMeta };

export function VoiceDemo({ findings, subjectName, masked = false }: VoiceDemoProps) {
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "intro" });
  const abortRef = useRef<AbortController | null>(null);
  const firstName = masked ? "you" : subjectName.split(" ")[0] || "you";

  const submit = useCallback(
    async (blob: Blob) => {
      // Kept in this tab's memory only, so the voice-exposure check can match against it.
      setVoiceSample(blob);
      setPhase({ k: "working" });
      const ac = new AbortController();
      abortRef.current = ac;
      const form = new FormData();
      form.set("consent", "yes");
      form.set("findings", JSON.stringify(findings));
      form.set("sample", blob, "sample");
      try {
        const res = await fetch("/api/voice", { method: "POST", body: form, signal: ac.signal, cache: "no-store" });
        if (res.ok) {
          const header = res.headers.get("X-Voicemail-Script");
          const meta: VoicemailMeta = header ? JSON.parse(decodeURIComponent(header)) : { text: "", uses: [] };
          setPhase({ k: "result", audio: await res.blob(), meta });
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; script?: VoicemailMeta };
        if (body.error === "voice_not_configured") setPhase({ k: "notConfigured", meta: body.script });
        else if (res.status === 401) setPhase({ k: "error", message: "Sign in again to try this." });
        else setPhase({ k: "error", message: body.message ?? "Something went wrong.", meta: body.script });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setPhase({ k: "error", message: "Couldn't reach the server. Try again." });
      }
    },
    [findings],
  );

  const rec = useRecorder(submit);

  useEffect(() => () => abortRef.current?.abort(), []);

  const restart = () => {
    rec.reset();
    setPhase({ k: "record" });
  };

  return (
    <section aria-labelledby="voice-h" className="mx-auto w-full max-w-3xl space-y-6">
      <header className="flex items-center gap-4">
        <Icon3D name="mic" size={64} motion="float" />
        <h2 id="voice-h" className="sv-display text-[clamp(2rem,4.4vw,3rem)] leading-[1]">
          Your voice, cloned
        </h2>
      </header>

      {phase.k === "intro" && (
        <Card>
          <h3 className="font-display text-xl font-semibold">Before you record</h3>
          <ul className="mt-4 flex flex-col divide-y divide-edge border-y border-edge text-lg">
            <li className="py-3">Live microphone only. No uploads.</li>
            <li className="py-3">Plays on this page only. No download, no share.</li>
            <li className="py-3">The voice clone is deleted the moment the voicemail is made.</li>
            <li className="py-3">It ends with a spoken reminder that it&rsquo;s practice.</li>
          </ul>
          <label className="mt-5 flex min-h-12 cursor-pointer items-center gap-3 text-lg">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="size-6 shrink-0 cursor-pointer" />
            <span>It&rsquo;s my own voice and I agree</span>
          </label>
          <Button size="lg" disabled={!consent} onClick={() => setPhase({ k: "record" })} className="mt-5">
            Continue
          </Button>
        </Card>
      )}

      {phase.k === "record" && (
        <Card>
          <p className="text-muted">Read aloud until the timer ends</p>
          <blockquote className={`mt-3 border-l-2 border-fg pl-4 font-display text-xl leading-relaxed transition-colors ${rec.state === "recording" ? "text-fg" : "text-muted"}`}>{PASSAGE}</blockquote>

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
            {rec.state === "recording" && (
              <div className="sv-num text-3xl tabular-nums" aria-live="off">
                0:{String(Math.max(0, RECORD_SECONDS - rec.elapsed)).padStart(2, "0")}
              </div>
            )}
          </div>

          {rec.state === "denied" && <ErrorState className="mt-4" title="Microphone blocked" detail="Allow it in your browser's site settings, then try again." />}
          {rec.state === "unsupported" && <ErrorState className="mt-4" title="This browser can't record audio" detail="Try a recent Chrome, Safari or Firefox." />}
          {rec.state === "error" && <ErrorState className="mt-4" title="No microphone found" detail="Plug one in and try again." />}
        </Card>
      )}

      {phase.k === "working" && (
        <Card role="status" className="flex items-center gap-4">
          <span className="sv-pulse size-2.5 rounded-full bg-fg" aria-hidden />
          <p className="font-display text-xl">Cloning, writing, recording, deleting</p>
        </Card>
      )}

      {phase.k === "result" && (
        <div className={masked ? "[&_[data-transcript]]:blur-sm" : ""}>
          <VoicemailPlayer audio={phase.audio} meta={phase.meta} findings={findings} />
        </div>
      )}

      {phase.k === "notConfigured" && (
        <Card>
          <p className="font-display text-xl font-semibold">Voice is off on this server</p>
          <p className="mt-2 text-muted">Your recording was discarded.</p>
          {phase.meta && <ScriptPreview meta={phase.meta} findings={findings} masked={masked} />}
        </Card>
      )}

      {phase.k === "error" && (
        <ErrorState title="That didn't work" detail={phase.message} />
      )}
      {phase.k === "error" && phase.meta && <ScriptPreview meta={phase.meta} findings={findings} masked={masked} />}

      {(phase.k === "result" || phase.k === "notConfigured" || phase.k === "error") && (
        <Button variant="secondary" onClick={restart}>
          Record again
        </Button>
      )}

      {(phase.k === "result" || phase.k === "notConfigured") && <SafeWordCard firstName={firstName} />}
    </section>
  );
}

export function Waveform({ level, active }: { level: number; active: boolean }) {
  const [bars, setBars] = useState<number[]>(() => Array(48).fill(0));
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => setBars((b) => [...b.slice(1), level]));
    return () => cancelAnimationFrame(id);
  }, [level, active]);
  return (
    <div
      className="mt-6 flex h-16 items-center gap-[3px]"
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      {bars.map((v, i) => (
        <span key={i} className="flex-1 rounded-full bg-fg transition-[height] duration-75" style={{ height: `${Math.max(6, Math.min(100, v * 140))}%`, opacity: active ? 0.35 + (i / bars.length) * 0.65 : 0.2 }} />
      ))}
    </div>
  );
}

function ScriptPreview({ meta, findings, masked }: { meta: VoicemailMeta; findings: Finding[]; masked: boolean }) {
  return (
    <Card className={masked ? "[&_[data-transcript]]:blur-sm" : ""}>
      <p className="mb-3 text-muted">It would have said</p>
      <Transcript meta={meta} findings={findings} />
    </Card>
  );
}

function SafeWordCard({ firstName }: { firstName: string }) {
  return (
    <Card className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <Icon3D name="key" size={72} />
      <div>
        <h3 className="sv-display text-2xl">Set a family safe word</h3>
        <p className="mt-2 max-w-prose text-muted">One word only your family knows. Tell {firstName === "you" ? "them" : `${firstName}'s family`} in person.</p>
        <h4 className="mt-5 font-display text-lg font-semibold">If a call like this comes</h4>
        <ol className="mt-2 flex flex-col gap-2">
          {[
            "Hang up.",
            "Call back on the number you already have.",
            "Ask for the safe word.",
            "Never send money, gift cards or crypto.",
            "Report it at reportfraud.ftc.gov.",
          ].map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="sv-num w-4 shrink-0 text-muted">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
