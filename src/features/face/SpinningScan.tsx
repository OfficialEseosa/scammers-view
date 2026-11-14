"use client";

import { useEffect, useRef } from "react";
import type { Connection } from "@/lib/face/mesh";

export type ScanPoint = { x: number; y: number; z: number };

/**
 * The captured face mesh, turning slowly in 3D. Shown while the frames are
 * being matched, so the wait is the person's own scan instead of a spinner.
 * Points come from the front capture and live only in memory.
 */
export function SpinningScan({
  points,
  tess,
  contours,
  aspect,
  className,
}: {
  points: ScanPoint[];
  tess: Connection[];
  contours: Connection[];
  /** Video width / height, to undo the normalised coordinates. */
  aspect: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || points.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const ink = getComputedStyle(canvas).color || "rgb(255,255,255)";

    // Centre the head and scale it to a unit box. MediaPipe's z uses the same
    // scale as x, so both are multiplied by the aspect ratio.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of points) {
      cx += p.x * aspect;
      cy += p.y;
      cz += p.z * aspect;
    }
    cx /= points.length;
    cy /= points.length;
    cz /= points.length;
    let radius = 0;
    const model = points.map((p) => {
      const x = p.x * aspect - cx;
      const y = p.y - cy;
      const z = p.z * aspect - cz;
      radius = Math.max(radius, Math.hypot(x, y));
      // The preview is mirrored, so mirror the model to match what they saw.
      return { x: -x, y, z };
    });
    const norm = radius || 1;

    const sx = new Float32Array(model.length);
    const sy = new Float32Array(model.length);
    const sd = new Float32Array(model.length);
    let raf = 0;
    let start = 0;

    const draw = (now: number) => {
      if (!start) start = now;
      const t = (now - start) / 1000;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      // Swing side to side rather than a full turn: the back of a face mesh is empty.
      const yaw = reduce ? 0.45 : Math.sin(t * 1.15) * 1.05;
      const pitch = reduce ? -0.08 : Math.sin(t * 0.6) * 0.12 - 0.05;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosX = Math.cos(pitch);
      const sinX = Math.sin(pitch);
      const size = Math.min(w, h) * 0.4;
      const camera = 3.2;

      for (let i = 0; i < model.length; i++) {
        const p = model[i];
        const x = p.x / norm;
        const y = p.y / norm;
        const z = p.z / norm;
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        const k = camera / (camera + z2);
        sx[i] = w / 2 + x1 * size * k;
        sy[i] = h / 2 + y2 * size * k;
        sd[i] = z2;
      }

      const stroke = (conns: Connection[], alpha: number, width: number) => {
        ctx.beginPath();
        for (const c of conns) {
          if (c.start >= model.length || c.end >= model.length) continue;
          ctx.moveTo(sx[c.start], sy[c.start]);
          ctx.lineTo(sx[c.end], sy[c.end]);
        }
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = ink;
        ctx.lineWidth = width * dpr;
        ctx.stroke();
      };
      stroke(tess, 0.22, 0.6);
      stroke(contours, 0.95, 1.4);

      // Points, brighter toward the viewer, with a band sweeping down the face.
      const band = reduce ? 0.5 : (t * 0.55) % 1;
      const bandY = h / 2 + (band * 2 - 1) * size;
      ctx.fillStyle = ink;
      const r = 1.1 * dpr;
      for (let i = 0; i < model.length; i++) {
        const near = Math.abs(sy[i] - bandY) < size * 0.07;
        ctx.globalAlpha = near ? 1 : Math.max(0.18, 0.62 - sd[i] * 0.5);
        const rr = near ? r * 1.6 : r;
        ctx.fillRect(sx[i] - rr, sy[i] - rr, rr * 2, rr * 2);
      }
      ctx.globalAlpha = 1;

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [points, tess, contours, aspect]);

  return <canvas ref={ref} className={`text-fg ${className ?? ""}`} aria-hidden="true" />;
}
