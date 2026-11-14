"use client";

import type { Finding } from "@/lib/types";
import { PhotoResponse, SkipResponse, VideoResponse } from "@/lib/vision/schema";

/** Browser side of /api/vision/*. Sends only what the user clicked. */

export type ItemState =
  | { k: "idle" }
  | { k: "busy" }
  | { k: "done"; res: PhotoResponse | VideoResponse }
  | { k: "skipped"; reason: string }
  | { k: "failed"; message: string };

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** Overrides the server's provenance with the original finding's (it knows the page and anchor). */
function withOrigin<T extends PhotoResponse | VideoResponse>(res: T, origin: Finding, anchor?: Finding["anchor"]): T {
  return {
    ...res,
    findings: res.findings.map((f) => ({
      ...f,
      sourceUrl: origin.sourceUrl || f.sourceUrl,
      sourceType: origin.sourceType ?? f.sourceType,
      sourceTitle: origin.sourceTitle ?? f.sourceTitle,
      ...(anchor ? { anchor } : {}),
    })),
  };
}

export async function readPhoto(photo: Finding, signal?: AbortSignal): Promise<ItemState> {
  const data = await post("/api/vision/photo", { findingId: photo.id, imageUrl: photo.imageUrl, sourceUrl: photo.sourceUrl }, signal);
  const parsed = PhotoResponse.safeParse(data);
  if (!parsed.success) throw new Error("Unexpected answer");
  return { k: "done", res: withOrigin(parsed.data, photo, "face") };
}

export async function readVideo(video: Finding, signal?: AbortSignal): Promise<ItemState> {
  const data = await post(
    "/api/vision/video",
    { findingId: video.id, mediaUrl: video.mediaUrl, sourceUrl: video.sourceUrl, durationSec: video.durationSec, anchor: video.anchor },
    signal,
  );
  const skip = SkipResponse.safeParse(data);
  if (skip.success) return { k: "skipped", reason: skip.data.skipped };
  const parsed = VideoResponse.safeParse(data);
  if (!parsed.success) throw new Error("Unexpected answer");
  return { k: "done", res: withOrigin(parsed.data, video, video.anchor) };
}

/** Fixture mode (lab / mock scans): a canned answer after a short, realistic wait. */
export async function fromFixture(res: PhotoResponse | VideoResponse | undefined, signal?: AbortSignal): Promise<ItemState> {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, 900 + Math.random() * 900);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Aborted", "AbortError"))), { once: true });
  });
  if (!res) return { k: "failed", message: "No fixture for this item" };
  return { k: "done", res };
}
