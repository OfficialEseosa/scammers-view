import { estimateCostUsd, MODELS } from "@/lib/llm/gemini";
import { callVisionJson } from "./call";
import { cleanPhotoReadout, photoFindings } from "./clean";
import { fetchImage, type Fetched } from "./fetch";
import { PHOTO_PROMPT, PHOTO_SYSTEM } from "./prompts";
import { PhotoReadout, type PhotoRequest, type PhotoResponse } from "./schema";

/**
 * Photo understanding with Gemini: one photo the user already matched to
 * themselves ON THEIR DEVICE is fetched through the hardened relay rules
 * (fetch.ts), sent inline in one Interactions user_input step (well under the documented 20 MB request limit;
 * aistudio.google.com/docs/image-understanding) with a structured-output
 * schema, and turned into Findings. The model is told never to identify
 * anyone (prompts.ts); clean.ts enforces that on the output too.
 */

const TIMEOUT_MS = 45_000;

export interface PhotoDeps {
  fetchImage?: (url: string, signal: AbortSignal) => Promise<Fetched>;
  now?: () => string;
}

export async function analysePhoto(req: PhotoRequest, signal: AbortSignal, deps: PhotoDeps = {}): Promise<PhotoResponse> {
  const started = Date.now();
  const sig = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
  const img = await (deps.fetchImage ?? fetchImage)(req.imageUrl, sig);

  const model = MODELS.fast;
  const { data: raw, usage } = await callVisionJson({
    model,
    system: PHOTO_SYSTEM,
    prompt: PHOTO_PROMPT,
    // Inline bytes: photos are capped at 8 MB, under the documented 20 MB request limit.
    media: { type: "image", data: img.bytes.toString("base64"), mime_type: img.mimeType },
    schema: PhotoReadout,
    signal: sig,
  });

  const readout = cleanPhotoReadout(raw);
  const sourceUrl = safeHttps(req.sourceUrl) ?? req.imageUrl;
  return {
    findingId: req.findingId,
    readout,
    findings: photoFindings(readout, { findingId: req.findingId, sourceUrl, now: deps.now?.() }),
    usage: {
      model,
      ms: Date.now() - started,
      inputTokens: usage.inputTokens || undefined,
      outputTokens: usage.outputTokens + usage.thoughtTokens || undefined,
      costUsd: usage.inputTokens ? round6(estimateCostUsd(usage, { countSearch: false })) : undefined,
    },
  };
}

export function safeHttps(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
