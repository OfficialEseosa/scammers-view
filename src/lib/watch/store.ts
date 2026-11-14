import { z } from "zod";
import { sameScan, type Snapshot } from "./diff";
import { newSalt } from "./fingerprint";

/** Everything change watch keeps on a device: a salt and up to 8 snapshots of hashes. */
export interface WatchStore {
  v: 1;
  salt: string;
  history: Snapshot[];
}

export const WATCH_KEY = "sv.watch.v1";
export const MAX_HISTORY = 8;

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const Schema = z.object({
  v: z.literal(1),
  salt: z.string().regex(/^[0-9a-f]{32}$/),
  history: z
    .array(
      z.object({
        at: z.string().max(40),
        score: z.number().min(0).max(100),
        items: z
          .array(z.object({ c: z.string().max(20), h: z.string().regex(/^[0-9a-f]{16}$/) }))
          .max(500),
      }),
    )
    .max(MAX_HISTORY),
});

/** The stored history, or null when the user has not opted in on this device. */
export function loadWatch(storage: KV): WatchStore | null {
  try {
    const raw = storage.getItem(WATCH_KEY);
    if (!raw) return null;
    const parsed = Schema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as WatchStore) : null;
  } catch {
    return null;
  }
}

export function saveWatch(storage: KV, store: WatchStore): boolean {
  try {
    storage.setItem(WATCH_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function clearWatch(storage: KV): void {
  try {
    storage.removeItem(WATCH_KEY);
  } catch {
    /* ignore */
  }
}

export function freshStore(salt: string = newSalt()): WatchStore {
  return { v: 1, salt, history: [] };
}

/** Append a snapshot, keeping the last 8. An identical repeat scan replaces the previous entry. */
export function appendSnapshot(store: WatchStore, snap: Snapshot): WatchStore {
  const last = store.history[store.history.length - 1];
  const base = last && sameScan(last, snap) ? store.history.slice(0, -1) : store.history;
  return { ...store, history: [...base, snap].slice(-MAX_HISTORY) };
}

/** Sparkline path for scores 0..100 in a w x h box. Empty string when under two points. */
export function sparklinePath(scores: number[], w: number, h: number, pad = 3): string {
  if (scores.length < 2) return "";
  const step = (w - pad * 2) / (scores.length - 1);
  return scores
    .map((s, i) => {
      const x = pad + i * step;
      const y = pad + (1 - Math.max(0, Math.min(100, s)) / 100) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function sparklinePoints(scores: number[], w: number, h: number, pad = 3): { x: number; y: number }[] {
  if (!scores.length) return [];
  const step = scores.length > 1 ? (w - pad * 2) / (scores.length - 1) : 0;
  return scores.map((s, i) => ({
    x: scores.length > 1 ? pad + i * step : w / 2,
    y: pad + (1 - Math.max(0, Math.min(100, s)) / 100) * (h - pad * 2),
  }));
}
