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
): Promise<{ landmarker: FaceLandmarker; vision: VisionModule }> {
  quietWasmInfo();
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
  const make = (delegate: "GPU" | "CPU") =>
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: mode,
      numFaces: 2,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  let landmarker: FaceLandmarker;
  try {
    landmarker = await make("GPU");
  } catch {
    landmarker = await make("CPU");
  }
  return { landmarker, vision };
}
