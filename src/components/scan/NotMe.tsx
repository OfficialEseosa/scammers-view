"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Finding } from "@/lib/types";
import { useSession } from "@/state/session";
import { CATEGORY_LABEL, hostOf } from "@/components/scan/meta";
import { Icon3D, CATEGORY_ICON } from "@/design/Icon3D";
import { RedactedValue } from "@/design/RedactedValue";
import { EASE_OUT, usePrefersReducedMotion } from "@/design/motion";
import { cn } from "@/design/utils";

/**
 * "Not me": the user says a finding (an account, a detail, a photo) belongs to someone else.
 * It leaves every list, score and chain at once via session state. Nothing is sent anywhere.
 */

const UNDO_MS = 8000;

export function NotMeButton({ finding, onNotMe, className }: { finding: Finding; onNotMe: (fs: Finding[]) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onNotMe([finding])}
      aria-label={`Not me: hide ${finding.label}`}
      className={cn(
        "sv-press inline-flex min-h-11 shrink-0 items-center rounded-control border border-edge px-3 text-sm font-medium text-muted hover:border-fg hover:text-fg",
        className,
      )}
    >
      Not me
    </button>
  );
}

/** "Hidden. Undo" after marking something; one per screen. */
export function NotMeUndoToast() {
  const { notMeUndo, restoreNotMe, dismissNotMeUndo } = useSession();
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (!notMeUndo) return;
    const t = window.setTimeout(dismissNotMeUndo, UNDO_MS);
    return () => window.clearTimeout(t);
  }, [notMeUndo, dismissNotMeUndo]);
  const n = notMeUndo?.ids.length ?? 0;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6">
      <AnimatePresence>
        {notMeUndo && (
          <motion.div
            key={notMeUndo.at}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.22, ease: EASE_OUT }}
            className="pointer-events-auto flex items-center gap-3 rounded-card border border-edge bg-elevated py-1.5 pl-4 pr-1.5 shadow-pop"
          >
            <span className="text-sm">{n === 1 ? "Hidden as not me." : `${n} hidden as not me.`}</span>
            <button
              type="button"
              onClick={() => restoreNotMe(notMeUndo.ids)}
              className="sv-press min-h-11 rounded-control px-3 text-sm font-semibold underline underline-offset-4 hover:bg-surface"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={dismissNotMeUndo}
              aria-label="Dismiss"
              className="sv-press grid size-11 place-items-center rounded-control text-muted hover:bg-surface hover:text-fg"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "Hidden as not me (N)": review and restore. Renders nothing until something is hidden. */
export function HiddenNotMe({ masked, className }: { masked: boolean; className?: string }) {
  const { notMe, restoreNotMe } = useSession();
  if (!notMe.length) return null;
  return (
    <details className={cn("group rounded-card border border-edge", className)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-fg [&::-webkit-details-marker]:hidden">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">
          <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Hidden as not me ({notMe.length})
      </summary>
      <div className="border-t border-edge">
        <p className="px-4 pt-3 text-sm text-muted">Left out of your score, map, fixes and practice. Saved with your results.</p>
        <ul className="divide-y divide-edge">
          {notMe.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2">
              {f.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts
                <img src={f.imageUrl} alt="" referrerPolicy="no-referrer" className={cn("size-9 shrink-0 rounded-control object-cover", masked && "blur-sm grayscale")} />
              ) : (
                <Icon3D name={CATEGORY_ICON[f.category]} size={30} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-muted">
                  {f.label || CATEGORY_LABEL[f.category]} · {hostOf(f.sourceUrl)}
                </span>
                <span className="block truncate">
                  <RedactedValue value={f.value} redacted={masked} label={f.label} />
                </span>
              </span>
              <button
                type="button"
                onClick={() => restoreNotMe([f.id])}
                aria-label={`Restore ${f.label}`}
                className="sv-press min-h-11 shrink-0 rounded-control border border-edge px-3 text-sm font-medium hover:border-fg"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
        {notMe.length > 1 && (
          <div className="border-t border-edge px-4 py-2">
            <button
              type="button"
              onClick={() => restoreNotMe(notMe.map((f) => f.id))}
              className="min-h-11 text-sm text-muted underline underline-offset-4 hover:text-fg"
            >
              Restore all
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
