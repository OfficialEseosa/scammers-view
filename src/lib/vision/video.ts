import type { GoogleGenAI } from "@google/genai";
import { estimateCostUsd, getGemini, MODELS } from "@/lib/llm/gemini";
import { callVisionJson } from "./call";
import { cleanVideoReadout, videoFindings } from "./clean";
import { fetchVideo, type Fetched } from "./fetch";
import { VIDEO_ANALYSE_SEC, VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_SEC } from "./limits";
import { round6, safeHttps } from "./photo";
import { VIDEO_PROMPT, VIDEO_SYSTEM } from "./prompts";
import { VideoReadout, type SkipResponse, type VideoRequest, type VideoResponse } from "./schema";

/**
 * Video + audio understanding with Gemini, for the user's OWN public video.
 *
 * Per aistudio.google.com/docs/video-understanding and /docs/files:
 *  - the bytes are uploaded with the Files API (ai.files.upload, Blob),
 *    polled until ACTIVE, then referenced by uri in an Interactions call;
 *  - Gemini reads both the picture (1 fps) and the audio track, so spoken
 *    facts come out of the same call (audio-only tracks are sent as audio);
 *  - `processing: { type: "static", end_offset }` clips analysis to the first
 *    VIDEO_ANALYSE_SEC seconds and `resolution: "low"` keeps ~100 tokens/s.
 * The uploaded file is ALWAYS deleted in `finally` (success, model error,
 * timeout or abort), so nothing is retained on Google's side beyond the call.
 */

const TIMEOUT_MS = 120_000;
const POLL_MS = 1_500;

type Files = Pick<GoogleGenAI["files"], "upload" | "get" | "delete">;
type AnyRec = Record<string, unknown>;

export interface VideoDeps {
  fetchVideo?: (url: string, maxBytes: number, signal: AbortSignal) => Promise<Fetched>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => string;
}

function filesApi(): Files {
  const files = (getGemini() as unknown as Partial<GoogleGenAI>).files;
  if (!files) throw new Error("Gemini Files API unavailable");
  return files;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export async function analyseVideo(req: VideoRequest, signal: AbortSignal, deps: VideoDeps = {}): Promise<VideoResponse | SkipResponse> {
  if (req.durationSec && req.durationSec > VIDEO_MAX_DURATION_SEC) {
    return { findingId: req.findingId, skipped: `Longer than ${VIDEO_MAX_DURATION_SEC / 60} minutes` };
  }
  const started = Date.now();
  const sig = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
  const sleep = deps.sleep ?? defaultSleep;

  let media: Fetched;
  try {
    media = await (deps.fetchVideo ?? fetchVideo)(req.mediaUrl, VIDEO_MAX_BYTES, sig);
  } catch (e) {
    if ((e as { status?: number }).status === 413) return { findingId: req.findingId, skipped: `Larger than ${VIDEO_MAX_BYTES / 1024 / 1024} MB` };
    throw e;
  }

  const files = filesApi();
  const model = MODELS.fast;
  const isAudio = media.mimeType.startsWith("audio/");
  let uploadedName: string | undefined;
  try {
    const uploaded = await files.upload({
      file: new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }),
      config: { mimeType: media.mimeType, abortSignal: sig },
    });
    uploadedName = uploaded.name;
    if (!uploadedName) throw new Error("Upload returned no file name");

    let file = uploaded;
    while (file.state === "PROCESSING" || file.state === "STATE_UNSPECIFIED" || !file.state) {
      await sleep(POLL_MS, sig);
      file = await files.get({ name: uploadedName });
    }
    if (file.state !== "ACTIVE" || !file.uri) throw new Error("Gemini could not process this video");

    const mediaBlock: AnyRec = isAudio
      ? { type: "audio", uri: file.uri, mime_type: media.mimeType }
      : {
          type: "video",
          uri: file.uri,
          mime_type: media.mimeType,
          resolution: "low",
          processing: { type: "static", end_offset: `${VIDEO_ANALYSE_SEC}s` },
        };
    const { data, usage } = await callVisionJson({ model, system: VIDEO_SYSTEM, prompt: VIDEO_PROMPT, media: mediaBlock, schema: VideoReadout, signal: sig });

    const readout = cleanVideoReadout(data);
    const sourceUrl = safeHttps(req.sourceUrl) ?? req.mediaUrl;
    return {
      findingId: req.findingId,
      readout,
      findings: videoFindings(readout, { findingId: req.findingId, sourceUrl, anchor: req.anchor ?? "unconfirmed", now: deps.now?.() }),
      analysedSec: req.durationSec ? Math.min(req.durationSec, isAudio ? req.durationSec : VIDEO_ANALYSE_SEC) : undefined,
      usage: {
        model,
        ms: Date.now() - started,
        inputTokens: usage.inputTokens || undefined,
        outputTokens: usage.outputTokens + usage.thoughtTokens || undefined,
        costUsd: usage.inputTokens ? round6(estimateCostUsd(usage, { countSearch: false })) : undefined,
      },
    };
  } finally {
    // Nothing retained: delete the upload whatever happened above (not tied to the request signal).
    if (uploadedName) await files.delete({ name: uploadedName }).catch(() => {});
  }
}
