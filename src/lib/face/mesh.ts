import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { VisionModule } from "./landmarker";

/** Drawing for the 478-point "3D scan" mesh overlay. */

const MESH = "rgba(111, 209, 192, 0.38)"; // --calm
const CONTOUR = "rgba(111, 209, 192, 0.95)";
const IRIS = "rgba(242, 180, 65, 0.95)"; // --amber

export type Connection = { start: number; end: number };

export function meshConnections(vision: VisionModule) {
  const F = vision.FaceLandmarker;
  return {
    tess: F.FACE_LANDMARKS_TESSELATION,
    contours: [
      ...F.FACE_LANDMARKS_FACE_OVAL,
      ...F.FACE_LANDMARKS_LEFT_EYE,
      ...F.FACE_LANDMARKS_RIGHT_EYE,
      ...F.FACE_LANDMARKS_LEFT_EYEBROW,
      ...F.FACE_LANDMARKS_RIGHT_EYEBROW,
      ...F.FACE_LANDMARKS_LIPS,
    ],
    irises: [...F.FACE_LANDMARKS_LEFT_IRIS, ...F.FACE_LANDMARKS_RIGHT_IRIS],
  };
}

/** One stroke() per layer keeps ~2,500 segments cheap enough for phones. */
export function drawMesh(
  ctx: CanvasRenderingContext2D,
  faces: NormalizedLandmark[][],
  tess: Connection[],
  contours: Connection[],
  irises: Connection[],
  scanPhase: number,
) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  const unit = Math.max(1, w / 640);

  for (const lm of faces) {
    const stroke = (conns: Connection[], color: string, width: number) => {
      ctx.beginPath();
      for (const c of conns) {
        const a = lm[c.start];
        const b = lm[c.end];
        if (!a || !b) continue;
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    stroke(tess, MESH, 0.7 * unit);
    stroke(contours, CONTOUR, 1.6 * unit);
    stroke(irises, IRIS, 1.6 * unit);

    // Vertices, with a band of brighter points sweeping down the face.
    let minY = 1;
    let maxY = 0;
    for (const p of lm) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const bandY = minY + (maxY - minY) * scanPhase;
    const r = 1.1 * unit;
    for (const p of lm) {
      const near = Math.abs(p.y - bandY) < (maxY - minY) * 0.04;
      ctx.fillStyle = near ? "rgba(239, 234, 223, 0.95)" : "rgba(111, 209, 192, 0.7)";
      ctx.fillRect(p.x * w - r, p.y * h - r, r * 2, r * 2);
    }
  }
}
