"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ExposureScore, Finding } from "@/lib/types";
import { useScanStream } from "@/hooks/useScanStream";
import { clearScanCache } from "@/hooks/scanCache";
import { excludeNotMe } from "@/state/notMe";
import { usePresentationMode } from "@/hooks/usePresentationMode";
import { clearFaceData } from "@/features/face";
import { clearVoiceData } from "@/lib/voice-exposure/store";
import { disposeVoiceEngine } from "@/lib/voice-exposure/client";
import { computeExposure } from "@/lib/fixes/score";
import { leave } from "@/app/actions";
import type { CallScenarioId } from "@/lib/call/schema";

/**
 * One in-memory store for the whole session: scan results, fixes the user ticked,
 * face-match status and where they are in the flow. Nothing here touches
 * localStorage; a reload, leaving /scan or "End session" wipes all of it.
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

type Scan = ReturnType<typeof useScanStream>;

export interface Session {
  mock: boolean;
  subjectName: string;
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

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}

const EMPTY: string[] = [];
const NO_FINDINGS: Finding[] = [];

export function SessionProvider({ mock, subjectName, children }: { mock: boolean; subjectName: string; children: ReactNode }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("face");
  const [face, setFace] = useState<FaceStatus>("pending");
  const [removed, setRemoved] = useState<string[]>(EMPTY);
  const [tab, setTab] = useState<ResultsTab>("fixes");
  const [unlocked, setUnlocked] = useState(false);
  const [callScenario, setCallScenario] = useState<CallScenarioId | null>(null);
  const [masked, setMasked] = usePresentationMode();
  const [ending, startEnding] = useTransition();

  const [notMe, setNotMe] = useState<Finding[]>(NO_FINDINGS);
  const [notMeUndo, setNotMeUndo] = useState<{ ids: string[]; at: number } | null>(null);

  const raw = useScanStream(mock, stage === "live" || stage === "results", subjectName);
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

  // Face data lives in a module store; make sure it never outlives this screen.
  useEffect(() => {
    const wipe = () => {
      clearFaceData();
      clearVoiceData();
      disposeVoiceEngine();
      dropCallTickets();
    };
    window.addEventListener("pagehide", wipe);
    return () => {
      window.removeEventListener("pagehide", wipe);
      wipe();
    };
  }, []);

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
    clearScanCache();
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
    [mock, subjectName, stage, face, scan, notMe, notMeIds, markNotMe, restoreNotMe, notMeUndo, dismissNotMeUndo, removed, setRemovedFindingIds, liveScore, tab, unlocked, masked, setMasked, ending, endSession, callScenario],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
