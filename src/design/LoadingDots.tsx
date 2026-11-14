"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/design/motion";
import { cn } from "@/design/utils";

const STEP_MS = 400;

/**
 * Trailing ". .. ..." after a waiting label. Reserves the width of three dots so the
 * text never shifts, is hidden from screen readers (the label carries the meaning)
 * and holds a static "..." under reduced motion.
 */
export function LoadingDots({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const [n, setN] = useState(1);
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setN((x) => (x % 3) + 1), STEP_MS);
    return () => window.clearInterval(id);
  }, [reduced]);
  return (
    <span aria-hidden="true" className={cn("relative inline-block", className)}>
      <span className="invisible">...</span>
      <span className="absolute left-0 top-0">{reduced ? "..." : ".".repeat(n)}</span>
    </span>
  );
}
