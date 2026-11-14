/**
 * Face data types. Everything here lives only in browser memory: never
 * serialised, never persisted, never sent to the server.
 */

/** Normalised box (0..1 relative to the image's width/height). */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TurnDirection = "left" | "right";

/** The live-scanned user's face, as descriptors only. */
export interface FaceReference {
  /** 128-d descriptors from the front, left and right capture frames. */
  descriptors: Float32Array[];
  /** When the liveness scan passed (ms epoch). */
  createdAt: number;
}

export interface CapturedFrames {
  front: HTMLCanvasElement;
  left: HTMLCanvasElement;
  right: HTMLCanvasElement;
}

/** Only ever produced by a passed liveness scan. */
export interface LivenessResult {
  passed: true;
  reference: FaceReference;
  /** In-memory frames (unmirrored). Cleared by clearFaceData(). */
  frames: CapturedFrames;
  /** The random order the user was asked to turn. */
  order: [TurnDirection, TurnDirection];
  /** Descriptor distances front↔left and front↔right (same-person check). */
  consistency: { left: number; right: number };
}

export interface MatchResult {
  imageUrl: string;
  matched: boolean;
  /** Best (lowest) distance of any face in the image to the reference; Infinity if none. */
  distance: number;
  /** Box of the best-matching face, normalised; null if no face found. */
  faceBox: FaceBox | null;
  /** How many faces were found in the image. */
  faceCount: number;
  /** Set when the image could not be loaded or processed. */
  error?: string;
}

export interface MatchOptions {
  /** Euclidean distance at or below which a face counts as the user. */
  threshold?: number;
  /** Route remote images through /api/face/image (default true). */
  useProxy?: boolean;
  /** Called after each image finishes, in input order. */
  onResult?: (result: MatchResult, index: number) => void;
  signal?: AbortSignal;
}
