"use client";

import { useRef, useState } from "react";
import { loadImageForFaces } from "@/lib/face/image";
import { createFaceLandmarker } from "@/lib/face/landmarker";
import { drawMesh, meshConnections } from "@/lib/face/mesh";
import { estimateYawDeg, geometricYawOffset, matrixYawDeg } from "@/lib/face/pose";

/**
 * DEV HARNESS ONLY: runs the Face Landmarker on a still image so model
 * loading, mesh drawing and yaw estimation can be checked without a camera.
 * Shown mirrored, like the live preview.
 */
export function MeshStillTest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState("");
  const [out, setOut] = useState<string>("");

  async function run() {
    setOut("Loading…");
    try {
      const t0 = performance.now();
      const { landmarker, vision } = await createFaceLandmarker("IMAGE");
      const t1 = performance.now();
      const img = await loadImageForFaces(url);
      const result = landmarker.detect(img);
      const canvas = canvasRef.current!;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      const { tess, contours, irises } = meshConnections(vision);
      drawMesh(ctx, result.faceLandmarks, tess, contours, irises, 0.5);
      ctx.globalCompositeOperation = "destination-over";
      ctx.globalAlpha = 0.6;
      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      const faces = result.faceLandmarks.map((lm, i) => {
        const m = result.facialTransformationMatrixes?.[i]?.data;
        return {
          points: lm.length,
          yawDeg: Number(estimateYawDeg(lm, m).toFixed(1)),
          matrixYawAbs: Number((matrixYawDeg(m) ?? NaN).toFixed(1)),
          geometricOffset: Number(geometricYawOffset(lm).toFixed(3)),
        };
      });
      landmarker.close();
      setOut(JSON.stringify({ modelLoadMs: Math.round(t1 - t0), faces }));
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-2">
        <span className="text-sm text-muted">Mesh + yaw on a still image URL (positive yaw = subject turned to their left)</span>
        <input
          name="mesh-url"
          className="rounded-xl border border-edge bg-surface p-3 font-mono text-sm"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <button type="button" className="min-h-11 self-start rounded-xl border border-edge-strong px-4" onClick={() => void run()}>
        Draw mesh
      </button>
      <p className="font-mono text-xs" data-testid="mesh-out">{out}</p>
      <canvas ref={canvasRef} className="w-full max-w-md -scale-x-100 rounded-xl bg-surface" />
    </div>
  );
}
