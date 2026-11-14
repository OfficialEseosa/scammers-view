/** Client-side .ics for a weekly "scan again" reminder. Nothing is sent anywhere. */

const pad = (n: number) => String(n).padStart(2, "0");

/** Floating local time, so it fires at the same wall-clock hour wherever the person is. */
function local(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function utc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 75 octets (RFC 5545). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  const limit = (first: boolean) => (first ? 75 : 74);
  for (const ch of Array.from(line)) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit(out.length === 0)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export interface ReminderOptions {
  now?: Date;
  /** Where the person re-scans. */
  appUrl: string;
  /** Local hour of day, 0..23. */
  hour?: number;
  uid?: string;
}

export function buildReminderIcs({ now = new Date(), appUrl, hour = 10, uid }: ReminderOptions): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, hour, 0, 0);
  const id = uid ?? `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}@scammers-view.local`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Scammers View//Change watch//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${id}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${local(start)}`,
    "DURATION:PT15M",
    "RRULE:FREQ=WEEKLY",
    `SUMMARY:${escapeIcsText("Re-scan my public footprint")}`,
    `DESCRIPTION:${escapeIcsText(`Run Scammer's View on yourself again and check what changed. ${appUrl}`)}`,
    `URL:${appUrl}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText("Re-scan my public footprint")}`,
    "TRIGGER:-PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
