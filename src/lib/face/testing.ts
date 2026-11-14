import { loadImageForFaces, releaseImage } from "./image";
import { describeLargestFace, euclidean } from "./recognizer";
import type { FaceReference } from "./types";

/**
 * DEV-ONLY test path for verifying the matching pipeline without a camera.
 * Imported only by the dev lab page (/lab/face, which 404s outside
 * `next dev`) and refuses to run in production builds. The product's only
 * way to create a reference is a passed live scan.
 */
function assertDev() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Static-image reference is a development-only test path.");
  }
}

/** Build a reference from sample image URLs (largest face per image). */
export async function referenceFromSampleImagesForTesting(urls: string[]): Promise<FaceReference> {
  assertDev();
  const descriptors: Float32Array[] = [];
  for (const url of urls) {
    const img = await loadImageForFaces(url);
    const face = await describeLargestFace(img);
    releaseImage(img);
    if (!face) throw new Error(`No face found in ${url}`);
    descriptors.push(face.descriptor);
  }
  return { descriptors, createdAt: Date.now() };
}

/** Pairwise distance matrix between the largest faces of the given images. */
export async function pairwiseDistancesForTesting(
  urls: string[],
): Promise<{ urls: string[]; matrix: (number | null)[][] }> {
  assertDev();
  const descs: (Float32Array | null)[] = [];
  for (const url of urls) {
    try {
      const img = await loadImageForFaces(url);
      descs.push((await describeLargestFace(img))?.descriptor ?? null);
      releaseImage(img);
    } catch {
      descs.push(null);
    }
  }
  const matrix = descs.map((a) => descs.map((b) => (a && b ? Number(euclidean(a, b).toFixed(4)) : null)));
  for (const d of descs) d?.fill(0);
  return { urls, matrix };
}
