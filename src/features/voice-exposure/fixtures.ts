import type { Finding } from "@/lib/types";

/**
 * Lab fixtures: short public-domain clips in /public/fixtures/voice (mono AAC, ~100 KB each).
 *  Speaker A: LibriVox "The Wonderful Wizard of Oz" (solo), read by Phil Chenevert. Public domain (archive.org: wizardofoz_pc_librivox).
 *  Speaker B: LibriVox "Armageddon 2419 A.D." (solo), read by Alan Winterrowd. Public domain (armag2419_aw_1304_librivox).
 *  Speaker C: LibriVox "The Invisible Man" (solo), read by Cathy Barratt. Public domain (invisibleman_1209_librivox_cb).
 *  Music:     Musopen, Chopin Ballade No. 1 Op. 23 (piano). CC0 (archive.org: musopen-chopin).
 * The readers stand in for "you" and "other people" only; no real user data.
 */

export type FixtureRole = "reference" | "same" | "other" | "music";

export interface FixtureClip {
  id: string;
  file: string;
  speaker: "A" | "B" | "C" | "-";
  role: FixtureRole;
  label: string;
}

export const FIXTURE_CLIPS: FixtureClip[] = [
  { id: "a-ref", file: "/fixtures/voice/a-reference.m4a", speaker: "A", role: "reference", label: "Speaker A, 30 s (reference)" },
  { id: "a-same-1", file: "/fixtures/voice/a-same-1.m4a", speaker: "A", role: "same", label: "Speaker A, other chapter" },
  { id: "a-same-2", file: "/fixtures/voice/a-same-2.m4a", speaker: "A", role: "same", label: "Speaker A, later in chapter" },
  { id: "b-1", file: "/fixtures/voice/b-other-male-1.m4a", speaker: "B", role: "other", label: "Speaker B (male)" },
  { id: "b-2", file: "/fixtures/voice/b-other-male-2.m4a", speaker: "B", role: "other", label: "Speaker B, other chapter" },
  { id: "c-1", file: "/fixtures/voice/c-other-female-1.m4a", speaker: "C", role: "other", label: "Speaker C (female)" },
  { id: "c-2", file: "/fixtures/voice/c-other-female-2.m4a", speaker: "C", role: "other", label: "Speaker C, later" },
  { id: "music", file: "/fixtures/voice/m-music-only.m4a", speaker: "-", role: "music", label: "Piano, no speech" },
];

export const FIXTURE_REFERENCE = FIXTURE_CLIPS[0];

const now = "2026-01-01T00:00:00.000Z";
const base = { anchor: "email", confidence: 0.9, foundAt: now } as const;

/** Fictional "public videos" for the UI demo: one per clip, plus metadata-only borrowed audio. */
export const FIXTURE_VIDEO_FINDINGS: Finding[] = [
  { ...base, id: "v1", category: "video", label: "Public tiktok video", value: "Video: story time from the bus", sourceType: "tiktok", sourceUrl: "https://example.com/@ava.example/video/1", mediaUrl: "/fixtures/voice/a-same-1.m4a", durationSec: 20, soundOriginal: true, soundTitle: "original sound · ava.example", riskWeight: 4 },
  { ...base, id: "v2", category: "video", label: "Public tiktok video", value: "Video: duet with a friend", sourceType: "tiktok", sourceUrl: "https://example.com/@ava.example/video/2", mediaUrl: "/fixtures/voice/b-other-male-1.m4a", durationSec: 20, soundOriginal: undefined, soundTitle: "original sound", riskWeight: 3 },
  { ...base, id: "v3", category: "video", label: "Public instagram video", value: "Video: weekend recap", sourceType: "instagram", sourceUrl: "https://example.com/ava.example/reel/3", mediaUrl: "/fixtures/voice/a-same-2.m4a", durationSec: 15, soundOriginal: true, soundTitle: "Original audio · ava.example", riskWeight: 4 },
  { ...base, id: "v4", category: "video", label: "Public instagram video", value: "Video: piano practice", sourceType: "instagram", sourceUrl: "https://example.com/ava.example/reel/4", mediaUrl: "/fixtures/voice/m-music-only.m4a", durationSec: 20, soundOriginal: true, soundTitle: "Original audio · ava.example", riskWeight: 4 },
  { ...base, id: "v5", category: "video", label: "Public tiktok video", value: "Video: lip-sync to a trending clip", sourceType: "tiktok", sourceUrl: "https://example.com/@ava.example/video/5", mediaUrl: "/fixtures/voice/c-other-female-1.m4a", durationSec: 20, soundOriginal: false, soundTitle: "original sound · another.creator", riskWeight: 1 },
  { ...base, id: "v6", category: "video", label: "Public tiktok video", value: "Video: dance trend", sourceType: "tiktok", sourceUrl: "https://example.com/@ava.example/video/6", mediaUrl: "/fixtures/voice/m-music-only.m4a", durationSec: 20, soundOriginal: false, soundTitle: "Example Song · Example Band", riskWeight: 1 },
];
