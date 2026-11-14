"use client";

import { useEffect, useRef } from "react";
import { cn } from "../utils";
import { onThemeChange, readColor, useAmbientLoop } from "./useAmbient";

/**
 * Dot-matrix field. Dots near the pointer brighten; `activity` (0..1) sends slow
 * ripples across the grid, e.g. while a scan is running. One canvas, DPR capped.
 */
export function DotField({
  className,
  gap = 22,
  activity = 0,
  interactive = true,
  fade = "radial",
}: {
  className?: string;
  gap?: number;
  activity?: number;
  interactive?: boolean;
  fade?: "radial" | "bottom" | "none";
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const activityRef = useRef(activity);
  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  useAmbientLoop(ref, (canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let base = readColor("--dot");
    let hot = readColor("--dot-hot");
    const stopTheme = onThemeChange(() => {
      base = readColor("--dot");
      hot = readColor("--dot-hot");
    });
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.tx = e.clientX - r.left;
      pointer.ty = e.clientY - r.top;
    };
    const onLeave = () => {
      pointer.tx = -9999;
      pointer.ty = -9999;
    };
    if (interactive) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
    }
    const ripples: { x: number; y: number; t0: number }[] = [];
    let nextRipple = 0;
    // The resting grid is drawn once into a bitmap; frames only repaint the dots the
    // pointer or a ripple is touching, and skip entirely when nothing moves.
    const still = document.createElement("canvas");
    const sctx = still.getContext("2d");
    let dirty = true;
    let lastPx = NaN;
    let lastPy = NaN;
    const fadeAt = (x: number, y: number) => {
      if (fade === "radial") return 1 - Math.min(1, Math.hypot(x - w / 2, y - h / 2) / Math.hypot(w / 2, h / 2)) * 0.75;
      if (fade === "bottom") return 1 - (y / h) * 0.85;
      return 1;
    };
    const dot = (c: CanvasRenderingContext2D, x: number, y: number, k: number) => {
      const a = (base[3] + (hot[3] - base[3]) * k) * fadeAt(x, y);
      const rr = base[0] + (hot[0] - base[0]) * k;
      const gg = base[1] + (hot[1] - base[1]) * k;
      const bb = base[2] + (hot[2] - base[2]) * k;
      c.fillStyle = `rgba(${rr | 0},${gg | 0},${bb | 0},${a.toFixed(3)})`;
      const s = 1.1 + k * 1.1;
      c.fillRect(x - s / 2, y - s / 2, s, s);
    };
    const drawStill = () => {
      if (!sctx) return;
      still.width = canvas.width;
      still.height = canvas.height;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let y = gap / 2; y < h; y += gap) for (let x = gap / 2; x < w; x += gap) dot(sctx, x, y, 0);
    };
    const stopTheme2 = onThemeChange(() => {
      drawStill();
      dirty = true;
    });

    return {
      resize(nw, nh, nd) {
        w = nw;
        h = nh;
        dpr = nd;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawStill();
        dirty = true;
      },
      frame(t) {
        pointer.x += (pointer.tx - pointer.x) * 0.18;
        pointer.y += (pointer.ty - pointer.y) * 0.18;
        if (pointer.tx < -9000) {
          pointer.x = pointer.tx;
          pointer.y = pointer.ty;
        }
        const act = activityRef.current;
        if (act > 0 && t > nextRipple) {
          ripples.push({ x: Math.random() * w, y: Math.random() * h, t0: t });
          nextRipple = t + 1400 / act;
        }
        while (ripples.length && t - ripples[0].t0 > 2600) ripples.shift();

        const moved = Math.abs(pointer.x - lastPx) > 0.3 || Math.abs(pointer.y - lastPy) > 0.3;
        if (!dirty && !moved && !ripples.length) return;
        dirty = false;
        lastPx = pointer.x;
        lastPy = pointer.y;

        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(still, 0, 0, w, h);
        const PR = 150;
        // Only cells inside the pointer's reach, or every cell while ripples run.
        let x0 = gap / 2;
        let x1 = w;
        let y0 = gap / 2;
        let y1 = h;
        if (!ripples.length) {
          if (pointer.x < -9000) return;
          x0 = gap / 2 + Math.max(0, Math.ceil((pointer.x - PR - gap / 2) / gap)) * gap;
          y0 = gap / 2 + Math.max(0, Math.ceil((pointer.y - PR - gap / 2) / gap)) * gap;
          x1 = Math.min(w, pointer.x + PR);
          y1 = Math.min(h, pointer.y + PR);
        }
        for (let y = y0; y < y1; y += gap) {
          for (let x = x0; x < x1; x += gap) {
            let k = 0;
            const dp = Math.hypot(x - pointer.x, y - pointer.y);
            if (dp < PR) k = 1 - dp / PR;
            for (const r of ripples) {
              const age = (t - r.t0) / 2600;
              const radius = age * 340;
              const d = Math.abs(Math.hypot(x - r.x, y - r.y) - radius);
              if (d < 26) k = Math.max(k, (1 - d / 26) * (1 - age) * 0.8);
            }
            if (k <= 0) continue;
            ctx.clearRect(x - 3, y - 3, 6, 6);
            dot(ctx, x, y, k);
          }
        }
      },
      dispose() {
        stopTheme();
        stopTheme2();
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
      },
    };
  });

  return <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}
