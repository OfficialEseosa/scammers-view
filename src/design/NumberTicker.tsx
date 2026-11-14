"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./motion";

/**
 * Counts up once on first reveal (900ms), then cross-fades on every later change.
 * Reduced motion: shows the value instantly.
 */
export function NumberTicker({
  value,
  duration = 900,
  className,
  style,
}: {
  value: number;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const [fadeKey, setFadeKey] = useState(0);
  const countedUp = useRef(false);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    if (reduced || countedUp.current) {
      const changed = prev.current !== null && prev.current !== value;
      prev.current = value;
      raf = requestAnimationFrame(() => {
        setShown(value);
        if (changed && !reduced) setFadeKey((k) => k + 1);
      });
      return () => cancelAnimationFrame(raf);
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else {
        countedUp.current = true;
        prev.current = value;
      }
    };
    raf = requestAnimationFrame(tick);
    // rAF is paused in background tabs; never leave the number stuck mid-count.
    const settle = window.setTimeout(() => {
      countedUp.current = true;
      prev.current = value;
      setShown(value);
    }, duration + 150);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [value, duration, reduced]);

  return (
    <span className={className} style={style}>
      <span key={fadeKey} className={fadeKey ? "inline-block animate-[sv-tick_320ms_var(--ease-out)_both]" : "inline-block"}>
        {shown}
      </span>
    </span>
  );
}
