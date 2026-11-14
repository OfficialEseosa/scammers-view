"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { SourceType } from "@/lib/types";
import type { SourceStatus } from "@/hooks/useScanStream";
import { SOURCE_LABEL, SOURCE_ORDER } from "@/components/scan/meta";
import { FindingFeed } from "@/components/scan/FindingFeed";
import { HiddenNotMe } from "@/components/scan/NotMe";
import { useScanEta } from "@/components/scan/eta";
import { LoadingDots } from "@/design/LoadingDots";
import { useSession } from "@/state/session";
import { AttackMapSlot } from "@/components/session/slots";
import { SegmentedTabs } from "@/design/SegmentedTabs";
import { Button } from "@/design/Button";
import { ErrorState } from "@/design/states";
import { ScoreArc } from "@/design/ScoreArc";
import { Icon3D, SOURCE_ICON } from "@/design/Icon3D";
import { DotField, ScanSweep } from "@/design/backgrounds";
import { FindingsSparkline } from "@/design/charts";
import { EASE_OUT } from "@/design/motion";
import { cn } from "@/design/utils";

const AUTO_ADVANCE_S = 6;

export function LiveStage() {
  const { scan, masked, subjectName, setStage, liveScore, markNotMe } = useSession();
  const eta = useScanEta(scan);
  const [view, setView] = useState<"map" | "feed">("map");
  const running = scan.phase === "connecting" || scan.phase === "running";
  const done = scan.phase === "done";
  const goResults = useCallback(() => setStage("results"), [setStage]);
  // Only count down when the scan finishes in front of you, not when you come back to this view later.
  const [arrivedDone] = useState(done);
  const countdown = useCountdown(done && !arrivedDone, goResults);
  const banner = <DoneBanner onGo={goResults} left={countdown.left} held={countdown.held || arrivedDone} onHold={countdown.hold} />;

  return (
    <div className="relative isolate flex flex-1 flex-col">
      <DotField className="-z-10" activity={running ? 0.9 : 0} fade="radial" />
      <div className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-3 px-3 pb-4 pt-3 sm:px-6 lg:grid lg:h-[calc(100dvh-4.25rem)] lg:min-h-[560px] lg:flex-none lg:grid-cols-[minmax(0,1fr)_25rem] lg:grid-rows-[minmax(0,1fr)] lg:gap-5 lg:pb-5">
        <div className="lg:hidden">
          <Status compact eta={eta.text} />
        </div>

        <SegmentedTabs
          className="lg:hidden"
          stretch
          label="Live view"
          value={view}
          onChange={setView}
          items={[
            { id: "map", label: "Attack map" },
            { id: "feed", label: `Found ${scan.findings.length}` },
          ]}
        />

        <section
          aria-label="Attack map"
          data-live-map
          className={cn(
            "relative h-[calc(100dvh-15rem)] min-h-[380px] overflow-hidden rounded-card border border-edge bg-canvas lg:col-start-1 lg:row-start-1 lg:block lg:h-auto",
            view === "map" ? "" : "hidden",
          )}
        >
          <AttackMapSlot findings={scan.findings} chains={scan.chains} score={liveScore} subjectName={masked ? subjectName.split(" ")[0] : subjectName} masked={masked} phoneDefault="map" railDefault="closed" />
          <ScanSweep active={running} />
        </section>

        <aside className={cn("flex min-h-0 flex-col gap-3 lg:col-start-2 lg:row-start-1", view === "feed" ? "" : "hidden lg:flex")}>
          <div className="hidden lg:block">
            <Status eta={eta.text} />
          </div>
          <AnimatePresence>{done && <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }}>{banner}</motion.div>}</AnimatePresence>
          {scan.phase === "error" && (
            <ErrorState
              title="The scan stopped"
              detail={scan.error}
              action={
                <div className="flex flex-wrap gap-3">
                  <Button onClick={scan.restart}>Try again</Button>
                  {scan.findings.length > 0 && (
                    <Button variant="secondary" onClick={() => setStage("results")}>
                      Use what was found
                    </Button>
                  )}
                </div>
              }
            />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-card border border-edge bg-canvas/90 backdrop-blur-sm">
            <FindingFeed findings={scan.findings} masked={masked} running={running} onNotMe={markNotMe} />
            <HiddenNotMe masked={masked} className="m-3" />
          </div>
        </aside>

        {done && view === "map" && <div className="lg:hidden">{banner}</div>}
      </div>
    </div>
  );
}

function Status({ compact = false, eta }: { compact?: boolean; eta: string | null }) {
  const { scan, liveScore } = useSession();
  const running = scan.phase === "connecting" || scan.phase === "running";
  const headline = scan.phase === "error" ? "Stopped" : scan.phase === "done" ? "Scan complete" : scan.message;
  return (
    <div className="sv-card bg-canvas/90 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-muted">
            {running && <span aria-hidden className="sv-pulse size-2 shrink-0 rounded-full bg-fg" />}
            <span className="truncate">
              {headline}
              {running && <LoadingDots />}
            </span>
          </p>
          {running && (
            <p className="mt-1 text-sm text-fg">
              {eta ?? (
                <>
                  Estimating time left
                  <LoadingDots />
                </>
              )}
            </p>
          )}
          <div className="mt-2 flex items-baseline gap-5">
            <p>
              <span className="sv-num text-4xl leading-none">{scan.findings.length}</span>
              <span className="ml-1.5 text-sm text-muted">facts</span>
            </p>
            <p>
              <span className="sv-num text-4xl leading-none">{scan.chains.length}</span>
              <span className="ml-1.5 text-sm text-muted">ways in</span>
            </p>
          </div>
        </div>
        <ScoreArc score={liveScore ? liveScore.score : null} size={compact ? 88 : 112} />
      </div>
      {!compact && (
        <>
          <FindingsSparkline findings={scan.findings} className="mt-3" height={56} />
          <SourceTiles sources={scan.sources} />
        </>
      )}
    </div>
  );
}

function SourceTiles({ sources }: { sources: Partial<Record<SourceType, SourceStatus>> }) {
  const extra = (Object.keys(sources) as SourceType[]).filter((s) => !SOURCE_ORDER.includes(s));
  return (
    <ul className="mt-4 grid grid-cols-6 gap-1.5" aria-label="Sources">
      {[...SOURCE_ORDER, ...extra].map((s) => {
        const st = sources[s];
        const state = st?.status ?? "idle";
        const blocked = state === "done" && st?.count === 0;
        return (
          <li key={s} title={`${SOURCE_LABEL[s]}${state === "done" ? `: ${st?.count}` : state === "running" ? ": searching" : ""}`} className="relative">
            <span
              className={cn(
                "relative grid aspect-square place-items-center overflow-hidden rounded-control border transition-colors duration-300",
                state === "running" && "sv-sweep border-fg",
                state === "done" && !blocked && "border-safe",
                blocked && "border-edge opacity-45",
                state === "idle" && "border-edge opacity-60",
              )}
            >
              <Icon3D name={SOURCE_ICON[s]} size={26} className={cn(state === "idle" && "grayscale")} />
              {state === "done" && !blocked && (
                <span className="sv-num absolute bottom-0.5 right-1 text-sm leading-none">{st?.count}</span>
              )}
              {blocked && <span aria-hidden className="absolute inset-x-1 top-1/2 h-px -rotate-12 bg-muted" />}
            </span>
            <span className="sr-only">
              {SOURCE_LABEL[s]}: {state === "running" ? "searching" : state === "done" ? `${st?.count} found` : "waiting"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function useCountdown(active: boolean, onGo: () => void) {
  const [left, setLeft] = useState(AUTO_ADVANCE_S);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || held) return;
    if (left <= 0) {
      onGo();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [active, left, held, onGo]);
  return { left, held, hold: () => setHeld(true) };
}

function DoneBanner({ onGo, left, held, onHold }: { onGo: () => void; left: number; held: boolean; onHold: () => void }) {
  return (
    <div className="sv-card flex flex-wrap items-center gap-3 border-fg bg-canvas p-4">
      <Button size="lg" onClick={onGo} className="flex-1">
        Break the chain
      </Button>
      {!held ? (
        <button type="button" onClick={onHold} className="min-h-11 text-sm text-muted underline underline-offset-4 hover:text-fg">
          Stay on the map <span className="sv-num">{left}</span>
        </button>
      ) : null}
    </div>
  );
}
