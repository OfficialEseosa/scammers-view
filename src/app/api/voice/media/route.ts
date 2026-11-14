import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { getScanSubject } from "@/lib/auth/subject";
import { refererFor } from "@/lib/voice-exposure/hosts";
import { isBlockedAddress, MEDIA_TYPES, MediaProxyError, parseMediaTarget, sniffMedia } from "@/lib/voice-exposure/ssrf";

/**
 * GET /api/voice/media?url=https://…
 *
 * Byte relay so the browser can decode a public video's audio for ON-DEVICE
 * speaker matching. No audio processing happens here, nothing is written to
 * disk or cached, no cookies are forwarded. Mirrors /api/face/image:
 * signed-in subject only; https:443 only; every DNS answer (also after each
 * redirect) checked at connect time against private/loopback/link-local/
 * CGNAT/multicast/reserved ranges; plus a media-CDN host allowlist on every
 * hop; audio/video types only (verified by magic bytes); 25 MB cap; 20 s timeout.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

/** DNS lookup that refuses to connect to any non-public address. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
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

interface Fetched {
  contentType: string;
  body: Buffer;
}

function fetchOnce(url: URL, signal: AbortSignal): Promise<{ redirect: string } | Fetched> {
  return new Promise((resolve, reject) => {
    const referer = refererFor(url.hostname);
    const req = https.request(
      url,
      {
        method: "GET",
        agent: false,
        lookup: safeLookup,
        signal,
        headers: {
          Accept: "audio/*,video/*;q=0.9,*/*;q=0.1",
          "User-Agent": "Mozilla/5.0 (compatible; media-relay/1.0)",
          ...(referer ? { Referer: referer } : {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: new URL(res.headers.location, url).toString() });
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new MediaProxyError(502, `Upstream returned ${status}`));
          return;
        }
        const contentType = (res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!MEDIA_TYPES.has(contentType)) {
          res.resume();
          reject(new MediaProxyError(415, "Not an audio or video type"));
          return;
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_BYTES) {
          res.destroy();
          reject(new MediaProxyError(413, "Media too large"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            reject(new MediaProxyError(413, "Media too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ contentType, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return jsonError(401, "Sign in first");

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  try {
    let target = parseMediaTarget(new URL(request.url).searchParams.get("url"));
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetchOnce(target, signal);
      if ("redirect" in res) {
        if (hop === MAX_REDIRECTS) throw new MediaProxyError(508, "Too many redirects");
        target = parseMediaTarget(res.redirect);
        continue;
      }
      const sniffed = sniffMedia(res.body);
      if (!sniffed) throw new MediaProxyError(415, "Not an audio or video file");
      return new Response(new Uint8Array(res.body), {
        status: 200,
        headers: {
          "Content-Type": res.contentType.endsWith("octet-stream") ? sniffed : res.contentType,
          "Content-Length": String(res.body.length),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    return jsonError(508, "Too many redirects");
  } catch (err) {
    if (err instanceof MediaProxyError) return jsonError(err.status, err.message);
    const code = (err as { code?: string; name?: string })?.code ?? (err as { name?: string })?.name;
    if (code === "EBLOCKED") return jsonError(403, "Address not allowed");
    if (code === "TimeoutError" || code === "AbortError" || code === "ABORT_ERR") return jsonError(504, "Media took too long to load");
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return jsonError(502, "Media host not found");
    return jsonError(502, "Could not load media");
  }
}
