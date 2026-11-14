"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Box } from "./model";

const DURATION = 700;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * Glides existing boxes to their new layout positions instead of jumping.
 * New ids appear at their target immediately (they pop in via CSS).
 */
export function useTweenedBoxes(target: Map<string, Box>, reduced: boolean): Map<string, Box> {
  const [current, setCurrent] = useState(target);
  const currentRef = useRef(current);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    const from = currentRef.current;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const p = reduced ? 1 : Math.min(1, (now - t0) / DURATION);
      const k = ease(p);
      const next = new Map<string, Box>();
      for (const [id, b] of target) {
        const a = from.get(id);
        next.set(
          id,
          a ? { ...b, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k } : b,
        );
      }
      setCurrent(next);
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  return current;
}
