import { loadRecognizer } from "./recognizer";

/**
 * Start downloading and warming everything the face check needs, long before
 * the person reaches it. Called as soon as someone is signed in, so by the time
 * they press "Start face scan" the ~30 MB of models are already in the browser
 * and the matching networks have compiled.
 *
 * Nothing here touches the camera or any face data: it only fetches model files.
 */
const MEDIAPIPE = [
  "/models/mediapipe/face_landmarker.task",
  "/models/mediapipe/wasm/vision_wasm_internal.wasm",
  "/models/mediapipe/wasm/vision_wasm_internal.js",
];

let started = false;

export function preloadFaceModels(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const run = () => {
    // Mesh model and its runtime: warm the HTTP cache and pull in the module.
    for (const url of MEDIAPIPE) void fetch(url, { cache: "force-cache" }).catch(() => {});
    void import("@mediapipe/tasks-vision").catch(() => {});
    // Matching networks: download, then compile on the GPU once.
    void loadRecognizer().catch(() => {
      started = false;
    });
  };
  // Leave the first paint alone; start when the browser has a quiet moment.
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 1500 });
  else window.setTimeout(run, 400);
}
