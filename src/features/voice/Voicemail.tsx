"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding } from "@/lib/types";
import { PracticeMark } from "@/design/PracticeMark";

export interface VoicemailMeta {
  text: string;
  uses: { findingId: string; phrase: string }[];
}

/** Splits the transcript so each personal detail is a highlighted, finding-linked span. */
function segments(meta: VoicemailMeta) {
  const found: { start: number; end: number; findingId: string }[] = [];
  const lower = meta.text.toLowerCase();
  for (const u of meta.uses) {
    const i = lower.indexOf(u.phrase.toLowerCase());
    if (i >= 0 && !found.some((f) => i < f.end && i + u.phrase.length > f.start)) {
      found.push({ start: i, end: i + u.phrase.length, findingId: u.findingId });
    }
  }
  found.sort((a, b) => a.start - b.start);
  const out: { text: string; findingId?: string }[] = [];
  let at = 0;
  for (const f of found) {
    if (f.start > at) out.push({ text: meta.text.slice(at, f.start) });
    out.push({ text: meta.text.slice(f.start, f.end), findingId: f.findingId });
    at = f.end;
  }
  if (at < meta.text.length) out.push({ text: meta.text.slice(at) });
  return out;
}

export function Transcript({ meta, findings }: { meta: VoicemailMeta; findings: Finding[] }) {
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const parts = useMemo(() => segments(meta), [meta]);
  const used = meta.uses.filter((u) => byId.has(u.findingId));
  return (
    <div data-transcript>
      <p className="font-display text-xl leading-relaxed">
        {parts.map((p, i) =>
          p.findingId ? (
            <mark
              key={i}
              title={`From your public footprint: ${byId.get(p.findingId)?.label ?? ""}`}
              data-on="true"
              data-tone="personal"
              className="sv-hl bg-transparent"
            >
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
      {used.length > 0 && (
        <ul className="mt-5 space-y-2 border-t border-edge pt-4 text-muted">
          {used.map((u) => {
            const f = byId.get(u.findingId)!;
            return (
              <li key={u.findingId + u.phrase}>
                <span className="text-fg">&ldquo;{u.phrase}&rdquo;</span> · <span className="text-fg">{f.label}</span> · {f.sourceTitle ?? f.sourceType}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** In-app-only player. Audio is a blob URL, revoked as soon as playback ends. */
export function VoicemailPlayer({
  audio,
  meta,
  findings,
}: {
  audio: Blob;
  meta: VoicemailMeta;
  findings: Finding[];
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ended, setEnded] = useState(false);

  const revoke = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };
  // Revoke on unmount (e.g. "Record again"); the blob URL only exists once Play is pressed.
  useEffect(() => revoke, []);

  const finish = () => {
    const a = ref.current;
    if (a) a.removeAttribute("src");
    revoke();
    setPlaying(false);
    setEnded(true);
  };

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (!urlRef.current) {
      urlRef.current = URL.createObjectURL(audio);
      a.src = urlRef.current;
      a.setAttribute("controlsList", "nodownload noplaybackrate");
    }
    if (a.paused) void a.play();
    else a.pause();
  };

  return (
    <PracticeMark className="sv-card overflow-hidden" onContextMenu={(e: React.MouseEvent) => e.preventDefault()}>
      <div className="flex items-center border-b border-edge px-5 py-3">
        <span className="text-sm text-muted">New voicemail</span>
      </div>
      <div className="px-5 py-5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={toggle}
            disabled={ended}
            aria-label={playing ? "Pause voicemail" : "Play voicemail"}
            className="sv-press grid size-14 shrink-0 place-items-center rounded-full bg-accent text-on-accent disabled:opacity-30"
          >
            {playing ? (
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <rect x="4" y="3" width="4" height="14" fill="currentColor" />
                <rect x="12" y="3" width="4" height="14" fill="currentColor" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 3l12 7-12 7z" fill="currentColor" />
              </svg>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-semibold">Mom, I&rsquo;m in trouble</div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-edge-strong"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-label="Playback progress"
            >
              <div className="h-full bg-fg" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        </div>
        <audio
          ref={ref}
          preload="none"
          onContextMenu={(e) => e.preventDefault()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            if (a.duration) setProgress(a.currentTime / a.duration);
          }}
          onEnded={finish}
        />
        {ended && (
          <p className="mt-4 text-safe-fg" role="status">
            Played once. Clone and recording deleted.
          </p>
        )}
      </div>
      <div className="border-t border-edge px-5 py-5">
        <div className="mb-3 text-sm text-muted">What it said</div>
        <Transcript meta={meta} findings={findings} />
      </div>
    </PracticeMark>
  );
}
