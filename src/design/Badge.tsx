import type { ReactNode } from "react";
import { RISK_LABEL, riskLevel, type RiskLevel } from "./risk";
import { cn } from "./utils";

const TINT: Record<RiskLevel, string> = {
  danger: "bg-[var(--danger-tint)] text-danger-fg",
  warn: "bg-[var(--warn-tint)] text-warn-fg",
  safe: "bg-[var(--safe-tint)] text-safe-fg",
};
const DOT: Record<RiskLevel, string> = { danger: "bg-danger", warn: "bg-warn", safe: "bg-safe" };

/** Risk: tint fill + coloured text + dot. Pass `level` or a 0–100 `score`. */
export function RiskBadge({
  level,
  score,
  children,
  className,
}: {
  level?: RiskLevel;
  score?: number;
  children?: ReactNode;
  className?: string;
}) {
  const l = level ?? riskLevel(score ?? 0);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-chip px-2 py-0.5 text-sm font-medium", TINT[l], className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[l])} />
      {children ?? RISK_LABEL[l]}
    </span>
  );
}

/** Just the dot, for dense rows. */
export function RiskDot({ level, className, label }: { level: RiskLevel; className?: string; label?: string }) {
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("inline-block size-2 shrink-0 rounded-full", DOT[level], className)} />;
}

/** Confidence: 3-segment meter, no colour. value 0..1 */
export function ConfidenceMeter({ value, className, showLabel = true }: { value: number; className?: string; showLabel?: boolean }) {
  const n = value >= 0.8 ? 3 : value >= 0.5 ? 2 : 1;
  const word = n === 3 ? "Sure" : n === 2 ? "Likely" : "Maybe";
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-muted", className)} title={`Confidence ${Math.round(value * 100)}%`}>
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("h-2.5 w-1.5 rounded-[1px]", i < n ? "bg-fg" : "bg-edge-strong")} />
        ))}
      </span>
      {showLabel ? word : <span className="sr-only">{word}</span>}
    </span>
  );
}

/** Identity anchor: hairline + small inverse dot. */
export function AnchorBadge({ children, weak, className }: { children: ReactNode; weak?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-chip border border-edge px-2 py-0.5 text-sm", weak ? "text-muted" : "text-fg", className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", weak ? "border border-muted" : "bg-fg")} />
      {children}
    </span>
  );
}

/** Neutral chip for metadata such as effort. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-chip border border-edge px-2 py-0.5 text-sm text-muted", className)}>{children}</span>;
}
