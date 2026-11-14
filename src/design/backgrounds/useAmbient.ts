"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Shared plumbing for ambient canvases: runs `frame` on rAF only while the canvas is
 * on screen and the tab is visible; reduced motion draws a single still frame.
 * DPR is capped so phones stay at 60fps.
 */
export function useAmbientLoop(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  setup: (canvas: HTMLCanvasElement) => null | {
    resize: (w: number, h: number, dpr: number) => void;
    frame: (t: number, dt: number) => void;
    dispose?: () => void;
  },
  { maxDpr = 1.5, deps = [] as unknown[] } = {},
) {
  const setupRef = useRef(setup);
  useEffect(() => {
    setupRef.current = setup;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const api = setupRef.current(canvas);
    if (!api) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let visible = true;
    let onScreen = true;
    let last = performance.now();
    let t = 0;

    const size = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      api.resize(Math.max(1, r.width), Math.max(1, r.height), dpr);
      if (reduce.matches) api.frame(t, 0);
    };
    const loop = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      t += dt;
      api.frame(t, dt);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches) {
        api.frame(t, 0);
        return;
      }
      if (visible && onScreen) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      start();
    });
    io.observe(canvas);
    const onVis = () => {
      visible = document.visibilityState === "visible";
      start();
    };
    document.addEventListener("visibilitychange", onVis);
    reduce.addEventListener("change", start);
    size();
    start();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      reduce.removeEventListener("change", start);
      api.dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, maxDpr, ...deps]);
}

/** Reads a CSS colour token as rgba components, re-read when the theme flips. */
export function readColor(name: string, el: Element = document.documentElement): [number, number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.style.display = "none";
  el.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
  return [m[0], m[1], m[2], m[3] ?? 1];
}

export function onThemeChange(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
