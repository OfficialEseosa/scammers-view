"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brand } from "@/components/Brand";
import { useSession } from "@/state/session";
import { DemoScript } from "@/components/session/DemoScript";
import { OwnerReset } from "@/components/session/OwnerReset";
import { ThemeToggle } from "@/design/ThemeToggle";
import { Button } from "@/design/Button";
import { EASE_OUT } from "@/design/motion";

export function PresentationToggle() {
  const { masked, setMasked } = useSession();
  return (
    <label className="sv-press flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full border border-edge px-2.5 hover:border-edge-strong sm:px-3.5">
      <input type="checkbox" role="switch" className="peer sr-only" checked={masked} onChange={(e) => setMasked(e.target.checked)} />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full border border-edge-strong transition-colors peer-checked:border-fg peer-checked:bg-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:left-0.5 after:top-0.5 after:size-3.5 after:rounded-full after:bg-fg after:transition-transform after:duration-200 peer-checked:after:translate-x-4 peer-checked:after:bg-canvas"
      />
      <span className="text-sm font-medium">
        <span className="sm:hidden">Mask</span>
        <span className="hidden sm:inline">Mask</span>
      </span>
    </label>
  );
}

export function FaceBadge() {
  const { face } = useSession();
  if (face === "pending") return null;
  const on = face === "verified";
  return (
    <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-edge px-2.5 text-sm max-sm:hidden" title={on ? "Face match on" : "Face match off"}>
      <span aria-hidden className={`size-2 rounded-full ${on ? "bg-safe" : "border border-muted"}`} />
      <span className="max-sm:sr-only">{on ? "Face match" : "No face match"}</span>
    </span>
  );
}

/** Shown when results came from this device: when they were scanned, and a way to scan again. */
export function SavedScanChip() {
  const { scan, mock } = useSession();
  const [now] = useState(() => Date.now());
  const [left, setLeft] = useState<number | null>(null);
  const cached = Boolean(scan.cachedAt);
  useEffect(() => {
    if (!cached || mock) return;
    let off = false;
    fetch("/api/scan/quota", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((q: { remaining?: number; unlimited?: boolean } | null) => {
        if (!off && q && !q.unlimited && typeof q.remaining === "number") setLeft(q.remaining);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [cached, mock]);
  if (!scan.cachedAt) return null;
  const mins = Math.max(0, Math.round((now - scan.cachedAt) / 60000));
  const age = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
  return (
    <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-edge pl-2.5 pr-1 text-sm max-md:hidden">
      <span className="text-muted">Scanned {age}</span>
      <button
        type="button"
        className="sv-press min-h-7 rounded-full border border-edge-strong px-2.5 font-medium hover:border-fg disabled:cursor-not-allowed disabled:opacity-45"
        onClick={scan.restart}
        disabled={left === 0}
        title={left === 0 ? "No scans left today" : undefined}
      >
        {left === null ? "Rescan" : left === 0 ? "No scans left today" : `Rescan · ${left} left`}
      </button>
    </span>
  );
}

export function SessionBar() {
  const { subjectName, mock, masked, endSession, ending, endError } = useSession();
  const [confirming, setConfirming] = useState(false);
  const shownName = masked ? subjectName.split(" ")[0] : subjectName;

  return (
    <header className="relative z-40 border-b border-edge bg-canvas">
      <div className="mx-auto flex w-full max-w-[96rem] items-center gap-2 px-3 py-2 sm:gap-4 sm:px-6">
        <Brand compact />
        <p className="hidden min-w-0 items-center gap-2 text-muted md:flex">
          <span className="h-4 w-px bg-edge" aria-hidden />
          <span className="truncate">{shownName}</span>
          {mock && <span className="rounded-chip border border-edge px-1.5 py-0.5 text-sm">Demo data</span>}
        </p>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
          <OwnerReset />
          <SavedScanChip />
          <FaceBadge />
          <PresentationToggle />
          <ThemeToggle />
          <DemoScript />
          <Button variant="destructive" size="sm" onClick={() => setConfirming((c) => !c)} aria-expanded={confirming} className="rounded-full max-sm:px-3">
            <span className="sm:hidden">End</span>
            <span className="hidden sm:inline">End session</span>
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {confirming && (
          <motion.div
            role="dialog"
            aria-label="End session"
            className="overflow-hidden border-t border-edge bg-surface"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE_OUT }}
          >
            <div className="mx-auto flex w-full max-w-[96rem] flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
              <p className="font-display text-lg font-semibold">Delete everything from this session?</p>
              {endError && (
                <p role="alert" className="basis-full text-danger-fg sm:order-last">
                  {endError}
                </p>
              )}
              <div className="ml-auto flex gap-3">
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  Keep going
                </Button>
                <Button variant="destructive" disabled={ending} onClick={endSession}>
                  {ending ? "Deleting" : "Delete and end"}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
