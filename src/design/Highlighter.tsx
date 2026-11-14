import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

/**
 * Highlighter swipe for scam tells: an inverted block that sweeps in (text knocked out).
 * `index` staggers the swipe by 60ms per tell. `tone="personal"` adds a thin danger rule:
 * the tell uses one of your own public facts.
 */
export function Highlight({
  on,
  index = 0,
  tone,
  active,
  children,
  className,
  style,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  on: boolean;
  index?: number;
  tone?: "personal";
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <mark
      data-on={on}
      data-tone={tone}
      data-active={active || undefined}
      className={cn("sv-hl bg-transparent", className)}
      style={{ ["--hl-i" as string]: index, ...style }}
      {...rest}
    >
      {children}
    </mark>
  );
}

/** Props to turn any inline element into a highlighter span. */
export function highlightProps(on: boolean, index = 0, tone?: "personal", active?: boolean) {
  return {
    "data-on": on,
    "data-tone": tone,
    "data-active": active || undefined,
    className: "sv-hl",
    style: { ["--hl-i" as string]: index },
  };
}
