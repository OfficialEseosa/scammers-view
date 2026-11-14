import { cn } from "../utils";

export { DotField } from "./DotField";
export { LiquidField } from "./LiquidField";

/** Fine film grain over the whole page (CSS only). Render once per page. */
export function Grain() {
  return <div aria-hidden className="sv-grain" />;
}

/** A thin bright line sweeping down a container while something is scanning. */
export function ScanSweep({ active, className }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="absolute inset-x-0 h-24 animate-[sv-scanline_3.2s_var(--ease-in-out)_infinite] bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--text)_7%,transparent)_85%,color-mix(in_srgb,var(--text)_30%,transparent))] motion-reduce:hidden" />
    </div>
  );
}
