"use client";

import { useLayoutEffect } from "react";
import { THEME_KEY, THEME_SCRIPT } from "./theme-script";

/**
 * Applies the saved theme before first paint (inline script, runs while the HTML is
 * parsed). On the client the tag is rendered as `text/plain`, so React neither warns
 * about a script tag nor re-runs it; the layout effect re-applies the attribute after
 * React's dev-mode remount resets <html>. Pattern from the Next docs
 * ("Preventing flash before hydration").
 */
export function ThemeScript() {
  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(THEME_KEY) === "light") document.documentElement.setAttribute("data-theme", "light");
    } catch {
      /* storage blocked: default theme */
    }
  }, []);
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}
