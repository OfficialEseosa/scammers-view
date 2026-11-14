/**
 * Media CDN hosts the voice media proxy may fetch from. Taken from the hosts
 * the Apify actors' documented sample output uses for media URLs:
 *  - clockworks~tiktok-profile-scraper: musicMeta.playUrl / videoMeta.downloadAddr / mediaUrls
 *    on v16-webapp-prime.tiktok.com; covers on p16-sign-*.tiktokcdn.com
 *  - apify~instagram-reel-scraper: videoUrl / displayUrl on scontent-*.cdninstagram.com
 * Plus the sibling CDN families those platforms serve the same files from
 * (*.tiktokcdn.com, *.tiktokcdn-us.com, *.fbcdn.net). Never the platforms'
 * page hosts (www.tiktok.com, www.instagram.com) and never anything else.
 */

const SUFFIXES = ["tiktokcdn.com", "tiktokcdn-us.com", "cdninstagram.com", "fbcdn.net"];
/** tiktok.com itself only for its media edge hosts (v16-webapp-prime, v19-webapp, v77, ...). */
const TIKTOK_MEDIA = /^v\d{1,3}[a-z0-9-]*\.tiktok\.com$/;

export function isAllowedMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(h) || h.includes("..")) return false;
  if (TIKTOK_MEDIA.test(h)) return true;
  return SUFFIXES.some((s) => h.endsWith(`.${s}`));
}

/** Platform-appropriate Referer for media edges that check it (no cookies are ever sent). */
export function refererFor(hostname: string): string | undefined {
  const h = hostname.toLowerCase();
  if (h.endsWith(".tiktok.com") || h.endsWith("tiktokcdn.com") || h.endsWith("tiktokcdn-us.com")) return "https://www.tiktok.com/";
  if (h.endsWith("cdninstagram.com") || h.endsWith("fbcdn.net")) return "https://www.instagram.com/";
  return undefined;
}
