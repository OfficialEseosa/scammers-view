"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ExposureScore, Finding } from "@/lib/types";
import { useScanStream, type ScanState } from "@/hooks/useScanStream";
import { excludeNotMe } from "@/state/notMe";
import { clearSession, loadSession, saveSession, type SavedSession } from "@/state/sessionPersist";
import { usePresentationMode } from "@/hooks/usePresentationMode";
import { clearFaceData } from "@/features/face";
import { clearVoiceData } from "@/lib/voice-exposure/store";
import { disposeVoiceEngine } from "@/lib/voice-exposure/client";
import { computeExposure } from "@/lib/fixes/score";
import { leave } from "@/app/actions";
import type { CallScenarioId } from "@/lib/call/schema";

/**
 * One store for the whole session: scan results, fixes the user ticked, face-match status
 * and where they are in the flow. A refresh restores the last scan in this tab
 * (sessionStorage, up to 8 hours). "End session" and closing the tab wipe it.
 * Face images and voice samples are never persisted.
 */

export type Stage = "face" | "live" | "results" | "ended";
export type FaceStatus = "pending" | "verified" | "skipped";
export type ResultsTab = "fixes" | "map" | "practice" | "call" | "check" | "quiz" | "photos" | "places" | "breach" | "campus" | "family";

/** `more`: listed under the "More" menu instead of the main tab row. */
export const RESULT_TABS: { id: ResultsTab; label: string; short: string; gated: boolean; more?: boolean }[] = [
  { id: "fixes", label: "Break the chain", short: "Fixes", gated: false },
  { id: "map", label: "How they'd get in", short: "Attack", gated: true },
  { id: "practice", label: "Practice attacks", short: "Practice", gated: true },
  { id: "call", label: "Practice call", short: "Call", gated: true },
  { id: "photos", label: "Photos of you", short: "Photos", gated: true },
  { id: "places", label: "Where you can be found", short: "Places", gated: true },
  { id: "check", label: "Is this a scam?", short: "Check", gated: false, more: true },
  { id: "quiz", label: "Test yourself", short: "Quiz", gated: true, more: true },
  { id: "breach", label: "Breaches", short: "Breaches", gated: false, more: true },
  { id: "campus", label: "Campus scams", short: "Campus", gated: true, more: true },
  { id: "family", label: "Family", short: "Family", gated: false, more: true },
];

const TAB_IDS = new Set(RESULT_TABS.map((t) => t.id));

type Scan = ReturnType<typeof useScanStream>;

export interface Session {
  mock: boolean;
  subjectName: string;
  /** Signed-in email for cleanup forms. Empty in the fictional demo. */
  subjectEmail: string;
  stage: Stage;
  setStage: (s: Stage) => void;
  face: FaceStatus;
  setFace: (f: FaceStatus) => void;
  /** The scan with everything marked "not me" already taken out (findings, chains, score). */
  scan: Scan;
  /** Findings the user said aren't them. Memory only, never sent anywhere, gone when the session ends. */
  notMe: Finding[];
  notMeIds: ReadonlySet<string>;
  markNotMe: (fs: Finding[]) => void;
  restoreNotMe: (ids: string[]) => void;
  /** The last "not me" batch, for the undo toast. */
  notMeUndo: { ids: string[]; at: number } | null;
  dismissNotMeUndo: () => void;
  /** Findings the user has fixed (from FixList); the attack map severs chains that need them. */
  removedFindingIds: string[];
  setRemovedFindingIds: (ids: string[]) => void;
  /** The server score, re-scored with fixes applied, for the map's centre node. */
  liveScore: ExposureScore | undefined;
  tab: ResultsTab;
  setTab: (t: ResultsTab) => void;
  /** "See why this matters" was pressed; the scary tabs are open. */
  unlocked: boolean;
  unlock: () => void;
  masked: boolean;
  setMasked: (m: boolean) => void;
  ending: boolean;
  endSession: () => void;
  /** Scenario picked from the scam checker, waiting for the call tab. */
  callScenario: CallScenarioId | null;
  /** Opens the practice call tab with this scenario (unlocking the gated tabs). */
  practiseCall: (s: CallScenarioId) => void;
}

/** Practice-call tickets live in server memory; ask for them to be dropped. */
function dropCallTickets() {
  void fetch("/api/call", { method: "DELETE", keepalive: true }).catch(() => {});
}

function toScanState(scan: NonNullable<SavedSession["scan"]>): ScanState {
  return {
    phase: scan.phase,
    message: scan.message,
    sources: scan.sources as ScanState["sources"],
    findings: scan.findings,
    score: scan.score,
    chains: scan.chains,
    error: scan.error,
  };
}

function bootStage(boot: SavedSession | null): Stage {
  if (!boot) return "face";
  // Finished scan → results. Mid-scan (or results without a snapshot) → live, stream restarts.
  if (boot.scan?.phase === "done") return "results";
  return "live";
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}

const EMPTY: string[] = [];
const NO_FINDINGS: Finding[] = [];

export function SessionProvider({ mock, subjectName, subjectEmail = "", children }: { mock: boolean; subjectName: string; subjectEmail?: string; children: ReactNode }) {
  // sessionStorage is client-only; wait one frame so SSR/hydration don't disagree.
  const [boot, setBoot] = useState<SavedSession | null | undefined>(undefined);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage can only be read after hydration
    setBoot(loadSession(mock, subjectEmail));
  }, [mock, subjectEmail]);

  if (boot === undefined) {
    return <div className="sv-skeleton min-h-[50vh] w-full" aria-label="Restoring session" />;
  }

  return (
    <SessionReady mock={mock} subjectName={subjectName} subjectEmail={subjectEmail} boot={boot}>
      {children}
    </SessionReady>
  );
}

function SessionReady({
  mock,
  subjectName,
  subjectEmail,
  boot,
  children,
}: {
  mock: boolean;
  subjectName: string;
  subjectEmail: string;
  boot: SavedSession | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(() => bootStage(boot));
  const [face, setFace] = useState<FaceStatus>(() => boot?.face ?? "pending");
  const [removed, setRemoved] = useState<string[]>(() => (boot?.removedFindingIds.length ? boot.removedFindingIds : EMPTY));
  const [tab, setTab] = useState<ResultsTab>(() => (boot && TAB_IDS.has(boot.tab as ResultsTab) ? (boot.tab as ResultsTab) : "fixes"));
  const [unlocked, setUnlocked] = useState(() => Boolean(boot?.unlocked));
  const [callScenario, setCallScenario] = useState<CallScenarioId | null>(null);
  const [masked, setMasked] = usePresentationMode();
  const [ending, startEnding] = useTransition();

  const [notMe, setNotMe] = useState<Finding[]>(() => (boot?.notMe.length ? boot.notMe : NO_FINDINGS));
  const [notMeUndo, setNotMeUndo] = useState<{ ids: string[]; at: number } | null>(null);

  const restoreScan = useMemo<ScanState | null>(
    () => (boot?.scan?.phase === "done" ? toScanState(boot.scan) : null),
    [boot],
  );
  // Only hand the snapshot to the stream hook while we're on results; leaving that stage must reset.
  const restoreActive = stage === "results" ? restoreScan : null;
  // Finished results: show them without opening a new (billable) stream. Mid-scan refresh restarts the stream.
  const stream = stage === "live" || (stage === "results" && !restoreScan);
  const raw = useScanStream(mock, stream, restoreActive);
  const notMeIds = useMemo<ReadonlySet<string>>(() => new Set(notMe.map((f) => f.id)), [notMe]);
  const kept = useMemo(() => excludeNotMe(raw.findings, raw.chains, raw.score, notMeIds), [raw.findings, raw.chains, raw.score, notMeIds]);
  const scan = useMemo<Scan>(() => ({ ...raw, ...kept }), [raw, kept]);

  const markNotMe = useCallback((fs: Finding[]) => {
    if (!fs.length) return;
    setNotMe((cur) => {
      const have = new Set(cur.map((f) => f.id));
      const add = fs.filter((f) => !have.has(f.id));
      return add.length ? [...cur, ...add] : cur;
    });
    setNotMeUndo({ ids: fs.map((f) => f.id), at: Date.now() });
  }, []);

  const restoreNotMe = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setNotMe((cur) => {
      const next = cur.filter((f) => !drop.has(f.id));
      return next.length === cur.length ? cur : next.length ? next : NO_FINDINGS;
    });
    setNotMeUndo((u) => (u && u.ids.some((id) => drop.has(id)) ? null : u));
  }, []);

  const dismissNotMeUndo = useCallback(() => setNotMeUndo(null), []);

  // Biometrics stay on this device only for the live page view; a refresh forgets them but keeps the scan.
  useEffect(() => {
    const wipeBio = () => {
      clearFaceData();
      clearVoiceData();
      disposeVoiceEngine();
      dropCallTickets();
    };
    window.addEventListener("pagehide", wipeBio);
    return () => {
      window.removeEventListener("pagehide", wipeBio);
      wipeBio();
    };
  }, []);

  // Keep the tab's work across refresh.
  useEffect(() => {
    if (stage !== "live" && stage !== "results") return;
    if (face !== "verified" && face !== "skipped") return;
    saveSession({
      mock,
      email: subjectEmail,
      stage,
      face,
      tab,
      unlocked,
      removedFindingIds: removed,
      notMe,
      scan:
        raw.phase === "done"
          ? {
              phase: raw.phase,
              message: raw.message,
              sources: raw.sources,
              findings: raw.findings,
              score: raw.score,
              chains: raw.chains,
              error: raw.error,
            }
          : null,
    });
  }, [mock, subjectEmail, stage, face, tab, unlocked, removed, notMe, raw.phase, raw.message, raw.sources, raw.findings, raw.score, raw.chains, raw.error]);

  const setRemovedFindingIds = useCallback((ids: string[]) => {
    setRemoved((cur) => (cur.join("|") === ids.join("|") ? cur : ids.length ? ids : EMPTY));
  }, []);

  const liveScore = useMemo<ExposureScore | undefined>(() => {
    if (!scan.score) return undefined;
    if (!removed.length) return scan.score;
    const r = computeExposure(scan.findings, scan.chains, removed, scan.score.score);
    return { ...scan.score, score: r.score };
  }, [scan.score, scan.findings, scan.chains, removed]);

  const endSession = useCallback(() => {
    clearSession();
    clearFaceData();
    clearVoiceData();
    disposeVoiceEngine();
    dropCallTickets();
    setRemoved(EMPTY);
    setNotMe(NO_FINDINGS);
    setNotMeUndo(null);
    setUnlocked(false);
    setCallScenario(null);
    setTab("fixes");
    setFace("pending");
    setStage("ended"); // closes the stream and wipes scan state
    startEnding(async () => {
      if (mock) router.replace("/");
      else await leave();
    });
  }, [mock, router]);

  const value = useMemo<Session>(
    () => ({
      mock,
      subjectName,
      subjectEmail,
      stage,
      setStage,
      face,
      setFace,
      scan,
      notMe,
      notMeIds,
      markNotMe,
      restoreNotMe,
      notMeUndo,
      dismissNotMeUndo,
      removedFindingIds: removed,
      setRemovedFindingIds,
      liveScore,
      tab,
      setTab,
      unlocked,
      unlock: () => setUnlocked(true),
      masked,
      setMasked,
      ending,
      endSession,
      callScenario,
      practiseCall: (sc: CallScenarioId) => {
        setCallScenario(sc);
        setUnlocked(true);
        setTab("call");
        window.scrollTo({ top: 0 });
      },
    }),
    [mock, subjectName, subjectEmail, stage, face, scan, notMe, notMeIds, markNotMe, restoreNotMe, notMeUndo, dismissNotMeUndo, removed, setRemovedFindingIds, liveScore, tab, unlocked, masked, setMasked, ending, endSession, callScenario],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
