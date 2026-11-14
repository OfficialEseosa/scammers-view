import { z } from "zod";
import { Finding } from "../types";

/** Client-safe contract for the Practice Call feature. */

export const CALL_SCENARIOS = ["fake-recruiter", "professor-gift-cards", "family-voice-clone"] as const;
export const CallScenarioId = z.enum(CALL_SCENARIOS);
export type CallScenarioId = z.infer<typeof CallScenarioId>;

/** Closest practice call for a scam pattern found by the checker. */
export const PRACTICE_FOR_PATTERN: Partial<Record<string, CallScenarioId>> = {
  "fake-recruiter": "fake-recruiter",
  "fake-job-check": "fake-recruiter",
  "professor-gift-cards": "professor-gift-cards",
  "family-voice-clone": "family-voice-clone",
};

export const CallMode = z.enum(["simulated", "live"]);
export type CallMode = z.infer<typeof CallMode>;

/** Up to ~45 s of compressed speech; only used to clone the voice for the family scenario on a live call. */
export const MAX_VOICE_SAMPLE_BASE64 = 2_000_000;

/** Request body. Deliberately has no recipient field: the call only ever happens in the user's own browser. */
export const CallStartRequest = z
  .object({
    findings: z.array(Finding).max(200),
    scenario: CallScenarioId,
    mode: CallMode,
    voiceSample: z
      .object({ base64: z.string().max(MAX_VOICE_SAMPLE_BASE64), type: z.string().max(60) })
      .strict()
      .optional(),
  })
  .strict();
export type CallStartRequest = z.infer<typeof CallStartRequest>;

export const CallTurnRequest = z
  .object({
    utterance: z.string().max(600),
    hangup: z.boolean().optional(),
  })
  .strict();
export type CallTurnRequest = z.infer<typeof CallTurnRequest>;

export const Speaker = z.enum(["scammer", "you"]);
export const TranscriptLine = z.object({ speaker: Speaker, text: z.string() });
export type TranscriptLine = z.infer<typeof TranscriptLine>;

export const CheckId = z.enum(["verified", "secret", "refused", "callback", "hungUp", "noInfo"]);
export type CheckId = z.infer<typeof CheckId>;

export const ScoreCheck = z.object({
  id: CheckId,
  label: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type ScoreCheck = z.infer<typeof ScoreCheck>;

export const Scorecard = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum(["safe", "close", "caught"]),
  checks: z.array(ScoreCheck),
  /** Findings the scammer used, so the UI can rank the fixes that would have weakened this call. */
  usedFindingIds: z.array(z.string()),
  source: z.enum(["rules", "model"]),
});
export type Scorecard = z.infer<typeof Scorecard>;

export const CallStatus = z.enum(["waiting", "live", "ended"]);
export type CallStatus = z.infer<typeof CallStatus>;

/** What the browser sees about its own call. */
export interface CallView {
  id: string;
  mode: CallMode;
  scenario: CallScenarioId;
  status: CallStatus;
  transcript: TranscriptLine[];
  scorecard?: Scorecard;
  expiresAt: number;
}

/** How the browser joins its live call's LiveKit room. Only returned when the call is created. */
export interface LiveJoin {
  url: string;
  token: string;
}
