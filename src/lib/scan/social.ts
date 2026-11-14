import type { Finding, SourceType } from "@/lib/types";
import type { Emit, FindingCollector, RawFinding } from "./findings";
import type { PageData } from "./pageFetch";
import type { PageReader } from "./pageReader";
import { instagramVideos, MAX_VIDEOS, tiktokVideos, videoRisk, type VideoItem } from "./videos";

/**
 * Social profiles via Apify actors that read PUBLIC profiles without any
 * login/cookies. Self-only guarantee (enforced here in code): a platform is
 * scraped only for a handle that this scan already tied to the subject with a
 * real anchor (email / github / school) and confidence >= 0.7. Never a handle
 * from the request, never one guessed from the name, never a relative's.
 *
 * Actors (Apify Store, checked against their current input schemas):
 *  - Instagram: apify~instagram-profile-scraper  input {usernames}        -> profile item with latestPosts (<=12)
 *  - TikTok:    clockworks~tiktok-profile-scraper input {profiles, ...}    -> video items with authorMeta
 *  - X:         nick.cheng~x-profile-data         input {twitterHandles}  -> profile item (no tweets)
 *  - Instagram reels (voice exposure): apify~instagram-reel-scraper input {username, resultsLimit}
 *    -> reel items with videoUrl, videoDuration, musicInfo (the profile scraper's latestPosts has no audio info)
 * TikTok video items already carry musicMeta + videoMeta, so no extra run is needed there.
 * LinkedIn is skipped: no official no-cookie public-profile actor.
 * Endpoint: POST https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items
 */

const APIFY = "https://api.apify.com/v2/acts";
const MIN_CONFIDENCE = 0.7;
const ANCHORED = new Set(["email", "github", "school"]);
const MAX_POST_PHOTOS = 12;
const MAX_POSTS = 20;
const ACTOR_TIMEOUT_S = 60;

type Platform = "instagram" | "tiktok" | "x" | "bluesky";

interface PlatformSpec {
  platform: Platform;
  sourceType: SourceType;
  label: string;
  actor: string;
  /** Max USD for this actor run (Apify maxTotalChargeUsd). */
  maxUsd: number;
  input: (handle: string) => Record<string, unknown>;
}

const SPECS: PlatformSpec[] = [
  { platform: "instagram", sourceType: "instagram", label: "Instagram profile (public data)", actor: "apify~instagram-profile-scraper", maxUsd: 0.05, input: (h) => ({ usernames: [h], includeAboutSection: false }) },
  { platform: "tiktok", sourceType: "tiktok", label: "TikTok profile (public data)", actor: "clockworks~tiktok-profile-scraper", maxUsd: 0.15, input: (h) => ({ profiles: [h], profileScrapeSections: ["videos"], profileSorting: "latest", resultsPerPage: MAX_POSTS, excludePinnedPosts: false, shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSlideshowImages: false, shouldDownloadAvatars: false }) },
  { platform: "x", sourceType: "x", label: "X profile (public data)", actor: "nick.cheng~x-profile-data", maxUsd: 0.02, input: (h) => ({ twitterHandles: [h], maxItems: 1 }) },
];

/** Second Instagram run: the subject's own reels, for the voice-exposure check. */
const IG_REELS: PlatformSpec = { platform: "instagram", sourceType: "instagram", label: "Instagram reels (public data)", actor: "apify~instagram-reel-scraper", maxUsd: 0.05, input: (h) => ({ username: [h], resultsLimit: MAX_VIDEOS, skipPinnedPosts: false, skipTrialReels: true, includeSharesCount: false, includeTranscript: false, includeDownloadedVideo: false }) };

/** Bluesky needs no Apify: its public AppView API (public.api.bsky.app) is unauthenticated. */
const BLUESKY: PlatformSpec = { platform: "bluesky", sourceType: "other", label: "Bluesky profile (public API)", actor: "", maxUsd: 0, input: () => ({}) };

const HANDLE_RE = /^[A-Za-z0-9._]{2,30}$/;
const DOMAIN_HANDLE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const URL_PATTERNS: Record<Platform, RegExp> = {
  instagram: /instagram\.com\/([A-Za-z0-9._]{2,30})(?:[/?#]|$)/i,
  tiktok: /tiktok\.com\/@([A-Za-z0-9._]{2,30})(?:[/?#]|$)/i,
  x: /(?:x|twitter)\.com\/([A-Za-z0-9_]{2,15})(?:[/?#]|$)/i,
  bluesky: /bsky\.app\/profile\/([A-Za-z0-9.-]{3,253})(?:[/?#]|$)/i,
};
const LABEL_PATTERNS: Record<Platform, RegExp> = {
  instagram: /instagram/i,
  tiktok: /tiktok/i,
  x: /\b(x|twitter)\b/i,
  bluesky: /bluesky|bsky/i,
};
const handleOk = (p: Platform, v: string) => (p === "bluesky" ? DOMAIN_HANDLE_RE.test(v) : HANDLE_RE.test(v));
const RESERVED = new Set(["p", "reel", "reels", "explore", "accounts", "stories", "home", "search", "share", "intent", "i", "login", "signup", "about", "help", "privacy", "tag", "discover", "music", "video"]);

/** Self-only gate: the single best anchored handle per platform, or none. */
export function eligibleHandles(findings: Finding[]): Partial<Record<Platform, { handle: string; finding: Finding }>> {
  const out: Partial<Record<Platform, { handle: string; finding: Finding }>> = {};
  for (const f of findings) {
    if (f.category === "relative") continue;
    if (!ANCHORED.has(f.anchor) || f.confidence < MIN_CONFIDENCE) continue;
    for (const p of Object.keys(URL_PATTERNS) as Platform[]) {
      let handle: string | undefined;
      const fromValue = f.value.match(URL_PATTERNS[p])?.[1];
      if (fromValue) handle = fromValue;
      else if (f.category === "handle" && LABEL_PATTERNS[p].test(f.label)) {
        const v = f.value.trim().replace(/^@/, "");
        if (handleOk(p, v)) handle = v;
      } else if (f.category === "handle" && f.sourceType === p) {
        const v = f.value.trim().replace(/^@/, "");
        if (handleOk(p, v)) handle = v;
      }
      if (!handle || RESERVED.has(handle.toLowerCase())) continue;
      const cur = out[p];
      if (!cur || f.confidence > cur.finding.confidence) out[p] = { handle, finding: f };
    }
  }
  return out;
}

async function runActor(spec: PlatformSpec, handle: string, token: string, signal: AbortSignal): Promise<unknown[]> {
  const qs = new URLSearchParams({ timeout: String(ACTOR_TIMEOUT_S), maxTotalChargeUsd: String(spec.maxUsd), maxItems: String(MAX_POSTS), clean: "true" });
  const res = await fetch(`${APIFY}/${spec.actor}/run-sync-get-dataset-items?${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(spec.input(handle)),
    signal: AbortSignal.any([signal, AbortSignal.timeout((ACTOR_TIMEOUT_S + 15) * 1000)]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`apify ${spec.platform} HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

/** Bluesky: public AppView API, no account or token needed. */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped public JSON */
async function fetchBluesky(handle: string, signal: AbortSignal): Promise<Normalized | null> {
  const base = "https://public.api.bsky.app/xrpc";
  const opts = { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: "no-store" as const };
  const pr = await fetch(`${base}/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`, opts);
  if (!pr.ok) return null;
  const prof = (await pr.json()) as any;
  const fr = await fetch(`${base}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${MAX_POSTS}&filter=posts_no_replies`, opts);
  const feed: any[] = fr.ok ? (((await fr.json()) as any).feed ?? []) : [];
  const h = prof.handle || handle;
  return {
    private: false,
    profileUrl: `https://bsky.app/profile/${h}`,
    displayName: prof.displayName || undefined,
    bio: prof.description || undefined,
    links: String(prof.description ?? "").match(/https?:\/\/\S+/g) ?? [],
    avatar: prof.avatar || undefined,
    posts: feed
      .filter((x) => x?.post?.author?.did === prof.did)
      .slice(0, MAX_POSTS)
      .map((x) => ({
        url: `https://bsky.app/profile/${h}/post/${String(x.post.uri).split("/").pop()}`,
        caption: String(x.post.record?.text ?? ""),
        image: x.post.embed?.images?.[0]?.fullsize ?? x.post.embed?.media?.images?.[0]?.fullsize,
        date: x.post.record?.createdAt,
      })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface Normalized {
  private: boolean;
  profileUrl: string;
  displayName?: string;
  bio?: string;
  location?: string;
  links: string[];
  avatar?: string;
  posts: { url: string; caption: string; image?: string; date?: string }[];
}

/* eslint-disable @typescript-eslint/no-explicit-any -- actor outputs are untyped JSON */
function normalize(p: Platform, handle: string, items: any[]): Normalized | null {
  if (items.length === 0) return null;
  if (p === "instagram") {
    const it = items.find((x) => x && (x.username || x.private !== undefined));
    if (!it) return null;
    const links = [it.externalUrl, ...(Array.isArray(it.externalUrls) ? it.externalUrls.map((e: any) => e?.url) : [])].filter((u): u is string => typeof u === "string");
    return {
      private: !!it.private,
      profileUrl: it.url || `https://www.instagram.com/${handle}/`,
      displayName: it.fullName || undefined,
      bio: it.biography || undefined,
      links,
      avatar: it.profilePicUrlHD || it.profilePicUrl || undefined,
      posts: (Array.isArray(it.latestPosts) ? it.latestPosts : []).slice(0, MAX_POSTS).map((x: any) => ({ url: x.url || `https://www.instagram.com/p/${x.shortCode}/`, caption: String(x.caption ?? ""), image: x.displayUrl || undefined, date: x.timestamp })),
    };
  }
  if (p === "tiktok") {
    if (items.some((x) => x?.errorCode === "PROFILE_PRIVATE" || x?.authorMeta?.privateAccount)) return { private: true, profileUrl: `https://www.tiktok.com/@${handle}`, links: [], posts: [] };
    const videos = items.filter((x) => x && x.authorMeta);
    if (videos.length === 0) return null;
    const a = videos[0].authorMeta;
    return {
      private: false,
      profileUrl: `https://www.tiktok.com/@${a.name || handle}`,
      displayName: a.nickName || undefined,
      bio: a.signature || undefined,
      location: a.region || undefined,
      links: [a.bioLink].filter((u): u is string => typeof u === "string" && !!u),
      avatar: a.avatar || undefined,
      posts: videos.slice(0, MAX_POSTS).map((v: any) => ({ url: v.webVideoUrl, caption: String(v.text ?? ""), image: v.videoMeta?.coverUrl, date: v.createTimeISO })),
    };
  }
  const it = items.find((x) => x && (x.userName || x.description !== undefined));
  if (!it) return null;
  return {
    private: !!it.isProtected,
    profileUrl: it.url || `https://x.com/${handle}`,
    displayName: it.name || undefined,
    bio: it.description || undefined,
    location: it.location || undefined,
    links: [it.website].filter((u): u is string => typeof u === "string" && !!u),
    avatar: it.profilePicture || undefined,
    posts: [],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function runSocialSources(
  findings: Finding[],
  ctx: { collector: FindingCollector; reader: PageReader; emit: Emit; signal: AbortSignal },
): Promise<void> {
  const token = process.env.APIFY_TOKEN;
  const handles = eligibleHandles(findings);
  const budget = Number(process.env.SCAN_APIFY_MAX_USD) > 0 ? Number(process.env.SCAN_APIFY_MAX_USD) : 0.3;
  let spent = 0;
  const specs: PlatformSpec[] = handles.bluesky ? [BLUESKY] : [];
  if (!token) {
    ctx.emit({ type: "status", message: "Social profiles: not configured" });
  } else {
    const apify = SPECS.filter((s) => handles[s.platform]);
    if (apify.length === 0) ctx.emit({ type: "status", message: "Social profiles: no Instagram, TikTok or X account is confirmed as yours yet, so none were read" });
    specs.push(...apify);
  }
  if (specs.length === 0) return;

  await Promise.all(
    specs.map(async (spec) => {
      if (spec.actor) {
        if (spent + spec.maxUsd > budget) return; // per-scan Apify cost ceiling
        spent += spec.maxUsd;
      }
      const { handle, finding: anchorFinding } = handles[spec.platform]!;
      const agentId = `social_${spec.platform}`;
      ctx.emit({ type: "source_started", sourceType: spec.sourceType, agentId, agentLabel: spec.label, query: `@${handle}` });
      let count = 0;
      try {
        const items = spec.platform === "bluesky" ? [] : await runActor(spec, handle, token!, ctx.signal);
        const n = spec.platform === "bluesky" ? await fetchBluesky(handle, ctx.signal) : normalize(spec.platform, handle, items);
        if (!n) {
          ctx.emit({ type: "status", message: `${spec.label}: nothing public returned` });
        } else if (n.private) {
          ctx.emit({ type: "status", message: `Your ${({ x: "X", tiktok: "TikTok", instagram: "Instagram", bluesky: "Bluesky" } as const)[spec.platform]} account is private, so its posts are not visible to strangers` });
        } else {
          const anchor = anchorFinding.anchor;
          const base = { sourceType: spec.sourceType, sourceUrl: n.profileUrl, sourceTitle: `@${handle}`, anchor, confidence: Math.min(0.95, anchorFinding.confidence) };
          const pending: Promise<void>[] = [];
          const add = (f: Omit<RawFinding, "sourceType" | "sourceUrl" | "sourceTitle" | "anchor" | "confidence"> & Partial<RawFinding>) => {
            pending.push(ctx.collector.add({ ...base, ...f }, agentId).then((r) => { if (r.ok) count++; }));
          };
          if (n.avatar) add({ category: "photo", label: `${spec.platform} profile picture`, value: `Profile picture on @${handle}`, imageUrl: n.avatar, riskWeight: 3 });
          if (n.displayName) add({ category: "other", label: `Display name on ${spec.platform}`, value: n.displayName, riskWeight: 2 });
          if (n.bio) add({ category: "other", label: `${spec.platform} bio`, value: n.bio, riskWeight: 4 });
          if (n.location) add({ category: "location", label: `Location on ${spec.platform}`, value: n.location, riskWeight: 6 });
          for (const l of n.links.slice(0, 3)) {
            add({ category: "handle", label: `Link in ${spec.platform} bio`, value: l, riskWeight: 4 });
            ctx.reader.enqueue({ url: l, why: `link in the subject's ${spec.platform} bio`, depth: 0 });
          }
          for (const post of n.posts.filter((x) => x.image && x.url).slice(0, MAX_POST_PHOTOS)) {
            add({ category: "photo", label: `Public ${spec.platform} post`, value: post.caption ? `Post: ${post.caption.slice(0, 80)}` : "Public post image", imageUrl: post.image, sourceUrl: post.url, confidence: 0.6, riskWeight: 3 });
          }
          // Public videos on this same account, for the voice-exposure check (self-only: posted by @handle).
          let videos: VideoItem[] = spec.platform === "tiktok" ? tiktokVideos(handle, items) : [];
          if (spec.platform === "instagram" && spent + IG_REELS.maxUsd <= budget) {
            spent += IG_REELS.maxUsd;
            try {
              videos = instagramVideos(handle, await runActor(IG_REELS, handle, token!, ctx.signal));
            } catch (e) {
              if (!ctx.signal.aborted) console.warn(`[scan:${agentId}] reels failed:`, e instanceof Error ? e.message : e);
            }
          }
          for (const v of videos) {
            const caption = v.caption.replace(/\s+/g, " ").trim();
            add({
              category: "video",
              label: `Public ${spec.platform} video`,
              value: caption ? `Video: ${caption.slice(0, 80)}` : `Video on @${handle}`,
              sourceUrl: v.postUrl,
              imageUrl: v.cover,
              mediaUrl: v.mediaUrl,
              durationSec: v.durationSec,
              soundOriginal: v.soundOriginal,
              soundTitle: v.soundTitle,
              riskWeight: videoRisk(v),
            });
          }
          await Promise.allSettled(pending);
          // Bio + captions -> fact extraction (pets, school, hometown, birthdays, routines, named relatives).
          const captions = n.posts.filter((x) => x.caption.trim()).map((x) => `- [${x.date ?? ""}] ${x.caption.replace(/\s+/g, " ").slice(0, 400)} (${x.url})`);
          if (n.bio || captions.length) {
            const doc: PageData = {
              url: n.profileUrl,
              title: `${spec.platform} @${handle} (public profile and recent posts)`,
              description: `This is the subject's own ${spec.platform} account (confirmed: ${anchorFinding.label}). Use anchor "${anchor}".`,
              text: [`BIO: ${n.bio ?? ""}`, `LINKS: ${n.links.join(", ")}`, `RECENT PUBLIC POST CAPTIONS:\n${captions.join("\n")}`].join("\n\n").slice(0, 14000),
              images: [],
              links: [],
              metaOnly: false,
            };
            count += await ctx.reader.readDocument(doc, agentId);
          }
        }
      } catch (e) {
        if (!ctx.signal.aborted) {
          console.warn(`[scan:${agentId}] apify failed:`, e instanceof Error ? e.message : e);
          ctx.emit({ type: "status", message: `${spec.label}: could not be read right now` });
        }
      }
      ctx.emit({ type: "source_done", sourceType: spec.sourceType, agentId, count });
    }),
  );
}
