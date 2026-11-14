"use client";

import { useState } from "react";
import { cn } from "./utils";

const DOT = "•";

function placeholderFor(value: string) {
  // Same rough width as the value, never the value itself.
  const n = Math.max(4, Math.min(value.length, 28));
  return DOT.repeat(n);
}

/**
 * A found value. When `redacted`, it is a solid bar (the real value is not in the DOM).
 * Lifting it plays the reveal: the bar wipes away and the text sharpens from a 4px blur.
 * `peek` lets a hover / tap lift it temporarily (landing specimen only).
 */
export function RedactedValue({
  value,
  redacted,
  peek = false,
  mono = true,
  className,
  label = "Hidden",
}: {
  value: string;
  redacted: boolean;
  peek?: boolean;
  mono?: boolean;
  className?: string;
  label?: string;
}) {
  const [lifted, setLifted] = useState(false);
  const shown = !redacted || (peek && lifted);
  const text = shown ? value : placeholderFor(value);
  const peekProps = peek
    ? {
        tabIndex: 0,
        role: "button" as const,
        "aria-pressed": lifted,
        "aria-label": shown ? value : `${label}. Press to reveal`,
        onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && setLifted(true),
        onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && setLifted(false),
        onClick: () => setLifted((l) => !l),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setLifted((l) => !l);
          }
        },
      }
    : {};
  return (
    <span
      className={cn("sv-redact", mono && "sv-evidence", peek && "cursor-pointer", className)}
      data-state={shown ? "shown" : "hidden"}
      {...peekProps}
    >
      <span className="sv-redact-text" aria-hidden={!shown && !peek ? true : undefined}>
        {text}
      </span>
      {!shown && !peek && <span className="sr-only">{label}</span>}
      <span className="sv-redact-bar" aria-hidden />
    </span>
  );
}

/** Decorative: a line of redacted text of a given width (skeletons, hero motif). */
export function RedactedLine({ width = "100%", className }: { width?: string | number; className?: string }) {
  return <span aria-hidden className={cn("sv-bar", className)} style={{ width }} />;
}
