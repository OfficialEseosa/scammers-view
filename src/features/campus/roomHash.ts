"use client";

import { useSyncExternalStore } from "react";

/** Room seed from the URL fragment (#room=SEED). The fragment never reaches a server. */
export function parseRoom(hash: string): string {
  const m = /room=([A-Za-z0-9]{4,16})/.exec(hash);
  return m ? m[1].toUpperCase() : "";
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

/** Current room seed, "" on the server and when absent. */
export function useRoomSeed(): string {
  return useSyncExternalStore(subscribe, () => parseRoom(window.location.hash), () => "");
}

const SEED_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function randomSeed(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => SEED_ALPHABET[b % SEED_ALPHABET.length]).join("");
}
