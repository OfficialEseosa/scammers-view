"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "sv_mask";
const EVENT = "sv-presentation-change";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Presentation mode masks finding values for projecting. Defaults to OFF (everything shown), persisted in localStorage. */
export function usePresentationMode(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable: still notify subscribers below */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [on, set];
}
