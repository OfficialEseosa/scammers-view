import type { ElementType, HTMLAttributes } from "react";
import { cn } from "./utils";

/**
 * The one PRACTICE treatment: wraps a fake message (SMS, email, voicemail, quiz item).
 * Adds a danger-outlined pill top-right and a 6% diagonal repeating word behind the content.
 * The wrapper is its own stacking context, so the watermark sits under the text but over
 * the wrapper's background.
 */
export function PracticeMark({
  as: As = "div",
  className,
  children,
  pill = true,
  ink = "currentColor",
  onLight = false,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: ElementType; pill?: boolean; ink?: string; /** Content sits on a light device screen in either theme. */ onLight?: boolean }) {
  return (
    <As className={cn("relative isolate", className)} {...rest}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
        <div
          className="absolute -inset-1/2 flex rotate-[-24deg] flex-col justify-center gap-8 font-display text-[clamp(1.6rem,7cqw,3.2rem)] font-semibold leading-none tracking-[0.04em] whitespace-nowrap"
          style={{ color: ink, opacity: 0.06 }}
        >
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} style={{ marginLeft: `${(i % 3) * -2}em` }}>
              Practice Practice Practice Practice Practice Practice
            </span>
          ))}
        </div>
      </div>
      {pill && (
        <span
          className={cn(
            "pointer-events-none absolute right-3 top-3 z-10 rounded-full border px-2.5 py-0.5 text-sm font-semibold backdrop-blur-sm",
            onLight ? "border-[#c2321f] bg-white/80 text-[#b22d1b]" : "border-danger bg-canvas/70 text-danger-fg",
          )}
        >
          Practice
        </span>
      )}
      {children}
    </As>
  );
}
