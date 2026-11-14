/**
 * Caps for what we send to Gemini. Numbers chosen against the current docs
 * (aistudio.google.com/docs/video-understanding, /docs/files, /docs/pricing):
 *  - video: Files API upload (2 GB per file, deleted by us right after the
 *    call; Google would otherwise keep it 48 h). We cap far lower to bound
 *    server memory and cost: 40 MB, videos longer than 10 min skipped, and
 *    only the first 120 s analysed (static processing end_offset) at "low"
 *    media resolution (~66 tokens/frame at 1 fps + 32 tokens/s audio).
 *  - per signed-in person, in memory: photos and videos per rolling hour.
 */

export const VIDEO_MAX_BYTES = 40 * 1024 * 1024;
export const VIDEO_MAX_DURATION_SEC = 600;
export const VIDEO_ANALYSE_SEC = 120;
/** Client-side cap per scan ("Analyse all" stops here). */
export const VIDEOS_PER_SCAN = 5;
export const PHOTOS_PER_SCAN = 24;

const WINDOW_MS = 60 * 60 * 1000;
const PER_HOUR = { photo: 40, video: 8 } as const;

const hits = new Map<string, number[]>();

/** Records one use; returns false (and records nothing) when the person is over the hourly cap. */
export function takeQuota(kind: keyof typeof PER_HOUR, who: string, now = Date.now()): boolean {
  const key = `${kind}:${who.toLowerCase()}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_HOUR[kind]) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function __resetQuotaForTests() {
  hits.clear();
}
