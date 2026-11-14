"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ExposureScore } from "@/lib/types";
import { useScanStream } from "@/hooks/useScanStream";
import { usePresentationMode } from "@/hooks/usePresentationMode";
import { clearFaceData } from "@/features/face";
import { clearVoiceData } from "@/lib/voice-exposure/store";
import { disposeVoiceEngine } from "@/lib/voice-exposure/client";
import { computeExposure } from "@/lib/fixes/score";
import { leave } from "@/app/actions";

/**
 * One in-memory store for the whole session: scan results, fixes the user ticked,
 * face-match status and where they are in the flow. Nothing here touches
 * localStorage; a reload, leaving /scan or "End session" wipes all of it.
 */

export type Stage = "face" | "live" | "results" | "ended";
export type FaceStatus = "pending" | "verified" | "skipped";
export type ResultsTab = "fixes" | "map" | "practice" | "quiz" | "photos" | "places" | "breach" | "campus" | "family";

/** `more`: listed under the "More" menu instead of the main tab row. */
export const RESULT_TABS: { id: ResultsTab; label: string; short: string; gated: boolean; more?: boolean }[] = [
  { id: "fixes", label: "Break the chain", short: "Fixes", gated: false },
  { id: "map", label: "How they'd get in", short: "Attack", gated: true },
  { id: "practice", label: "Practice attacks", short: "Practice", gated: true },
  { id: "photos", label: "Photos of you", short: "Photos", gated: true },
  { id: "places", label: "Where you can be found", short: "Places", gated: true },
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
  scan: Scan;
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
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}

const EMPTY: string[] = [];

export function SessionProvider({ mock, subjectName, children }: { mock: boolean; subjectName: string; children: ReactNode }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("face");
  const [face, setFace] = useState<FaceStatus>("pending");
  const [removed, setRemoved] = useState<string[]>(EMPTY);
  const [tab, setTab] = useState<ResultsTab>("fixes");
  const [unlocked, setUnlocked] = useState(false);
  const [masked, setMasked] = usePresentationMode();
  const [ending, startEnding] = useTransition();

  const scan = useScanStream(mock, stage === "live" || stage === "results");

  // Face data lives in a module store; make sure it never outlives this screen.
  useEffect(() => {
    const wipe = () => {
      clearFaceData();
      clearVoiceData();
      disposeVoiceEngine();
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
    clearFaceData();
    clearVoiceData();
    disposeVoiceEngine();
    setRemoved(EMPTY);
    setUnlocked(false);
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
    }),
    [mock, subjectName, stage, face, scan, removed, setRemovedFindingIds, liveScore, tab, unlocked, masked, setMasked, ending, endSession],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
