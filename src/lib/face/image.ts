/**
 * Load a candidate image so its pixels are readable (not canvas-tainted).
 * Remote images go through our byte-relay proxy; the image is decoded here,
 * in the browser, and the object URL is revoked right after.
 */
export function proxiedUrl(url: string): string {
  return `/api/face/image?url=${encodeURIComponent(url)}`;
}

function needsProxy(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export async function loadImageForFaces(
  url: string,
  { useProxy = true, signal }: { useProxy?: boolean; signal?: AbortSignal } = {},
): Promise<HTMLCanvasElement> {
  const src = useProxy && needsProxy(url) ? proxiedUrl(url) : url;
  let res = await fetch(src, { signal, credentials: "same-origin", cache: "no-store" });
  // Image hosts often rate-limit bursts; one patient retry recovers most.
  for (let attempt = 1; attempt <= 2 && [429, 502, 503, 504].includes(res.status); attempt++) {
    await new Promise((r) => setTimeout(r, 700 * attempt));
    if (signal?.aborted) break;
    res = await fetch(src, { signal, credentials: "same-origin", cache: "no-store" });
  }
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) reason = body.error;
    } catch {
      /* not json */
    }
    throw new Error(reason);
  }
  const blob = await res.blob();
  return decodeToCanvas(blob);
}

/** Largest side we analyse; bigger photos are scaled down (faster on phones). */
const MAX_SIDE = 1600;

/**
 * Decode with createImageBitmap (works even when the page isn't painting,
 * unlike HTMLImageElement.decode) and draw into an in-memory canvas.
 */
async function decodeToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  let source: ImageBitmap | HTMLImageElement;
  let w: number;
  let h: number;
  if (typeof createImageBitmap === "function") {
    source = await createImageBitmap(blob);
    w = source.width;
    h = source.height;
  } else {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Not a readable image"));
        img.src = objectUrl;
      });
      source = img;
      w = img.naturalWidth;
      h = img.naturalHeight;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  if (!w || !h) throw new Error("Not a readable image");
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  return canvas;
}

/** Blank a canvas returned by loadImageForFaces once you're done with it. */
export function releaseImage(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}
