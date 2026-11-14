"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "sv_presentation";
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
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

/** Presentation mode masks finding values for projecting. Defaults to ON, persisted in localStorage. */
export function usePresentationMode(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => true);
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
