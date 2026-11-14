import { classifySound } from "@/lib/voice-exposure/sound";

/**
 * Public videos on the subject's OWN anchored TikTok / Instagram account, for
 * the voice-exposure check. Pure: maps actor output items to video records.
 *
 * Fields (Apify docs, current output schemas):
 *  - clockworks~tiktok-profile-scraper item: webVideoUrl, text, createTimeISO,
 *    authorMeta{name,nickName}, videoMeta{duration,coverUrl,downloadAddr},
 *    musicMeta{musicName,musicAuthor,musicOriginal,playUrl}, mediaUrls[]
 *  - apify~instagram-reel-scraper item: url, type, caption, timestamp,
 *    ownerUsername, displayUrl, videoUrl, videoDuration,
 *    musicInfo{artist_name,song_name,uses_original_audio,should_mute_audio}
 */

export const MAX_VIDEOS = 15;

export interface VideoItem {
  postUrl: string;
  mediaUrl: string;
  durationSec?: number;
  caption: string;
  cover?: string;
  date?: string;
  soundOriginal: boolean | undefined;
  soundTitle: string;
}

const httpsUrl = (u: unknown): string | undefined => (typeof u === "string" && /^https:\/\//i.test(u) ? u : undefined);
const num = (n: unknown): number | undefined => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : undefined);
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/* eslint-disable @typescript-eslint/no-explicit-any -- actor outputs are untyped JSON */
export function tiktokVideos(handle: string, items: any[]): VideoItem[] {
  const out: VideoItem[] = [];
  for (const v of items) {
    if (!v || !v.authorMeta || v.isSlideshow) continue;
    // Self-only: the video must be posted by the anchored account itself.
    if (!same(v.authorMeta.name, handle)) continue;
    const postUrl = httpsUrl(v.webVideoUrl);
    if (!postUrl) continue;
    const sound = classifySound(
      v.musicMeta ? { title: v.musicMeta.musicName, author: v.musicMeta.musicAuthor, original: v.musicMeta.musicOriginal } : null,
      { handle, displayName: v.authorMeta.nickName },
    );
    // For the poster's own original sound the sound file IS this video's audio track (audio only, smaller).
    const mediaUrl =
      (sound.soundOriginal !== false ? httpsUrl(v.musicMeta?.playUrl) : undefined) ??
      httpsUrl(Array.isArray(v.mediaUrls) ? v.mediaUrls[0] : undefined) ??
      httpsUrl(v.videoMeta?.downloadAddr) ??
      httpsUrl(v.musicMeta?.playUrl);
    if (!mediaUrl) continue;
    out.push({
      postUrl,
      mediaUrl,
      durationSec: num(v.videoMeta?.duration),
      caption: String(v.text ?? "").slice(0, 300),
      cover: httpsUrl(v.videoMeta?.coverUrl) ?? httpsUrl(v.videoMeta?.originalCoverUrl),
      date: typeof v.createTimeISO === "string" ? v.createTimeISO : undefined,
      ...sound,
    });
    if (out.length >= MAX_VIDEOS) break;
  }
  return out;
}

export function instagramVideos(handle: string, items: any[]): VideoItem[] {
  const out: VideoItem[] = [];
  for (const v of items) {
    if (!v || v.error) continue;
    if (v.type && v.type !== "Video") continue;
    if (!same(v.ownerUsername, handle)) continue;
    const postUrl = httpsUrl(v.url) ?? (typeof v.shortCode === "string" ? `https://www.instagram.com/p/${v.shortCode}/` : undefined);
    const mediaUrl = httpsUrl(v.videoUrl);
    if (!postUrl || !mediaUrl) continue;
    const m = v.musicInfo;
    const sound = classifySound(
      m ? { title: m.song_name, author: m.artist_name, original: m.uses_original_audio, muted: m.should_mute_audio } : null,
      { handle, displayName: v.ownerFullName },
    );
    out.push({
      postUrl,
      mediaUrl,
      durationSec: num(v.videoDuration),
      caption: String(v.caption ?? "").slice(0, 300),
      cover: httpsUrl(v.displayUrl),
      date: typeof v.timestamp === "string" ? v.timestamp : undefined,
      ...sound,
    });
    if (out.length >= MAX_VIDEOS) break;
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Attacker value of one public video: your own voice is what a cloner wants. */
export function videoRisk(v: Pick<VideoItem, "soundOriginal">): number {
  return v.soundOriginal === true ? 4 : v.soundOriginal === undefined ? 3 : 1;
}
