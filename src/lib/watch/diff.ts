import type { Finding, FindingCategory } from "../types";
import type { FpItem, HashedFinding } from "./fingerprint";

export interface Snapshot {
  /** ISO date of the scan. */
  at: string;
  score: number;
  items: FpItem[];
}

export interface WatchDiff {
  /** New since last time. Shown in full: they are in the current scan. */
  added: Finding[];
  /** Gone since last time: category and count only, because no readable value was kept. */
  removed: { category: FindingCategory; count: number }[];
  removedCount: number;
  unchangedCount: number;
  scoreDelta: number;
}

const k = (c: string, h: string) => `${c}|${h}`;

export function toSnapshot(hashed: HashedFinding[], score: number, now: Date = new Date()): Snapshot {
  return { at: now.toISOString(), score: Math.round(score), items: hashed.map(({ c, h }) => ({ c, h })) };
}

export function diffSnapshots(prev: Snapshot, current: HashedFinding[], score: number): WatchDiff {
  const before = new Set(prev.items.map((i) => k(i.c, i.h)));
  const now = new Set(current.map((i) => k(i.c, i.h)));

  const added = current.filter((i) => !before.has(k(i.c, i.h))).map((i) => i.finding);
  const goneByCategory = new Map<FindingCategory, number>();
  let removedCount = 0;
  for (const i of prev.items) {
    if (now.has(k(i.c, i.h))) continue;
    goneByCategory.set(i.c, (goneByCategory.get(i.c) ?? 0) + 1);
    removedCount++;
  }
  const removed = [...goneByCategory].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const unchangedCount = current.filter((i) => before.has(k(i.c, i.h))).length;
  return { added, removed, removedCount, unchangedCount, scoreDelta: Math.round(score) - prev.score };
}

export function sameScan(a: Snapshot, b: Snapshot): boolean {
  if (a.score !== b.score || a.items.length !== b.items.length) return false;
  const s = new Set(a.items.map((i) => k(i.c, i.h)));
  return b.items.every((i) => s.has(k(i.c, i.h)));
}
