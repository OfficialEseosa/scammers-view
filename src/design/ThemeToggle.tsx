"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_KEY } from "./theme-script";
import { cn } from "./utils";

type Theme = "dark" | "light";

function read(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

export function setTheme(next: Theme) {
  const root = document.documentElement;
  const apply = () => {
    if (next === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#ffffff" : "#000000");
  };
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !reduce) doc.startViewTransition(apply);
  else apply();
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);
  return [theme, useCallback((t: Theme) => setTheme(t), [])];
}

/** Black / white switch. Separate from presentation (masking) mode on purpose. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, set] = useTheme();
  const light = theme === "light";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={light}
      aria-label="White theme for projectors"
      title={light ? "Switch to black" : "Switch to white (projector)"}
      onClick={() => set(light ? "dark" : "light")}
      className={cn(
        "sv-press relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-edge text-fg hover:border-edge-strong",
        className,
      )}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 2.75a7.25 7.25 0 0 1 0 14.5z" fill="currentColor" />
      </svg>
    </button>
  );
}
