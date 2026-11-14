import { z } from "zod";

export const FindingCategory = z.enum([
  "school", "employer", "email", "phone", "location", "relative", "pet",
  "birthday", "handle", "photo", "schedule", "interest", "other", "video",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const SourceType = z.enum([
  "web", "github", "linkedin", "instagram", "x", "tiktok", "bluesky", "school",
  "broker", "personal_site", "news", "other",
]);
export type SourceType = z.infer<typeof SourceType>;

/** How we know a finding is about the signed-in person, not a namesake. */
export const IdentityAnchor = z.enum(["email", "github", "face", "school", "unconfirmed"]);
export type IdentityAnchor = z.infer<typeof IdentityAnchor>;

export const Finding = z.object({
  id: z.string(),
  category: FindingCategory,
  /** Short label, e.g. "Dog's name". */
  label: z.string(),
  value: z.string(),
  sourceType: SourceType,
  sourceUrl: z.string(),
  sourceTitle: z.string().optional(),
  snippet: z.string().optional(),
  imageUrl: z.string().optional(),
  /** Every place this fact was seen, when merged from several sources. */
  sources: z.array(z.object({ url: z.string(), title: z.string().optional(), sourceType: SourceType })).optional(),
  anchor: IdentityAnchor,
  confidence: z.number().min(0).max(1),
  /** How much this helps an attacker (0..10). */
  riskWeight: z.number().min(0).max(10),
  /** ISO timestamp. */
  foundAt: z.string(),
  /** Video findings: direct media URL (audio or video) on the platform's CDN. */
  mediaUrl: z.string().optional(),
  /** Video findings: length in seconds. */
  durationSec: z.number().min(0).optional(),
  /** Video findings: true when the sound is the poster's own original audio, false when borrowed (a named track or another creator's sound); absent when unknown. */
  soundOriginal: z.boolean().optional(),
  /** Video findings: the platform's sound label, e.g. "original sound · name" or a track title. */
  soundTitle: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const ChainStep = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  findingIds: z.array(z.string()),
  /** What this step unlocks. */
  enables: z.string().optional(),
});
export type ChainStep = z.infer<typeof ChainStep>;

export const AttackChain = z.object({
  id: z.string(),
  /** e.g. "School email account". */
  target: z.string(),
  steps: z.array(ChainStep),
  severity: z.number().min(0).max(10),
});
export type AttackChain = z.infer<typeof AttackChain>;

export const ExposureScore = z.object({
  score: z.number().min(0).max(100),
  topFindingIds: z.array(z.string()).max(3),
  summary: z.string(),
});
export type ExposureScore = z.infer<typeof ExposureScore>;

/** Events the server streams over SSE during a scan. */
export const ScanEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), message: z.string() }),
  z.object({ type: z.literal("source_started"), sourceType: SourceType, query: z.string().optional(), agentId: z.string().optional(), agentLabel: z.string().optional() }),
  z.object({ type: z.literal("source_done"), sourceType: SourceType, count: z.number(), agentId: z.string().optional() }),
  z.object({ type: z.literal("finding"), finding: Finding }),
  z.object({ type: z.literal("score"), score: ExposureScore }),
  z.object({ type: z.literal("chain"), chain: AttackChain }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ScanEvent = z.infer<typeof ScanEvent>;

/** The signed-in person; the only identity a scan may ever target. */
export const ScanSubject = z.object({
  name: z.string(),
  email: z.string(),
  githubLogin: z.string().optional(),
  school: z.string().optional(),
});
export type ScanSubject = z.infer<typeof ScanSubject>;
