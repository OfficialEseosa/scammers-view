/**
 * Cheap metadata pre-filter: is a public video's sound the poster's own voice
 * track, or borrowed audio (a named song, or another creator's sound used for
 * a lip-sync)? Pure, no I/O.
 *
 *  true      the platform says it is an original sound AND its author is the poster
 *  false     a named track, another creator's original sound, or muted audio
 *  undefined not enough metadata to tell (the in-browser voice match decides)
 */

export interface SoundMeta {
  /** TikTok musicMeta.musicName / Instagram musicInfo.song_name */
  title?: string | null;
  /** TikTok musicMeta.musicAuthor / Instagram musicInfo.artist_name */
  author?: string | null;
  /** TikTok musicMeta.musicOriginal / Instagram musicInfo.uses_original_audio */
  original?: boolean | null;
  /** Instagram musicInfo.should_mute_audio */
  muted?: boolean | null;
}

export interface Poster {
  handle: string;
  displayName?: string | null;
}

export interface SoundVerdict {
  soundOriginal: boolean | undefined;
  soundTitle: string;
}

/** "original sound", "Original audio", plus common localised forms the platforms emit. */
const ORIGINAL_TITLE = /^(original (sound|audio)|son original|sonido original|som original|suono originale|originalton|originalsound|オリジナル楽曲|原声|原聲)\b/i;

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

function sameAuthor(author: string | null | undefined, poster: Poster): boolean | undefined {
  const a = norm(author);
  if (!a) return undefined;
  const h = norm(poster.handle);
  const d = norm(poster.displayName);
  return a === h || (!!d && a === d);
}

export function isOriginalTitle(title: string | null | undefined): boolean {
  return ORIGINAL_TITLE.test((title ?? "").trim());
}

export function classifySound(meta: SoundMeta | null | undefined, poster: Poster): SoundVerdict {
  if (!meta) return { soundOriginal: undefined, soundTitle: "Unknown sound" };
  const title = (meta.title ?? "").trim();
  const author = (meta.author ?? "").trim();
  const label = [title || "Untitled sound", author].filter(Boolean).join(" · ").slice(0, 120);
  if (meta.muted) return { soundOriginal: false, soundTitle: "Muted audio" };

  const originalish = meta.original === true || isOriginalTitle(title);
  if (originalish) {
    const mine = sameAuthor(author, poster);
    // The sample data shows "original sound" with musicOriginal:false, so the title counts too;
    // what decides is WHOSE original sound it is.
    if (mine === true) return { soundOriginal: true, soundTitle: label };
    if (mine === false) return { soundOriginal: false, soundTitle: label };
    return { soundOriginal: undefined, soundTitle: label };
  }
  if (meta.original === false && title) return { soundOriginal: false, soundTitle: label };
  if (title) return { soundOriginal: false, soundTitle: label };
  return { soundOriginal: undefined, soundTitle: label };
}
