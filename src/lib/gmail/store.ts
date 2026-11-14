import { createHash, randomBytes } from "node:crypto";
import type { CheckLevel } from "@/lib/check/analyze";
import type { Reported } from "@/lib/reputation";

/*
 * Inbox-check results. Memory only (never disk, never logs), one entry per signed-in person,
 * 10-minute life, deleted the first time the finished results are read. Holds no email text:
 * only sender, subject, date and what the checker found.
 */

export const RESULTS_TTL_MS = 10 * 60 * 1000;

export interface EmailVerdict {
  id: string;
  folder: "inbox" | "spam";
  from: string;
  subject: string;
  date?: string;
  level: CheckLevel;
  signs: string[];
  match?: { name: string; action: string; report: { title: string; url: string }[] };
  reported: Reported;
}

export interface InboxResults {
  inbox: EmailVerdict[];
  spam: EmailVerdict[];
  /** False only if Google could not confirm the access was removed. */
  revoked: boolean;
  checkedAt: number;
}

export type InboxEntry =
  | { status: "working"; run: string; expiresAt: number }
  | { status: "done"; results: InboxResults; expiresAt: number }
  | { status: "error"; message: string; expiresAt: number };

type Store = Map<string, InboxEntry>;
const g = globalThis as unknown as { __svInbox?: Store };
const store: Store = (g.__svInbox ??= new Map());

export function inboxOwner(email: string): string {
  return createHash("sha256").update(`inbox:${email.trim().toLowerCase()}`).digest("hex");
}

function sweep(now: number) {
  for (const [k, e] of store) if (e.expiresAt <= now) store.delete(k);
}

/** A run id, or null when a check for this person is already running. */
export function startInboxCheck(owner: string, now = Date.now()): string | null {
  sweep(now);
  if (store.get(owner)?.status === "working") return null;
  const run = randomBytes(8).toString("hex");
  store.set(owner, { status: "working", run, expiresAt: now + RESULTS_TTL_MS });
  return run;
}

function isRunning(owner: string, run: string) {
  const e = store.get(owner);
  return e?.status === "working" && e.run === run;
}

/** Ignored if the person pressed Forget (or the entry expired) while the check ran. */
export function finishInboxCheck(owner: string, run: string, results: InboxResults, now = Date.now()) {
  if (isRunning(owner, run)) store.set(owner, { status: "done", results, expiresAt: now + RESULTS_TTL_MS });
}

export function failInboxCheck(owner: string, run: string, message: string, now = Date.now()) {
  if (isRunning(owner, run)) store.set(owner, { status: "error", message, expiresAt: now + RESULTS_TTL_MS });
}

/** "working" stays put; finished results and errors are deleted as they are read. */
export function takeInboxResults(owner: string, now = Date.now()): InboxEntry | null {
  sweep(now);
  const e = store.get(owner);
  if (!e) return null;
  if (e.status !== "working") store.delete(owner);
  return e;
}

/** Also cancels a running check: its results are dropped when it finishes. */
export function forgetInboxResults(owner: string) {
  store.delete(owner);
}

/** Test hook. */
export function __clearInboxForTests() {
  store.clear();
}
