"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession, type Session } from "@/state/session";

/**
 * Presenter remote for the 90-second pitch. Keys 1 to 5 (or the stepper) jump
 * straight to each beat so nobody hunts for UI on stage.
 */

interface Beat {
  key: string;
  label: string;
  run: (s: Session, later: (fn: () => void, ms: number) => void) => void;
}

const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);

const BEATS: Beat[] = [
  {
    key: "1",
    label: "Live scan",
    run: (s) => {
      if (s.stage === "face" && s.face === "pending") s.setFace("skipped");
      s.setStage("live");
      window.scrollTo({ top: 0 });
    },
  },
  {
    key: "2",
    label: "Attack map, play a chain",
    run: (s, later) => {
      s.unlock();
      s.setStage("results");
      s.setTab("map");
      later(() => q<HTMLButtonElement>('[data-panel="map"] .am-rail-play')?.click(), 1100);
    },
  },
  {
    key: "3",
    label: "Practice voicemail",
    run: (s, later) => {
      s.unlock();
      s.setStage("results");
      s.setTab("practice");
      later(() => q<HTMLElement>("#voicemail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    },
  },
  {
    key: "4",
    label: "Tick two fixes",
    run: (s, later) => {
      s.setStage("results");
      s.setTab("fixes");
      later(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
      const tick = () => q<HTMLButtonElement>('[data-panel="fixes"] ol button[role="switch"][aria-checked="false"]')?.click();
      later(tick, 700);
      later(tick, 1700);
    },
  },
  {
    key: "5",
    label: "Score drop, chain cut",
    run: (s) => {
      s.unlock();
      s.setStage("results");
      s.setTab("map");
    },
  },
];

export function DemoScript() {
  const session = useSession();
  const ref = useRef(session);
  useEffect(() => {
    ref.current = session;
  });
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const go = useCallback((b: Beat) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setLast(b.key);
    b.run(ref.current, (fn, ms) => timers.current.push(window.setTimeout(fn, ms)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const b = BEATS.find((x) => x.key === e.key);
      if (b && ref.current.stage !== "ended") {
        e.preventDefault();
        go(b);
      }
    };
    window.addEventListener("keydown", onKey);
    const t = timers.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      t.forEach(clearTimeout);
    };
  }, [go]);

  return (
    <div className="relative max-sm:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="sv-press min-h-11 rounded-full border border-edge px-3.5 text-sm font-medium text-muted hover:border-edge-strong hover:text-fg"
        title="Demo script (keys 1 to 5)"
      >
        Demo
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 origin-top-right animate-[sv-enter_180ms_var(--ease-out)_both] rounded-card border border-edge bg-elevated p-2 shadow-pop">
          <ol>
            {BEATS.map((b) => (
              <li key={b.key}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    go(b);
                  }}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left transition-colors hover:bg-surface ${last === b.key ? "font-semibold text-fg" : "text-muted"}`}
                >
                  <kbd className={`grid size-7 place-items-center rounded-chip border font-display text-sm ${last === b.key ? "border-fg bg-fg text-canvas" : "border-edge"}`}>{b.key}</kbd>
                  {b.label}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
