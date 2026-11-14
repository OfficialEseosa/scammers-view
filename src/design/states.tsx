import type { ReactNode } from "react";
import { cn } from "./utils";

/** Loading placeholder shaped like content: redacted lines. */
export function Skeleton({ className, lines, label = "Loading" }: { className?: string; lines?: number; label?: string }) {
  if (lines) {
    const widths = ["92%", "78%", "86%", "64%", "88%", "70%"];
    return (
      <div role="status" aria-label={label} className={cn("flex flex-col gap-2.5", className)}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="sv-skeleton block h-3.5" style={{ width: widths[i % widths.length] }} />
        ))}
      </div>
    );
  }
  return <div role="status" aria-label={label} className={cn("sv-skeleton", className)} />;
}

/** A card-shaped skeleton for lazy panels. */
export function PanelSkeleton({ className, label }: { className?: string; label: string }) {
  return (
    <div role="status" aria-label={label} className={cn("sv-card flex flex-col gap-4 p-6", className)}>
      <span className="sv-skeleton block h-7 w-1/3" />
      <span className="sv-skeleton block h-3.5 w-3/4" />
      <span className="sv-skeleton block h-3.5 w-2/3" />
      <span className="sv-skeleton mt-2 block min-h-24 flex-1" />
    </div>
  );
}

/** Empty: one sentence + one action. */
export function EmptyState({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-4 rounded-card border border-dashed border-edge-strong p-6 text-muted", className)}>
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Error: what failed + retry. No apologies. */
export function ErrorState({ title, detail, action, className }: { title: string; detail?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("rounded-card border border-danger/60 bg-surface p-5", className)}>
      <p className="flex items-center gap-2 font-display text-lg font-semibold">
        <span aria-hidden className="size-2 rounded-full bg-danger" />
        {title}
      </p>
      {detail && <p className="mt-1 text-muted">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Warning line: warn colour with an icon, never colour alone. */
export function WarnNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-warn-fg", className)}>
      <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden className="mt-0.5 shrink-0">
        <path d="M10 2.5 18.5 17h-17z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M10 8v4.2M10 14.6v.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
