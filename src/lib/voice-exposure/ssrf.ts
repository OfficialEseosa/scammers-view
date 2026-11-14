import { BlockList, isIP } from "node:net";
import { isAllowedMediaHost } from "./hosts";

/**
 * Server-only URL guards for the voice media relay, mirroring the face image
 * relay: https on 443 only, no credentials, no private / loopback / link-local
 * / CGNAT / multicast / reserved addresses, plus a media-CDN host allowlist.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true;
}

export class MediaProxyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Validates a target (the first request and every redirect hop). */
export function parseMediaTarget(raw: string | null): URL {
  if (!raw || raw.length > 4096) throw new MediaProxyError(400, "Missing or too long url");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MediaProxyError(400, "Invalid url");
  }
  if (url.protocol !== "https:") throw new MediaProxyError(400, "Only https media is allowed");
  if (url.port && url.port !== "443") throw new MediaProxyError(400, "Only the default https port is allowed");
  if (url.username || url.password) throw new MediaProxyError(400, "Credentials in url are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) throw new MediaProxyError(403, "Address not allowed");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new MediaProxyError(403, "Address not allowed");
  if (!isAllowedMediaHost(host)) throw new MediaProxyError(403, "Host not allowed");
  return url;
}

export const MEDIA_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  // Some CDN edges label media generically; accepted only when the bytes sniff as audio/video.
  "application/octet-stream",
  "binary/octet-stream",
]);

/** Magic-byte check: MP4/M4A/MOV (ftyp), MP3 (ID3 or frame sync), ADTS AAC, Ogg, WebM/Matroska, WAV. */
export function sniffMedia(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  const ascii = (a: number, b: number) => String.fromCharCode(...buf.subarray(a, b));
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (/^M4A |^M4B /.test(brand)) return "audio/mp4";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return "audio/aac"; // ADTS
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg"; // MPEG audio frame sync
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  return null;
}
