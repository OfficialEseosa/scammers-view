import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isBlockedAddress, MEDIA_TYPES, parseMediaTarget, sniffMedia } from "@/lib/voice-exposure/ssrf";
import { refererFor } from "@/lib/voice-exposure/hosts";

/**
 * Hardened server-side fetch for the media we hand to Gemini. Same rules as
 * the face image relay (src/app/api/face/image) and the voice media relay:
 *  - https on port 443 only, no credentials in the URL, no cookies sent
 *  - every DNS answer (first request and after each redirect) is checked at
 *    connect time against private, loopback, link-local, CGNAT, multicast and
 *    reserved ranges; IP-literal and *.local / *.internal hosts are refused
 *  - content type allowlist + magic-byte sniff, byte cap, overall timeout
 *  - videos: the media-CDN host allowlist from the voice relay on every hop
 * Nothing is written to disk; the bytes live only for the one request.
 */

export class VisionFetchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp", "image/heic", "image/heif"]);

/** Validates an image target (first request and every redirect hop). Mirrors the face relay's parseTarget. */
export function parseImageTarget(raw: string | null | undefined): URL {
  if (!raw || raw.length > 4096) throw new VisionFetchError(400, "Missing or too long url");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new VisionFetchError(400, "Invalid url");
  }
  if (url.protocol !== "https:") throw new VisionFetchError(400, "Only https images are allowed");
  if (url.port && url.port !== "443") throw new VisionFetchError(400, "Only the default https port is allowed");
  if (url.username || url.password) throw new VisionFetchError(400, "Credentials in url are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) throw new VisionFetchError(403, "Address not allowed");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new VisionFetchError(403, "Address not allowed");
  return url;
}

/** Video targets: the voice relay's rules (incl. its media-CDN host allowlist). */
export function parseVideoTarget(raw: string | null | undefined): URL {
  try {
    return parseMediaTarget(raw ?? null);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 400;
    throw new VisionFetchError(status, e instanceof Error ? e.message : "Invalid url");
  }
}

/** DNS lookup that refuses to connect to any non-public address. */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = Array.isArray(addresses) ? addresses : [];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
      const e = Object.assign(new Error("Blocked address"), { code: "EBLOCKED" });
      return callback(e, "", 4);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

/** Image magic bytes (jpeg, png, gif, bmp, webp, avif/heic). */
export function sniffImage(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  const hex = Buffer.from(buf.subarray(0, 12)).toString("hex");
  const ascii = (a: number, b: number) => Buffer.from(buf.subarray(a, b)).toString("ascii");
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("47494638")) return "image/gif";
  if (hex.startsWith("424d")) return "image/bmp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand.startsWith("avi")) return "image/avif";
    if (/^(heic|heix|mif1|msf1|heim|heis)/.test(brand)) return "image/heic";
  }
  return null;
}

interface Got {
  contentType: string;
  body: Buffer;
}

function fetchOnce(url: URL, opts: { accept: string; types: Set<string>; maxBytes: number; signal: AbortSignal; referer?: string }): Promise<{ redirect: string } | Got> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: opts.accept, "User-Agent": "Mozilla/5.0 (compatible; media-relay/1.0)" };
    if (opts.referer) headers.Referer = opts.referer;
    const req = https.request(url, { method: "GET", agent: false, lookup: safeLookup, signal: opts.signal, headers }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: new URL(res.headers.location, url).toString() });
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new VisionFetchError(502, `Upstream returned ${status}`));
        return;
      }
      const contentType = (res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!opts.types.has(contentType)) {
        res.resume();
        reject(new VisionFetchError(415, "Unsupported media type"));
        return;
      }
      if (Number(res.headers["content-length"] ?? 0) > opts.maxBytes) {
        res.destroy();
        reject(new VisionFetchError(413, "Too large"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > opts.maxBytes) {
          res.destroy();
          reject(new VisionFetchError(413, "Too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ contentType, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

function mapNetError(err: unknown): never {
  if (err instanceof VisionFetchError) throw err;
  const code = (err as { code?: string })?.code ?? (err as { name?: string })?.name;
  if (code === "EBLOCKED") throw new VisionFetchError(403, "Address not allowed");
  if (code === "TimeoutError" || code === "AbortError" || code === "ABORT_ERR") throw new VisionFetchError(504, "Took too long to load");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") throw new VisionFetchError(502, "Host not found");
  throw new VisionFetchError(502, "Could not load");
}

export interface Fetched {
  mimeType: string;
  bytes: Buffer;
}

/** Fetch a photo for Gemini: image types only, 8 MB cap, sniffed. */
export async function fetchImage(raw: string, signal: AbortSignal): Promise<Fetched> {
  try {
    let target = parseImageTarget(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetchOnce(target, { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8", types: IMAGE_TYPES, maxBytes: IMAGE_MAX_BYTES, signal });
      if ("redirect" in res) {
        if (hop === MAX_REDIRECTS) break;
        target = parseImageTarget(res.redirect);
        continue;
      }
      const sniffed = sniffImage(res.body);
      if (!sniffed) throw new VisionFetchError(415, "Not a supported image");
      return { mimeType: sniffed, bytes: res.body };
    }
    throw new VisionFetchError(508, "Too many redirects");
  } catch (e) {
    mapNetError(e);
  }
}

/** Fetch one of the user's own videos (or its audio track) from an allowlisted media CDN. */
export async function fetchVideo(raw: string, maxBytes: number, signal: AbortSignal): Promise<Fetched> {
  try {
    let target = parseVideoTarget(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetchOnce(target, { accept: "video/*,audio/*;q=0.9,*/*;q=0.5", types: MEDIA_TYPES, maxBytes, signal, referer: refererFor(target.hostname) });
      if ("redirect" in res) {
        if (hop === MAX_REDIRECTS) break;
        target = parseVideoTarget(res.redirect);
        continue;
      }
      const sniffed = sniffMedia(res.body);
      if (!sniffed) throw new VisionFetchError(415, "Not a supported video");
      return { mimeType: geminiMediaType(sniffed), bytes: res.body };
    }
    throw new VisionFetchError(508, "Too many redirects");
  } catch (e) {
    mapNetError(e);
  }
}

/** Map sniffed types to the MIME types Gemini lists for video and audio input. */
export function geminiMediaType(sniffed: string): string {
  switch (sniffed) {
    case "video/quicktime":
      return "video/mov";
    case "audio/mp4":
      return "audio/m4a";
    case "audio/mpeg":
      return "audio/mp3";
    default:
      return sniffed; // video/mp4, video/webm, audio/aac, audio/ogg, audio/wav
  }
}
