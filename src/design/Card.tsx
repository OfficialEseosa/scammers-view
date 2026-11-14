import type { ElementType, HTMLAttributes } from "react";
import { cn } from "./utils";

/** Surface + hairline, radius 16, padding 24 (16 on phones). Never nest: use <Divider/> inside. */
export function Card({
  as: As = "div",
  className,
  flush,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: ElementType; flush?: boolean }) {
  return <As className={cn("sv-card", !flush && "p-4 sm:p-6", className)} {...rest} />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-edge", className)} />;
}

/** A row of short redaction bars: section divider motif. */
export function RedactedRule({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("flex items-center gap-2", className)}>
      <span className="sv-bar h-2 w-16" />
      <span className="sv-bar h-2 w-6 opacity-60" />
      <span className="h-px flex-1 bg-edge" />
    </div>
  );
}
