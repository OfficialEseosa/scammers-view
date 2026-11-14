/**
 * Head yaw from a MediaPipe Face Landmarker result.
 *
 * Positive yaw = the user turned to THEIR left; negative = their right.
 *
 * The magnitude comes from the facial transformation matrix when available
 * (a real 3D pose), and the sign always comes from geometry (nose tip vs.
 * the midpoint of the cheeks in the raw, unmirrored camera image), so the
 * direction never depends on matrix conventions. In the raw image the
 * user's left side is on the image's right, so turning left moves the nose
 * toward larger x.
 */

interface Pt {
  x: number;
  y: number;
  z?: number;
}

const NOSE_TIP = 1;
const CHEEK_RIGHT_IMG_LEFT = 234; // left side of the raw image
const CHEEK_LEFT_IMG_RIGHT = 454; // right side of the raw image

export function geometricYawOffset(landmarks: Pt[]): number {
  const nose = landmarks[NOSE_TIP];
  const a = landmarks[CHEEK_RIGHT_IMG_LEFT];
  const b = landmarks[CHEEK_LEFT_IMG_RIGHT];
  if (!nose || !a || !b) return 0;
  const mid = (a.x + b.x) / 2;
  const half = Math.abs(b.x - a.x) / 2;
  if (half < 1e-6) return 0;
  return (nose.x - mid) / half; // roughly -1..1
}

/** Column-major 4x4 matrix → yaw magnitude in degrees. */
export function matrixYawDeg(data: ArrayLike<number> | undefined): number | null {
  if (!data || data.length < 16) return null;
  // |sin(yaw)| is R02 in column-major and -R20 in row-major; data[8] is one
  // of those either way, so the magnitude does not depend on the layout.
  // Normalise by the column scale in case the matrix carries scale.
  const scale = Math.hypot(data[0], data[1], data[2]) || 1;
  const s = Math.max(-1, Math.min(1, data[8] / scale));
  return (Math.abs(Math.asin(s)) * 180) / Math.PI;
}

export function estimateYawDeg(landmarks: Pt[], matrix?: ArrayLike<number>): number {
  const offset = geometricYawOffset(landmarks);
  const sign = offset >= 0 ? 1 : -1;
  const fromMatrix = matrixYawDeg(matrix);
  if (fromMatrix !== null && Number.isFinite(fromMatrix)) return sign * fromMatrix;
  // Fallback: the nose protrudes, so offset ≈ 1.6·sin(yaw) in practice.
  const s = Math.max(-1, Math.min(1, offset / 1.6));
  return (Math.asin(s) * 180) / Math.PI;
}
