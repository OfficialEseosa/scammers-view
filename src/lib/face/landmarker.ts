import type { FaceLandmarker } from "@mediapipe/tasks-vision";

/** MediaPipe Face Landmarker (478 points), wasm + model served from /models/mediapipe. */
const WASM_BASE = "/models/mediapipe/wasm";
const MODEL = "/models/mediapipe/face_landmarker.task";

export type VisionModule = typeof import("@mediapipe/tasks-vision");

// The wasm runtime writes routine "INFO:" lines to stderr, which reach console.error
// and show up as errors in the Next.js dev overlay.
let quieted = false;
function quietWasmInfo() {
  if (quieted) return;
  quieted = true;
  const error = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("INFO: ")) return;
    error(...args);
  };
}

export async function createFaceLandmarker(
  mode: "VIDEO" | "IMAGE" = "VIDEO",
  /** "CPU" skips the graphics card. Slower, but works when the GPU path returns nothing or keeps failing. */
  prefer: "GPU" | "CPU" = "GPU",
): Promise<{ landmarker: FaceLandmarker; vision: VisionModule; delegate: "GPU" | "CPU" }> {
  quietWasmInfo();
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
  const make = (delegate: "GPU" | "CPU") =>
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      // Its own drawing surface every time: a rebuilt mesh must not share (and lose) the old one's graphics context.
      canvas: document.createElement("canvas"),
      runningMode: mode,
      numFaces: 2,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
      // A little under the 0.5 default: dim rooms and darker skin score lower, and a missed face blocks the whole scan.
      minFaceDetectionConfidence: 0.35,
      minFacePresenceConfidence: 0.35,
      minTrackingConfidence: 0.4,
    });
  let landmarker: FaceLandmarker;
  let delegate: "GPU" | "CPU" = prefer;
  if (prefer === "CPU") {
    landmarker = await make("CPU");
  } else {
    try {
      landmarker = await make("GPU");
    } catch {
      landmarker = await make("CPU");
      delegate = "CPU";
    }
  }
  console.info(`[face] mesh running on: ${delegate}`);
  return { landmarker, vision, delegate };
}
