"use client";

import { useEffect, useSyncExternalStore } from "react";

const SDA = "(animation-timeline: view()) and (animation-range: entry)";
const noop = () => () => {};

/** True when CSS scroll-driven animations (with ranges) are available. SSR: true. */
export function useScrollTimelines(): boolean {
  return useSyncExternalStore(
    noop,
    () => CSS.supports(SDA),
    () => true,
  );
}

/**
 * Thin reading-progress bar (pure CSS, scroll timeline), plus the fallback for
 * browsers without scroll timelines or viewers who prefer reduced motion: any
 * `[data-reveal]` still below the fold is armed (hidden) and revealed once on
 * enter. Nothing is hidden until this has run, so content never sticks invisible.
 */
export function ScrollFx() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (CSS.supports(SDA) && !reduce) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    for (const el of els) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) continue;
      el.dataset.armed = "";
      io.observe(el);
    }
    return () => {
      io.disconnect();
      for (const el of els) {
        delete el.dataset.armed;
        delete el.dataset.in;
      }
    };
  }, []);

  return <div aria-hidden className="sv-progress" />;
}
