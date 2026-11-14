import { loadImageForFaces, releaseImage } from "./image";
import { describeFaces, euclidean } from "./recognizer";
import type { FaceReference, MatchOptions, MatchResult } from "./types";

/**
 * Euclidean distance on face-api's 128-d descriptors. The library's usual
 * cut-off is 0.6; we are stricter because a false "this is you" is worse
 * than a miss. Measured (lab page, public-domain portraits): same person
 * 0.29–0.39 portrait↔portrait, 0.33–0.51 portrait↔candid group photo;
 * different people 0.69–0.96.
 */
export const DEFAULT_MATCH_THRESHOLD = 0.55;

/** Max front↔side distance for the three liveness frames to count as one person. */
export const SAME_PERSON_THRESHOLD = 0.55;

/** Lowest distance between a descriptor and any reference descriptor. */
export function distanceToReference(reference: FaceReference, descriptor: Float32Array): number {
  let best = Infinity;
  for (const r of reference.descriptors) best = Math.min(best, euclidean(r, descriptor));
  return best;
}

/**
 * Check each image for the user's face, one at a time (keeps phones
 * responsive). Other people's descriptors exist only inside this call and
 * are zeroed before it returns.
 */
export async function matchFaces(
  reference: FaceReference,
  imageUrls: string[],
  opts: MatchOptions = {},
): Promise<MatchResult[]> {
  const { threshold = DEFAULT_MATCH_THRESHOLD, useProxy = true, onResult, signal } = opts;
  if (!reference.descriptors.length) throw new Error("No reference face. Run the live scan first.");
  const results: MatchResult[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    if (signal?.aborted) break;
    const imageUrl = imageUrls[i];
    let result: MatchResult;
    try {
      const img = await loadImageForFaces(imageUrl, { useProxy, signal });
      const faces = await describeFaces(img);
      releaseImage(img);
      let best: (typeof faces)[number] | null = null;
      let bestDistance = Infinity;
      for (const f of faces) {
        const d = distanceToReference(reference, f.descriptor);
        if (d < bestDistance) {
          bestDistance = d;
          best = f;
        }
      }
      for (const f of faces) f.descriptor.fill(0);
      result = {
        imageUrl,
        matched: best !== null && bestDistance <= threshold,
        distance: bestDistance,
        faceBox: best ? best.box : null,
        faceCount: faces.length,
      };
    } catch (err) {
      if (signal?.aborted) break;
      result = {
        imageUrl,
        matched: false,
        distance: Infinity,
        faceBox: null,
        faceCount: 0,
        error: err instanceof Error ? err.message : "Could not read this image",
      };
    }
    results.push(result);
    onResult?.(result, i);
    // Yield so the UI can paint between images.
    await new Promise((r) => setTimeout(r, 0));
  }
  return results;
}
