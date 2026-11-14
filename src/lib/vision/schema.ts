import { z } from "zod";
import { Finding, IdentityAnchor } from "@/lib/types";

/**
 * Contracts for Gemini photo and video reading. Client-safe (no node imports).
 *
 * `PhotoReadout` / `VideoReadout` are the structured-output schemas the model
 * must fill (sent as JSON Schema, then re-validated here). They are kept flat
 * and small: Gemini's structured output ignores minLength/maxLength, so string
 * lengths are clamped in code (see clean.ts), and `maxItems` caps list size.
 */

export const FACT_KINDS = [
  "place", "landmark", "school", "employer", "event", "text", "pet", "vehicle",
  "routine", "birthday", "relative", "name", "other",
] as const;
export const FactKind = z.enum(FACT_KINDS);
export type FactKind = z.infer<typeof FactKind>;

/** [ymin, xmin, ymax, xmax], each 0..1000 (Gemini's documented box_2d convention); [] when not localisable. */
export const Box2d = z
  .array(z.number().int().min(0).max(1000))
  .max(4)
  .describe("[ymin, xmin, ymax, xmax] normalised to 0-1000 around the visual evidence (never a face); [] if not one clear region");

const BaseFact = z.object({
  kind: FactKind,
  label: z.string().describe("2 to 5 words, e.g. 'School logo on hoodie'"),
  value: z.string().describe("The fact itself, under 80 characters"),
  evidence: z.string().describe("What in the media shows it, one short sentence"),
  fromVisibleText: z.boolean().describe("true only if read from printed or written words, or spoken aloud"),
  risk: z.number().int().min(0).max(10).describe("How much this helps a scammer"),
  confidence: z.number().min(0).max(1),
});

export const PhotoFact = BaseFact.extend({ box: Box2d });
export type PhotoFact = z.infer<typeof PhotoFact>;

export const PhotoReadout = z.object({
  facts: z.array(PhotoFact).max(10),
  /** Other people visible besides the user: a count and a relationship guess only, never who they are. */
  otherPeople: z.object({
    count: z.number().int().min(0).max(50),
    relationshipGuess: z.string().nullable().describe("e.g. 'teammates' or 'family'; never a name"),
  }),
  scammerLearns: z.string().describe("One line to the owner, under 140 characters"),
});
export type PhotoReadout = z.infer<typeof PhotoReadout>;

export const VideoChannel = z.enum(["speech", "screen", "scene"]);
export type VideoChannel = z.infer<typeof VideoChannel>;

export const VideoFact = BaseFact.extend({
  /** speech = said out loud; screen = on-screen text or captions; scene = what the picture shows. */
  channel: VideoChannel,
  at: z.string().nullable().describe("MM:SS where it happens"),
});
export type VideoFact = z.infer<typeof VideoFact>;

export const VideoReadout = z.object({
  hasSpeech: z.boolean(),
  facts: z.array(VideoFact).max(14),
  scammerLearns: z.string().describe("One line to the owner, under 140 characters: what a scammer learns from this video"),
});
export type VideoReadout = z.infer<typeof VideoReadout>;

/* ---------- HTTP contract ---------- */

export const PhotoRequest = z.object({
  findingId: z.string().min(1).max(200),
  imageUrl: z.string().min(1).max(4096),
  /** The page the photo was found on (becomes the findings' sourceUrl). */
  sourceUrl: z.string().max(4096).optional(),
});
export type PhotoRequest = z.infer<typeof PhotoRequest>;

export const VideoRequest = z.object({
  findingId: z.string().min(1).max(200),
  mediaUrl: z.string().min(1).max(4096),
  sourceUrl: z.string().max(4096).optional(),
  durationSec: z.number().min(0).max(36_000).optional(),
  anchor: IdentityAnchor.optional(),
});
export type VideoRequest = z.infer<typeof VideoRequest>;

export const VisionUsage = z.object({
  model: z.string(),
  ms: z.number(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  /** Estimated from the token counts and the model's list price; undefined when unknown. */
  costUsd: z.number().optional(),
});
export type VisionUsage = z.infer<typeof VisionUsage>;

export const PhotoResponse = z.object({
  findingId: z.string(),
  readout: PhotoReadout,
  findings: z.array(Finding),
  usage: VisionUsage.optional(),
});
export type PhotoResponse = z.infer<typeof PhotoResponse>;

export const VideoResponse = z.object({
  findingId: z.string(),
  readout: VideoReadout,
  findings: z.array(Finding),
  /** Seconds actually analysed (clips are capped). */
  analysedSec: z.number().optional(),
  usage: VisionUsage.optional(),
});
export type VideoResponse = z.infer<typeof VideoResponse>;

export const SkipResponse = z.object({ findingId: z.string(), skipped: z.string() });
export type SkipResponse = z.infer<typeof SkipResponse>;
