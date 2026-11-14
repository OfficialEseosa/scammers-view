import type { FaceBox } from "./types";

/**
 * Thin wrapper over @vladmandic/face-api (TensorFlow.js, in the browser).
 * Models: SSD MobileNet v1 detector + 68-point landmarks + ResNet-34
 * 128-d face descriptor, served from /models/faceapi.
 */

type FaceApi = typeof import("@vladmandic/face-api");

const MODEL_URL = "/models/faceapi";
let loading: Promise<FaceApi> | null = null;

export function loadRecognizer(): Promise<FaceApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Face recognition runs in the browser only."));
  }
  if (!loading) {
    loading = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      // The bundled tfjs typings omit these engine functions.
      const tf = faceapi.tf as unknown as {
        setBackend(name: string): Promise<boolean>;
        ready(): Promise<void>;
      };
      const ok = await tf.setBackend("webgl").catch(() => false);
      if (!ok) await tf.setBackend("cpu");
      await tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

export interface DescribedFace {
  descriptor: Float32Array;
  box: FaceBox;
  score: number;
}

export type FaceInput = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement;

function dims(input: FaceInput) {
  if (input instanceof HTMLVideoElement) return { w: input.videoWidth, h: input.videoHeight };
  if (input instanceof HTMLImageElement) return { w: input.naturalWidth, h: input.naturalHeight };
  return { w: input.width, h: input.height };
}

/** Detect every face in the input and return its descriptor + normalised box. */
export async function describeFaces(
  input: FaceInput,
  { minConfidence = 0.45, maxResults = 20 } = {},
): Promise<DescribedFace[]> {
  const faceapi = await loadRecognizer();
  const { w, h } = dims(input);
  if (!w || !h) return [];
  const results = await faceapi
    .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence, maxResults }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return results.map((r) => {
    const b = r.detection.box;
    return {
      descriptor: r.descriptor,
      score: r.detection.score,
      box: {
        x: Math.max(0, b.x / w),
        y: Math.max(0, b.y / h),
        width: Math.min(1, b.width / w),
        height: Math.min(1, b.height / h),
      },
    };
  });
}

/** Largest face in the input, or null. */
export async function describeLargestFace(input: FaceInput): Promise<DescribedFace | null> {
  const faces = await describeFaces(input, { minConfidence: 0.35, maxResults: 5 });
  if (!faces.length) return null;
  return faces.reduce((a, b) => (b.box.width * b.box.height > a.box.width * a.box.height ? b : a));
}

export function euclidean(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
