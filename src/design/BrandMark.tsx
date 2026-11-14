import Link from "next/link";
import { LogoLockup, LogoMark } from "@/design/brand/Logo";
import { cn } from "./utils";

/** The app's logo link. One place to swap the mark. */
export function BrandMark({ compact = false, size = 30, className }: { compact?: boolean; size?: number; className?: string }) {
  return (
    <Link href="/" aria-label="Scammer's View, home" className={cn("inline-flex items-center font-display text-fg", className)}>
      {compact ? (
        <>
          <span className="sm:hidden">
            <LogoMark size={size} title="" />
          </span>
          <span className="max-sm:hidden">
            <LogoLockup size={size} />
          </span>
        </>
      ) : (
        <LogoLockup size={size} />
      )}
    </Link>
  );
}
