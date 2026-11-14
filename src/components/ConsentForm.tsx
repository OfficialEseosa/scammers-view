"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/design/Button";
import { cn } from "@/design/utils";

/** Every box must be ticked before "Scan me" enables. Submits to the grantConsent server action. */
export function ConsentForm({ items, action }: { items: ReactNode[]; action: (fd: FormData) => void | Promise<void> }) {
  const [ticked, setTicked] = useState<boolean[]>(() => items.map(() => false));
  const all = ticked.every(Boolean);
  return (
    <form action={action} className="flex flex-col gap-8">
      <fieldset className="flex flex-col divide-y divide-edge border-y border-edge">
        <legend className="sr-only">Agree to each before scanning</legend>
        {items.map((it, i) => (
          <label key={i} className={cn("flex min-h-[4.5rem] cursor-pointer items-center gap-4 py-3 text-lg hover:text-fg", !ticked[i] && "text-muted")}>
            <input
              type="checkbox"
              required
              checked={ticked[i]}
              onChange={(e) => setTicked((t) => t.map((v, k) => (k === i ? e.target.checked : v)))}
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
      <Button type="submit" size="lg" disabled={!all} className="self-start">
        Scan me
      </Button>
    </form>
  );
}
