"use client";

import "./consent.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/design/Button";
import { cn } from "@/design/utils";

/** How close the pointer has to be before the button starts to react, in px. */
const REACH = 420;

/**
 * Every box must be ticked before "Scan me" enables. Submits to the grantConsent server action.
 * Ticking a box sends a shockwave through the dot background, and once all are ticked the
 * button grows and shakes harder the closer the pointer gets.
 */
export function ConsentForm({ items, action }: { items: ReactNode[]; action: (fd: FormData) => void | Promise<void> }) {
  const [ticked, setTicked] = useState<boolean[]>(() => items.map(() => false));
  const [flinch, setFlinch] = useState<number | null>(null);
  const all = ticked.every(Boolean);
  const dread = useRef<HTMLSpanElement | null>(null);

  // Pointer distance drives --i directly on the element: no re-render per mouse move.
  useEffect(() => {
    const el = dread.current;
    if (!el) return;
    if (!all) {
      el.style.setProperty("--i", "0");
      el.dataset.near = "false";
      return;
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      const i = Math.max(0, 1 - Math.hypot(dx, dy) / REACH);
      // Ease in, so it stays calm at a distance and spikes at the end.
      const eased = i * i;
      el.style.setProperty("--i", eased.toFixed(3));
      el.dataset.near = eased > 0.02 ? "true" : "false";
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [all]);

  const tick = (i: number, checked: boolean, at: { x: number; y: number }) => {
    setTicked((t) => t.map((v, k) => (k === i ? checked : v)));
    setFlinch(i);
    window.setTimeout(() => setFlinch((f) => (f === i ? null : f)), 400);
    // The dot background listens for this and pushes a ring outward from the click.
    window.dispatchEvent(new CustomEvent("sv:ripple", { detail: { ...at, strength: checked ? 1 : 0.5 } }));
  };

  return (
    <form action={action} className="flex flex-col gap-8">
      <fieldset className="flex flex-col divide-y divide-edge border-y border-edge">
        <legend className="sr-only">Agree to each before scanning</legend>
        {items.map((it, i) => (
          <label
            key={i}
            className={cn("flex min-h-[4.5rem] cursor-pointer items-center gap-4 py-3 text-lg hover:text-fg", !ticked[i] && "text-muted", flinch === i && "sv-flinch")}
          >
            <input
              type="checkbox"
              required
              checked={ticked[i]}
              onChange={(e) => {
                const r = e.target.closest("label")?.getBoundingClientRect();
                tick(i, e.target.checked, { x: r ? r.left + 14 : window.innerWidth / 2, y: r ? r.top + r.height / 2 : window.innerHeight / 2 });
              }}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-[7px] border-2 border-edge-strong text-canvas transition-colors duration-150 peer-checked:border-fg peer-checked:bg-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
            >
              <svg width="16" height="16" viewBox="0 0 12 12" className={cn("transition-[opacity,transform] duration-150", ticked[i] ? "scale-100 opacity-100" : "scale-75 opacity-0")}>
                <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className={cn("transition-colors", ticked[i] && "text-fg")}>{it}</span>
          </label>
        ))}
      </fieldset>
      <span ref={dread} className="sv-dread" data-hot={all} data-near="false">
        <Button type="submit" size="lg" disabled={!all}>
          Scan me
        </Button>
      </span>
    </form>
  );
}
