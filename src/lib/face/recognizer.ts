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
      console.info(`[face] recogniser backend: ${ok ? "webgl" : "cpu (slow)"}`);
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      await warmUp(faceapi);
      return faceapi;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

/**
 * Run each network once on a blank canvas. The first run compiles the GPU
 * programs, which blocks the page for a moment; doing it here, while the
 * person is still turning their head, keeps the final matching step smooth.
 */
async function warmUp(faceapi: FaceApi): Promise<void> {
  try {
    const blank = document.createElement("canvas");
    blank.width = 160;
    blank.height = 160;
    const ctx = blank.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#777";
      ctx.fillRect(0, 0, 160, 160);
    }
    await faceapi.detectAllFaces(blank, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.9, maxResults: 1 }));
    await new Promise((r) => setTimeout(r, 0));
    await faceapi.detectFaceLandmarks(blank);
    await new Promise((r) => setTimeout(r, 0));
    await faceapi.computeFaceDescriptor(blank);
  } catch {
    /* warm-up is best effort */
  }
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
