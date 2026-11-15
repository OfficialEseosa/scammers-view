import { z } from "zod";
import { AttackChain, ExposureScore, Finding } from "@/lib/types";

/*
 * Keeps the scan you're working on across a refresh, in this tab only (sessionStorage).
 * Cleared when you press End session, when the tab closes, or after 8 hours.
 * Never writes face images, voice samples or passwords.
 */

const TTL_MS = 8 * 60 * 60 * 1000;
const KEY = "sv-scan-session";

const SourceStatus = z.object({
  status: z.enum(["running", "done"]),
  count: z.number(),
  query: z.string().optional(),
});

const SavedScan = z.object({
  phase: z.enum(["connecting", "running", "done", "error"]),
  message: z.string(),
  sources: z.record(z.string(), SourceStatus).default({}),
  findings: z.array(Finding),
  score: ExposureScore.nullable(),
  chains: z.array(AttackChain),
  error: z.string().nullable(),
});

const Saved = z.object({
  v: z.literal(1),
  subjectKey: z.string(),
  mock: z.boolean(),
  savedAt: z.number(),
  stage: z.enum(["live", "results"]),
  face: z.enum(["verified", "skipped"]),
  tab: z.string(),
  unlocked: z.boolean(),
  removedFindingIds: z.array(z.string()),
  notMe: z.array(Finding),
  /** Full scan snapshot only when the run finished; otherwise a refresh restarts the stream. */
  scan: SavedScan.nullable(),
});

export type SavedSession = z.infer<typeof Saved>;
export type SavedScanState = z.infer<typeof SavedScan>;

export function subjectKey(mock: boolean, email: string): string {
  return mock ? "mock" : email.trim().toLowerCase() || "anon";
}

export function loadSession(mock: boolean, email: string, now = Date.now()): SavedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = Saved.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    const s = parsed.data;
    if (s.subjectKey !== subjectKey(mock, email) || s.mock !== mock || now - s.savedAt > TTL_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveSession(input: {
  mock: boolean;
  email: string;
  stage: "live" | "results" | "face" | "ended";
  face: "pending" | "verified" | "skipped";
  tab: string;
  unlocked: boolean;
  removedFindingIds: string[];
  notMe: Finding[];
  scan: SavedScanState | null;
}): void {
  if (typeof window === "undefined") return;
  if (input.stage !== "live" && input.stage !== "results") return;
  if (input.face !== "verified" && input.face !== "skipped") return;
  const payload: SavedSession = {
    v: 1,
    subjectKey: subjectKey(input.mock, input.email),
    mock: input.mock,
    savedAt: Date.now(),
    stage: input.stage,
    face: input.face,
    tab: input.tab,
    unlocked: input.unlocked,
    removedFindingIds: input.removedFindingIds,
    notMe: input.notMe,
    scan: input.scan?.phase === "done" ? input.scan : null,
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode: keep going without persistence */
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
