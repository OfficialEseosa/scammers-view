/**
 * A message handed to the /check page from outside (Android share menu, browser extension).
 * It travels in the URL fragment, which browsers never send to the server, so the message
 * stays out of server and proxy logs.
 */

export const MAX_CHECK_CHARS = 4000;

/** Why the page could not be given a message to check. */
export type ShareNote = "paste" | "limit" | "empty";

export interface Shared {
  text?: string;
  note?: ShareNote;
}

const NOTES = new Set<ShareNote>(["paste", "limit", "empty"]);

export function sharedHash({ text, note }: Shared): string {
  const p = new URLSearchParams();
  const t = text?.trim().slice(0, MAX_CHECK_CHARS);
  if (t) p.set("text", t);
  if (note) p.set("note", note);
  const s = p.toString();
  return s ? `#${s}` : "";
}

export function parseSharedHash(hash: string): Shared | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const text = p.get("text")?.trim().slice(0, MAX_CHECK_CHARS) || undefined;
  const raw = p.get("note");
  const note = raw && NOTES.has(raw as ShareNote) ? (raw as ShareNote) : undefined;
  return text || note ? { text, note } : null;
}
