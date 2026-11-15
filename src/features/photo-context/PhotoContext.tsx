"use client";

import { useCallback, useEffect, useState } from "react";
import type { Finding } from "@/lib/types";
import type { PhotoResponse } from "@/lib/vision/schema";
import { PHOTOS_PER_SCAN } from "@/lib/vision/limits";
import { Button } from "@/design/Button";
import { Chip } from "@/design/Badge";
import { cn } from "@/design/utils";
import { fromFixture, readPhoto, type ItemState } from "./client";
import { FactChip, GeminiMark, ItemAction, RemoteImage, usageLine } from "./parts";
import { useVision } from "./useVision";

export interface PhotoContextProps {
  /** Photos ALREADY face-matched to the user on this device. Nothing else is ever sent. */
  photos: Finding[];
  masked?: boolean;
  /** Every finding Gemini read off the photos so far (merge into the scan's findings). */
  onFindings?: (findings: Finding[]) => void;
  /** Fixture mode: canned answers by finding id, no network. */
  fixture?: Record<string, PhotoResponse>;
  /** Show latency and cost under each card (lab). */
  showUsage?: boolean;
  className?: string;
}

/** What each matched photo reveals, read by Gemini on an explicit click. */
export function PhotoContext({ photos, masked = false, onFindings, fixture, showUsage, className }: PhotoContextProps) {
  const run = useCallback(
    (p: Finding, signal: AbortSignal): Promise<ItemState> => (fixture ? fromFixture(fixture[p.id], signal) : readPhoto(p, signal)),
    [fixture],
  );
  const v = useVision(photos, run, { cap: PHOTOS_PER_SCAN, onFindings });
  // The dashboard's "Analyze pictures" button starts the same run as "Analyse all".
  const { canAnalyseAll, busy, analyseAll } = v;
  useEffect(() => {
    const start = () => {
      if (canAnalyseAll && !busy) void analyseAll();
    };
    window.addEventListener("sv:analyse-photos", start);
    return () => window.removeEventListener("sv:analyse-photos", start);
  }, [canAnalyseAll, busy, analyseAll]);
  if (!photos.length) return null;

  return (
    <section aria-labelledby="photo-context-h" className={cn("flex flex-col gap-6", className)}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 id="photo-context-h" className="sv-display text-[clamp(1.6rem,3vw,2.2rem)] leading-[1]">
            What your photos give away
          </h2>
          <p className="text-sm text-muted">Face match stays on this device. Analyse sends a matched photo to Google Gemini.</p>
        </div>
        <AllButton v={v} />
      </header>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {photos.map((p) => (
          <PhotoCard key={p.id} photo={p} state={v.stateOf(p.id)} masked={masked} showUsage={showUsage} onRun={() => void v.analyseOne(p)} disabled={v.runningAll || v.atCap} />
        ))}
      </ul>
    </section>
  );
}

export function AllButton({ v }: { v: ReturnType<typeof useVision> }) {
  if (v.runningAll)
    return (
      <Button variant="secondary" size="sm" onClick={v.stop}>
        Stop
      </Button>
    );
  if (v.atCap) return <Chip>Limit for this scan reached</Chip>;
  if (!v.canAnalyseAll && !v.busy) return null;
  return (
    <Button size="sm" onClick={() => void v.analyseAll()} disabled={!v.canAnalyseAll || v.busy}>
      Analyse all
    </Button>
  );
}

function PhotoCard({ photo, state, masked, showUsage, onRun, disabled }: { photo: Finding; state: ItemState; masked: boolean; showUsage?: boolean; onRun: () => void; disabled?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const res = state.k === "done" ? (state.res as PhotoResponse) : null;
  const facts = res?.readout.facts ?? [];
  return (
    <li className="sv-card flex flex-col overflow-hidden">
      <RemoteImage url={photo.imageUrl!} alt={photo.label || "Photo that shows you"} masked={masked}>
        {facts.map((f, i) =>
          f.box.length === 4 ? (
            <div
              key={i}
              aria-hidden
              className={cn(
                "pointer-events-none absolute rounded-md border-2 transition-opacity duration-200",
                active === null ? "border-white/80 opacity-90" : active === i ? "border-white opacity-100 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" : "opacity-0",
              )}
              style={{ top: `${f.box[0] / 10}%`, left: `${f.box[1] / 10}%`, height: `${(f.box[2] - f.box[0]) / 10}%`, width: `${(f.box[3] - f.box[1]) / 10}%` }}
            >
              <span className="sv-num absolute -left-px -top-px inline-flex size-5 items-center justify-center rounded-br-md rounded-tl-md bg-white text-xs font-semibold text-black">{i + 1}</span>
            </div>
          ) : null,
        )}
      </RemoteImage>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {res ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <GeminiMark />
              {showUsage && <span className="sv-num text-xs text-muted">{usageLine(res.usage)}</span>}
            </div>
            {res.readout.scammerLearns && <p className="font-medium">{res.readout.scammerLearns}</p>}
            {facts.length ? (
              <ul className="flex flex-col gap-2" aria-label="What the photo shows">
                {facts.map((f, i) => (
                  <FactChip
                    key={i}
                    index={f.box.length === 4 ? i : undefined}
                    label={f.label}
                    value={f.value}
                    risk={f.risk}
                    masked={masked}
                    active={active === i}
                    onActive={(on) => setActive(on ? i : null)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing a scammer could use.</p>
            )}
            {res.readout.otherPeople.count > 0 && (
              <Chip className="self-start">
                {res.readout.otherPeople.count} other {res.readout.otherPeople.count === 1 ? "person" : "people"}
                {res.readout.otherPeople.relationshipGuess ? `, ${res.readout.otherPeople.relationshipGuess}` : ""}
              </Chip>
            )}
          </>
        ) : (
          <>
            <p className="truncate text-sm text-muted">{photo.sourceTitle || hostOf(photo.sourceUrl)}</p>
            <ItemAction state={state} onRun={onRun} disabled={disabled} />
          </>
        )}
      </div>
    </li>
  );
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
