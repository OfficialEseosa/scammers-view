import { createHash } from "node:crypto";

/*
 * What the cleanup agent did. Memory only, never disk, never logs: one list per signed-in
 * person, kept for the rest of the day so the student can see what worked. Cleared when
 * they press Forget, or when it expires.
 */

export const LOG_TTL_MS = 24 * 60 * 60 * 1000;

export type LogOutcome = "done" | "not_found" | "needs_user" | "stopped" | "failed" | "sent" | "confirmed" | "github";

export interface LogEntry {
  id: string;
  at: number;
  site: string;
  taskId: string;
  outcome: LogOutcome;
  /** One plain sentence. */
  note: string;
  /** When to remind the student to re-check (brokers re-list). */
  nextCheck?: number;
}

type Store = Map<string, { expiresAt: number; entries: LogEntry[] }>;
const g = globalThis as unknown as { __svCleanupLog?: Store };
const store: Store = (g.__svCleanupLog ??= new Map());

export function logOwner(email: string): string {
  return createHash("sha256").update(`cleanup-log:${email.trim().toLowerCase()}`).digest("hex");
}

function sweep(now = Date.now()) {
  for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
}

export function addLog(owner: string, entry: Omit<LogEntry, "id" | "at">, now = Date.now()): LogEntry {
  sweep(now);
  const row: LogEntry = { ...entry, id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: now };
  const cur = store.get(owner) ?? { expiresAt: now + LOG_TTL_MS, entries: [] };
  cur.entries = [row, ...cur.entries].slice(0, 80);
  cur.expiresAt = now + LOG_TTL_MS;
  store.set(owner, cur);
  return row;
}

export function readLog(owner: string, now = Date.now()): LogEntry[] {
  sweep(now);
  return store.get(owner)?.entries ?? [];
}

export function clearLog(owner: string) {
  store.delete(owner);
}

/** Test hook. */
export function __clearCleanupLogForTests() {
  store.clear();
}
