import type { FaceReference } from "./types";

/**
 * Module-level, in-memory only. No localStorage, IndexedDB, cookies or
 * network. A page reload wipes everything; clearFaceData() wipes it sooner.
 */
let reference: FaceReference | null = null;
const canvases = new Set<HTMLCanvasElement>();
const listeners = new Set<() => void>();

export function setFaceReference(ref: FaceReference | null) {
  if (reference && reference !== ref) wipeDescriptors(reference);
  reference = ref;
  listeners.forEach((l) => l());
}

export function getFaceReference(): FaceReference | null {
  return reference;
}

export function subscribeFaceReference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Track a capture canvas so clearFaceData() can blank it. */
export function trackCanvas(canvas: HTMLCanvasElement) {
  canvases.add(canvas);
}

export function wipeCanvas(canvas: HTMLCanvasElement) {
  try {
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  } catch {
    /* ignore */
  }
  canvas.width = 0;
  canvas.height = 0;
  canvases.delete(canvas);
}

function wipeDescriptors(ref: FaceReference) {
  for (const d of ref.descriptors) d.fill(0);
  ref.descriptors.length = 0;
}

/** Forget the reference face and blank every captured frame. */
export function clearFaceData() {
  if (reference) wipeDescriptors(reference);
  reference = null;
  for (const c of Array.from(canvases)) wipeCanvas(c);
  listeners.forEach((l) => l());
}
