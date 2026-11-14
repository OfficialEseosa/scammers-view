"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Finding } from "@/lib/types";
import { RESULT_TABS, useSession, type ResultsTab } from "@/state/session";
import { SegmentedTabs } from "@/design/SegmentedTabs";
import { Card, RedactedRule } from "@/design/Card";
import { Icon3D } from "@/design/Icon3D";
import { PanelSkeleton, WarnNote } from "@/design/states";
import { ExposureRadar, RiskHistogram, SourceBars } from "@/design/charts";
import { EASE_OUT } from "@/design/motion";
import { DotField } from "@/design/backgrounds";
import { cn } from "@/design/utils";
import { planFixes } from "@/lib/fixes/plan";
import { computeExposure } from "@/lib/fixes/score";
import { breachesToFindings } from "@/lib/breach/toFindings";
import { FIXTURE_BREACHES } from "@/lib/breach/fixture";
import { AttackMapSlot, FixListSlot, PhotoContextSlot, PhotoMatchesSlot, PlacesSlot, PracticeSlot, QuizSlot, VideoContextSlot, VoiceExposureSlot, VoiceSlot } from "@/components/session/slots";

const load = (label: string) =>
  function Loading() {
    return <PanelSkeleton className="h-64" label={label} />;
  };
const BreachCheck = dynamic(() => import("@/features/breach").then((m) => m.BreachCheck), { ssr: false, loading: load("Loading breach check") });
const CampusScams = dynamic(() => import("@/features/campus").then((m) => m.CampusScams), { ssr: false, loading: load("Loading campus scams") });
const AddToRoom = dynamic(() => import("@/features/campus").then((m) => m.AddToRoom), { ssr: false });
const FamilyShare = dynamic(() => import("@/features/family").then((m) => m.FamilyShare), { ssr: false, loading: load("Loading family card") });
const ChangeWatch = dynamic(() => import("@/features/watch").then((m) => m.ChangeWatch), { ssr: false });

/**
 * Results open on the fixes. Everything that shows how an attack would work
 * stays locked until the person deliberately asks to see why it matters.
 */
export function Results() {
  const s = useSession();
  const { scan, masked, tab, setTab, unlocked, unlock, subjectName, mock } = s;
  // Panels with in-progress state (ticked fixes, a recorded voicemail, a generated message) stay mounted once visited.
  const [visited, setVisited] = useState<ReadonlySet<ResultsTab>>(new Set(["fixes"]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));

  // Breach results (an explicit click in the Breaches section) join the scan's findings here.
  const [breachFindings, setBreachFindings] = useState<Finding[]>([]);
  // The on-device voice check adds one derived "Your voice, N seconds, public" finding.
  const [voiceFindings, setVoiceFindings] = useState<Finding[]>([]);
  // Gemini photo / video reading (explicit clicks in Photos and Practice) adds what the media reveals.
  const [matchedPhotos, setMatchedPhotos] = useState<Finding[]>([]);
  const [photoFindings, setPhotoFindings] = useState<Finding[]>([]);
  const [videoFindings, setVideoFindings] = useState<Finding[]>([]);
  const findings = useMemo(() => {
    const extra = [...breachFindings, ...voiceFindings, ...photoFindings, ...videoFindings];
    if (!extra.length) return scan.findings;
    const ids = new Set(scan.findings.map((f) => f.id));
    return [...scan.findings, ...extra.filter((f) => !ids.has(f.id))];
  }, [scan.findings, breachFindings, voiceFindings, photoFindings, videoFindings]);

  const go = (t: ResultsTab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  const seeWhy = () => {
    unlock();
    go("map");
  };
  const name = masked ? subjectName.split(" ")[0] : subjectName;

  return (
    <div className="flex flex-1 flex-col pb-16 lg:pb-10">
      <ResultsNav tab={tab} unlocked={unlocked} onTab={go} onUnlock={seeWhy} />

      <Panel id="fixes" active={tab} keep={visited}>
        <div className="mx-auto w-full max-w-[96rem] xl:grid xl:grid-cols-[minmax(0,46rem)_minmax(0,1fr)] xl:gap-8 xl:px-6">
          <div className="mx-auto w-full max-w-3xl min-w-0 sm:px-6 xl:mx-0 xl:px-0">
            <h1 className="sr-only">Lock it down</h1>
            <RoomJoin findings={findings} />
            <FixListSlot findings={findings} chains={scan.chains} score={scan.score} masked={masked} onRemovedChange={s.setRemovedFindingIds} />
            <FamilyNudge findings={findings} onOpen={() => go("family")} />
            <Overview findings={findings} />
            <SeeWhy onClick={seeWhy} className={unlocked ? "xl:hidden" : undefined} />
          </div>
          {tab === "fixes" && (
            <aside aria-label="Your map as you fix" className="hidden pt-4 xl:block">
              <div className="sticky top-[4.75rem] h-[calc(100dvh-6rem)] min-h-[520px] overflow-hidden rounded-frame border border-edge bg-canvas">
                {unlocked ? (
                  <AttackMapSlot
                    findings={findings}
                    chains={scan.chains}
                    score={s.liveScore}
                    subjectName={name}
                    masked={masked}
                    removedFindingIds={s.removedFindingIds}
                    railDefault="closed"
                    compact
                  />
                ) : (
                  <LockedMap onOpen={unlock} />
                )}
              </div>
            </aside>
          )}
        </div>
      </Panel>

      {tab === "map" && (
        <section data-panel="map" aria-label="How they'd get in" className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col px-3 pt-3 sm:px-6">
          <div className="relative h-[calc(100dvh-10rem)] min-h-[460px] overflow-hidden rounded-card border border-edge">
            <AttackMapSlot findings={findings} chains={scan.chains} score={s.liveScore} subjectName={name} masked={masked} removedFindingIds={s.removedFindingIds} />
          </div>
        </section>
      )}

      <Panel id="practice" active={tab} keep={visited}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 pt-8 sm:px-8">
          <PracticeSlot findings={findings} masked={masked} />
          <div id="voicemail" className="scroll-mt-4 border-t border-edge pt-12 [&>section]:mx-0">
            <VoiceSlot findings={findings} subjectName={subjectName} masked={masked} />
          </div>
          <div id="voice-exposure" className="scroll-mt-4 border-t border-edge pt-12 [&>section]:mx-0">
            <VoiceExposureSlot findings={scan.findings} masked={masked} onDerived={setVoiceFindings} />
          </div>
          <div id="video-context" className="scroll-mt-4 border-t border-edge pt-12 empty:hidden">
            <VideoContextSlot findings={scan.findings} masked={masked} onFindings={setVideoFindings} />
          </div>
        </div>
      </Panel>

      <Panel id="quiz" active={tab} keep={visited}>
        <div className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-8">
          <QuizSlot findings={findings} masked={masked} />
          <AutoStartQuiz />
        </div>
      </Panel>

      <Panel id="photos" active={tab} keep={visited}>
        <div className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-8">
          {s.face === "skipped" && <WarnNote className="mb-6">Face match is off</WarnNote>}
          <PhotoMatchesSlot findings={findings} clearOnUnmount={false} onMatchedChange={setMatchedPhotos} />
          <PhotoContextSlot photos={matchedPhotos} masked={masked} onFindings={setPhotoFindings} className="mt-12 border-t border-edge pt-12" />
          <PhotoGrid findings={findings} />
        </div>
      </Panel>

      {tab === "places" && (
        <section data-panel="places" className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-8">
          <h1 className="sv-display mb-6 text-[clamp(2rem,4vw,2.75rem)] leading-[1]">Where you can be found</h1>
          <PlacesSlot findings={findings} masked={masked} />
        </section>
      )}

      <Panel id="breach" active={tab} keep={visited}>
        <div className="mx-auto w-full max-w-4xl px-4 pt-8 sm:px-8">
          <BreachCheck
            masked={masked}
            fixture={mock ? { status: "ok", result: FIXTURE_BREACHES } : undefined}
            email={mock ? "alex.rivera@example.com" : undefined}
            onResult={(r) => setBreachFindings(breachesToFindings(r))}
          />
        </div>
      </Panel>

      <Panel id="campus" active={tab} keep={visited}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pt-8 sm:px-8">
          <CampusScams findings={findings} masked={masked} />
          <AddToRoom score={s.liveScore?.score ?? scan.score?.score ?? 0} findings={findings} />
        </div>
      </Panel>

      <Panel id="family" active={tab} keep={visited}>
        <div className="mx-auto w-full max-w-4xl px-4 pt-8 sm:px-8">
          <h1 className="sv-display mb-6 text-[clamp(2rem,4vw,2.75rem)] leading-[1]">Family</h1>
          <FamilyCard findings={findings} />
        </div>
      </Panel>
    </div>
  );
}

function readRoomHash() {
  return /room=([A-Za-z0-9]{4,16})/.test(window.location.hash);
}
function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

/** Arrived from a room join link (/scan#room=SEED): offer to add your result to the room. */
function RoomJoin({ findings }: { findings: Finding[] }) {
  const { liveScore, scan } = useSession();
  const inRoom = useSyncExternalStore(subscribeHash, readRoomHash, () => false);
  if (!inRoom) return null;
  return (
    <div className="mx-4 mt-6 sm:mx-0">
      <AddToRoom score={liveScore?.score ?? scan.score?.score ?? 0} findings={findings} />
    </div>
  );
}

/** The family card needs the current score, the top fix and how many ways in are cut. */
function useFixSummary(findings: Finding[]) {
  const { scan, removedFindingIds } = useSession();
  return useMemo(() => {
    const anchor = scan.score?.score;
    const fixes = planFixes(findings, scan.chains, anchor);
    const r = computeExposure(findings, scan.chains, removedFindingIds, anchor);
    return {
      score: r.score,
      topFixTitle: fixes[0]?.title ?? "Lock down your public profiles",
      chainsBroken: r.brokenChainIds.length,
      chainsTotal: scan.chains.length,
    };
  }, [findings, scan.chains, scan.score, removedFindingIds]);
}

function FamilyCard({ findings }: { findings: Finding[] }) {
  const sum = useFixSummary(findings);
  return <FamilyShare {...sum} />;
}

/** After at least one fix is ticked, offer the family card inline. */
function FamilyNudge({ findings, onOpen }: { findings: Finding[]; onOpen: () => void }) {
  const { removedFindingIds } = useSession();
  const sum = useFixSummary(findings);
  const show = removedFindingIds.length > 0;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className="mx-4 mt-10 sm:mx-0"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
        >
          <Card className="sv-icon-host flex flex-wrap items-center gap-4">
            <Icon3D name="person" size={56} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-semibold">Send your family the card</p>
              <p className="text-muted">
                <span className="sv-num text-fg">{sum.score}</span> exposure · <span className="sv-num text-fg">{sum.chainsBroken}</span>/{sum.chainsTotal} cut
              </p>
            </div>
            <button type="button" onClick={onOpen} className="sv-press min-h-12 rounded-control border border-edge-strong px-5 font-semibold hover:border-fg">
              Make the card
            </button>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The quiz takes ~30s to write, so start it the moment its section first opens
 * (its own loading state shows meanwhile). Mounted once, so it never re-triggers.
 */
function AutoStartQuiz() {
  useEffect(() => {
    let tries = 0;
    const id = window.setInterval(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-panel="quiz"] section[aria-label="Spot the scam quiz"] button');
      if (btn || ++tries > 40) window.clearInterval(id);
      if (btn && !btn.disabled && /start/i.test(btn.textContent ?? "")) btn.click();
    }, 150);
    return () => window.clearInterval(id);
  }, []);
  return null;
}

/** When face match is off, still show which photos are public (blurred under presentation mode). */
function PhotoGrid({ findings }: { findings: Finding[] }) {
  const { face, masked } = useSession();
  const photos = findings.filter((f) => f.imageUrl);
  if (face !== "skipped" || !photos.length) return null;
  return (
    <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {photos.map((f) => (
        <li key={f.id} className="sv-card overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts */}
          <img src={f.imageUrl} alt="" referrerPolicy="no-referrer" className={`aspect-[4/3] w-full object-cover ${masked ? "blur-lg grayscale" : ""}`} />
          <p className="truncate px-3 py-2 text-sm text-muted">{f.label}</p>
        </li>
      ))}
    </ul>
  );
}

function Panel({ id, active, keep, children }: { id: ResultsTab; active: ResultsTab; keep: ReadonlySet<ResultsTab>; children: ReactNode }) {
  if (!keep.has(id) && active !== id) return null;
  return (
    <section data-panel={id} hidden={active !== id} aria-label={RESULT_TABS.find((t) => t.id === id)?.label}>
      {children}
    </section>
  );
}

function Overview({ findings }: { findings: Finding[] }) {
  const { scan, liveScore } = useSession();
  if (!findings.length) return null;
  return (
    <section aria-labelledby="overview-h" className="mx-4 mt-16 sm:mx-0">
      <RedactedRule />
      <h2 id="overview-h" className="sv-display mt-5 text-[clamp(1.8rem,3.6vw,2.4rem)]">
        Your file
      </h2>
      <div className="mt-6 grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
        <Card className="flex flex-col">
          <h3 className="text-sm font-medium text-muted">Risk by category</h3>
          <ExposureRadar findings={findings} className="mt-2" />
        </Card>
        <div className="grid gap-4">
          <Card>
            <h3 className="text-sm font-medium text-muted">Facts by risk</h3>
            <RiskHistogram findings={findings} className="mt-4" />
          </Card>
          <Card>
            <h3 className="text-sm font-medium text-muted">Facts by source</h3>
            <SourceBars findings={findings} className="mt-4" />
          </Card>
        </div>
      </div>
      {(liveScore || scan.score) && (
        <div className="mt-4">
          <ChangeWatch findings={findings} score={liveScore?.score ?? scan.score?.score ?? 0} />
        </div>
      )}
    </section>
  );
}

/** Side panel before the map is unlocked: the map stays behind a deliberate click. */
function LockedMap({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="relative isolate flex h-full flex-col items-center justify-center gap-6 overflow-hidden p-10 text-center">
      <DotField className="-z-10" gap={24} fade="radial" />
      <Icon3D name="lock" size={120} motion="float" />
      <h2 className="sv-display max-w-[14ch] text-[clamp(1.8rem,2.6vw,2.6rem)] leading-[1]">How would they get in?</h2>
      <button
        type="button"
        onClick={onOpen}
        className="sv-press inline-flex min-h-14 items-center rounded-control bg-accent px-7 text-lg font-semibold text-on-accent hover:opacity-90"
      >
        Show the map
      </button>
    </div>
  );
}

function SeeWhy({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <div className={cn("relative mx-4 mt-16 overflow-hidden rounded-frame bg-accent p-6 text-on-accent sm:mx-0 sm:p-10", className)}>
      <div aria-hidden className="absolute -right-4 -top-4 opacity-90 max-sm:hidden">
        <Icon3D name="target" size={160} motion="float" />
      </div>
      <h2 className="sv-display relative max-w-[16ch] text-[clamp(1.9rem,4vw,2.75rem)] leading-[1]">How would they get in?</h2>
      <button
        type="button"
        onClick={onClick}
        className="sv-press relative mt-8 inline-flex min-h-14 items-center rounded-control bg-[var(--on-accent)] px-7 text-lg font-semibold text-[var(--accent)] hover:opacity-90"
      >
        Show me
      </button>
    </div>
  );
}

function ResultsNav({ tab, unlocked, onTab, onUnlock }: { tab: ResultsTab; unlocked: boolean; onTab: (t: ResultsTab) => void; onUnlock: () => void }) {
  const primary = RESULT_TABS.filter((t) => !t.more);
  const more = RESULT_TABS.filter((t) => t.more);
  const inMore = more.find((t) => t.id === tab);
  const choose = (id: ResultsTab) => {
    const t = RESULT_TABS.find((x) => x.id === id);
    if (t?.gated && !unlocked) onUnlock();
    else onTab(id);
  };
  return (
    <nav aria-label="Results" className="sticky top-0 z-30 border-b border-edge bg-canvas/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[96rem] items-center gap-2 px-3 py-2 sm:px-6">
        <SegmentedTabs
          className="min-w-0 flex-1"
          label="Results"
          value={inMore ? ("__more" as ResultsTab) : tab}
          onChange={choose}
          items={primary.map((t) => {
            const locked = t.gated && !unlocked;
            return {
              id: t.id,
              hint: locked ? "locked until you choose to see how they would get in" : undefined,
              label: (
                <>
                  {locked && <LockIcon />}
                  <span className="lg:hidden">{t.short}</span>
                  <span className="max-lg:hidden">{t.label}</span>
                </>
              ),
            };
          })}
        />
        <MoreMenu items={more} active={inMore?.id} unlocked={unlocked} onPick={choose} />
      </div>
    </nav>
  );
}

function MoreMenu({
  items,
  active,
  unlocked,
  onPick,
}: {
  items: (typeof RESULT_TABS)[number][];
  active?: ResultsTab;
  unlocked: boolean;
  onPick: (id: ResultsTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const activeLabel = items.find((i) => i.id === active)?.label;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "sv-press inline-flex min-h-[3.25rem] items-center gap-2 rounded-full border px-4 font-semibold",
          active ? "border-fg bg-fg text-canvas" : "border-edge text-muted hover:text-fg",
        )}
      >
        {activeLabel ?? "More"}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={cn("transition-transform duration-200", open && "rotate-180")}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="menu"
            className="absolute right-0 top-full z-50 mt-2 w-60 origin-top-right rounded-card border border-edge bg-elevated p-1.5 shadow-pop"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            {items.map((t) => {
              const locked = t.gated && !unlocked;
              return (
                <li key={t.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onPick(t.id);
                    }}
                    className={cn("flex min-h-12 w-full items-center gap-2 rounded-control px-3 text-left font-medium hover:bg-surface", t.id === active ? "text-fg" : "text-muted")}
                  >
                    {locked && <LockIcon />}
                    {t.label}
                    {t.id === active && <span aria-hidden className="ml-auto size-1.5 rounded-full bg-fg" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="opacity-70">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" fill="currentColor" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
