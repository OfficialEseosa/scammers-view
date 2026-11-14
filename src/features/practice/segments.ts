import type { Tell } from "@/lib/practice/schema";

export type Segment = { text: string; tell?: Tell };

/** Splits body into plain and tell segments; overlapping tells keep the earliest. */
export function segmentBody(body: string, tells: Tell[]): Segment[] {
  const spans = tells
    .map((t) => ({ t, start: body.indexOf(t.quote) }))
    .filter((s) => s.start >= 0 && s.t.quote.length > 0)
    .sort((a, b) => a.start - b.start || b.t.quote.length - a.t.quote.length);
  const out: Segment[] = [];
  let pos = 0;
  for (const { t, start } of spans) {
    if (start < pos) continue;
    if (start > pos) out.push({ text: body.slice(pos, start) });
    out.push({ text: t.quote, tell: t });
    pos = start + t.quote.length;
  }
  if (pos < body.length) out.push({ text: body.slice(pos) });
  return out;
}

/** Tells that actually render (non-overlapping), in reading order. */
export function visibleTells(body: string, tells: Tell[]): Tell[] {
  return segmentBody(body, tells).flatMap((s) => (s.tell ? [s.tell] : []));
}
