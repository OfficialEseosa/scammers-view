/**
 * Download everything the face check needs, long before the person reaches it.
 * Called as soon as someone is signed in.
 *
 * This only fills the browser's cache with the model files (~30 MB). It does
 * NOT load the face libraries or compile the networks: that work runs on the
 * main thread and the GPU and freezes the page for a second or more, so it is
 * left to the face check itself, which shows its own loading state.
 *
 * Nothing here touches the camera or any face data.
 */
const FILES = [
  // Small files first so the big ones do not hold them up.
  "/models/faceapi/ssd_mobilenetv1_model-weights_manifest.json",
  "/models/faceapi/face_landmark_68_model-weights_manifest.json",
  "/models/faceapi/face_recognition_model-weights_manifest.json",
  "/models/mediapipe/wasm/vision_wasm_internal.js",
  "/models/faceapi/face_landmark_68_model.bin",
  "/models/mediapipe/face_landmarker.task",
  "/models/faceapi/ssd_mobilenetv1_model.bin",
  "/models/faceapi/face_recognition_model.bin",
  "/models/mediapipe/wasm/vision_wasm_internal.wasm",
];

/** Long enough for the screen's own entrance animation and first interactions to finish. */
const START_DELAY_MS = 2500;

let started = false;

export function preloadFaceModels(): void {
  if (started || typeof window === "undefined") return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  started = true;

  const run = async () => {
    // One at a time and at low priority: the page's own requests always go first.
    for (const url of FILES) {
      try {
        const res = await fetch(url, { priority: "low" } as RequestInit);
        // Drain the body so the whole file lands in the cache; nothing is parsed.
        await res.arrayBuffer();
      } catch {
        /* best effort: the face check downloads whatever is missing */
      }
    }
  };
  window.setTimeout(() => void run(), START_DELAY_MS);
}
