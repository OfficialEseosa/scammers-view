"use client";

import { useCallback, useMemo } from "react";
import type { Finding } from "@/lib/types";
import type { VideoChannel, VideoResponse } from "@/lib/vision/schema";
import { VIDEOS_PER_SCAN } from "@/lib/vision/limits";
import { Icon3D } from "@/design/Icon3D";
import { cn } from "@/design/utils";
import { fromFixture, readVideo, type ItemState } from "./client";
import { FactChip, GeminiMark, ItemAction, RemoteImage, usageLine } from "./parts";
import { AllButton, hostOf } from "./PhotoContext";
import { useVision } from "./useVision";

export interface VideoContextProps {
  /** Scan findings; only the user's own `video` findings with a mediaUrl are used. */
  findings: Finding[];
  masked?: boolean;
  onFindings?: (findings: Finding[]) => void;
  fixture?: Record<string, VideoResponse>;
  showUsage?: boolean;
  className?: string;
}

const CHANNELS: { id: VideoChannel; label: string }[] = [
  { id: "speech", label: "Said out loud" },
  { id: "screen", label: "On screen" },
  { id: "scene", label: "In the picture" },
];

/** What each of the user's own videos says and shows, watched and heard by Gemini on an explicit click. */
export function VideoContext({ findings, masked = false, onFindings, fixture, showUsage, className }: VideoContextProps) {
  const videos = useMemo(() => findings.filter((f) => f.category === "video" && f.mediaUrl && !f.id.startsWith("gvideo-")), [findings]);
  const run = useCallback(
    (f: Finding, signal: AbortSignal): Promise<ItemState> => (fixture ? fromFixture(fixture[f.id], signal) : readVideo(f, signal)),
    [fixture],
  );
  const v = useVision(videos, run, { cap: VIDEOS_PER_SCAN, onFindings });
  if (!videos.length) return null;

  return (
    <section aria-labelledby="video-context-h" className={cn("flex flex-col gap-6", className)}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 id="video-context-h" className="sv-display text-[clamp(1.6rem,3vw,2.2rem)] leading-[1]">
            What your videos give away
          </h2>
          <p className="text-sm text-muted">Voice match stays on this device. Analyse sends your own video to Google Gemini.</p>
        </div>
        <AllButton v={v} />
      </header>
      <ul className="grid gap-4 lg:grid-cols-2">
        {videos.map((f) => (
          <VideoCard key={f.id} video={f} state={v.stateOf(f.id)} masked={masked} showUsage={showUsage} onRun={() => void v.analyseOne(f)} disabled={v.runningAll || v.atCap} />
        ))}
      </ul>
    </section>
  );
}

function VideoCard({ video, state, masked, showUsage, onRun, disabled }: { video: Finding; state: ItemState; masked: boolean; showUsage?: boolean; onRun: () => void; disabled?: boolean }) {
  const res = state.k === "done" ? (state.res as VideoResponse) : null;
  return (
    <li className="sv-card flex flex-col gap-4 p-4 sm:flex-row">
      <div className="w-full shrink-0 sm:w-36">
        {video.imageUrl ? (
          <RemoteImage url={video.imageUrl} alt="" masked={masked} className="aspect-[9/16] max-h-64 rounded-control bg-surface [&_img]:h-full [&_img]:object-cover" />
        ) : (
          <div className="flex aspect-[9/16] max-h-64 items-center justify-center rounded-control bg-surface">
            <Icon3D name="mic" size={56} />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
          <span className="truncate">{video.sourceTitle || hostOf(video.sourceUrl)}</span>
          {video.durationSec ? <span className="sv-num">{Math.round(video.durationSec)} s</span> : null}
        </p>
        {res ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <GeminiMark />
              {showUsage && <span className="sv-num text-xs text-muted">{usageLine(res.usage)}</span>}
            </div>
            {res.readout.scammerLearns && <p className="font-medium">{res.readout.scammerLearns}</p>}
            {res.readout.facts.length === 0 && <p className="text-sm text-muted">Nothing a scammer could use.</p>}
            {CHANNELS.map(({ id, label }) => {
              const facts = res.readout.facts.filter((x) => x.channel === id);
              if (!facts.length) return null;
              return (
                <div key={id} className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
                  <ul className="flex flex-col gap-2">
                    {facts.map((x, i) => (
                      <FactChip key={i} label={x.label} value={x.value} risk={x.risk} masked={masked} meta={x.at ?? undefined} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </>
        ) : (
          <ItemAction state={state} onRun={onRun} disabled={disabled} />
        )}
      </div>
    </li>
  );
}
