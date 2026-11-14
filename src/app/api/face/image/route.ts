import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { getScanSubject } from "@/lib/auth/subject";

/**
 * GET /api/face/image?url=https://…
 *
 * Minimal byte relay so the browser can read pixels of a remote image for
 * ON-DEVICE face matching. No face processing happens here, nothing is
 * written to disk or cached, no cookies are forwarded.
 *
 * SSRF guards: https on port 443 only; every DNS answer (including after
 * each redirect) is checked at connect time against private, loopback,
 * link-local, CGNAT, multicast and reserved ranges; image content types
 * only; 8 MB cap; 10 s overall timeout.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
]);

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
  // v4-mapped (::ffff:0:0/96) is unwrapped and checked as IPv4 below; adding
  // it here would make BlockList block every IPv4 address.
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

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true;
}

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

class ProxyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function parseTarget(raw: string | null): URL {
  if (!raw || raw.length > 4096) throw new ProxyError(400, "Missing or too long url");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProxyError(400, "Invalid url");
  }
  if (url.protocol !== "https:") throw new ProxyError(400, "Only https images are allowed");
  if (url.port && url.port !== "443") throw new ProxyError(400, "Only the default https port is allowed");
  if (url.username || url.password) throw new ProxyError(400, "Credentials in url are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) throw new ProxyError(403, "Address not allowed");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new ProxyError(403, "Address not allowed");
  }
  return url;
}

interface Fetched {
  contentType: string;
  body: Buffer;
}

function fetchOnce(url: URL, signal: AbortSignal): Promise<{ redirect: string } | Fetched> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        agent: false,
        lookup: safeLookup,
        signal,
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; image-relay/1.0)",
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
          reject(new ProxyError(502, `Upstream returned ${status}`));
          return;
        }
        const contentType = (res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!ALLOWED_TYPES.has(contentType)) {
          res.resume();
          reject(new ProxyError(415, "Not a supported image type"));
          return;
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_BYTES) {
          res.destroy();
          reject(new ProxyError(413, "Image too large"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            reject(new ProxyError(413, "Image too large"));
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

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const hex = buf.subarray(0, 12).toString("hex");
  return (
    hex.startsWith("ffd8ff") || // jpeg
    hex.startsWith("89504e47") || // png
    hex.startsWith("47494638") || // gif
    hex.startsWith("424d") || // bmp
    (hex.startsWith("52494646") && buf.subarray(8, 12).toString("ascii") === "WEBP") ||
    buf.subarray(4, 12).toString("ascii").startsWith("ftypavi") // avif
  );
}

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return jsonError(401, "Sign in first");

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  try {
    let target = parseTarget(new URL(request.url).searchParams.get("url"));
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetchOnce(target, signal);
      if ("redirect" in res) {
        if (hop === MAX_REDIRECTS) throw new ProxyError(508, "Too many redirects");
        target = parseTarget(res.redirect);
        continue;
      }
      if (!looksLikeImage(res.body)) throw new ProxyError(415, "Not a supported image type");
      return new Response(new Uint8Array(res.body), {
        status: 200,
        headers: {
          "Content-Type": res.contentType === "image/jpg" || res.contentType === "image/pjpeg" ? "image/jpeg" : res.contentType,
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
    if (err instanceof ProxyError) return jsonError(err.status, err.message);
    const code = (err as { code?: string; name?: string })?.code ?? (err as { name?: string })?.name;
    if (code === "EBLOCKED") return jsonError(403, "Address not allowed");
    if (code === "TimeoutError" || code === "AbortError" || code === "ABORT_ERR") {
      return jsonError(504, "Image took too long to load");
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return jsonError(502, "Image host not found");
    return jsonError(502, "Could not load image");
  }
}
