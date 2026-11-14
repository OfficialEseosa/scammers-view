import { htmlToText } from "./html";

/** The parts of a Gmail API message (format=full) that the check uses. */
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface EmailText {
  id: string;
  from: string;
  subject: string;
  date?: string;
  body: string;
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function header(part: GmailPart | undefined, name: string): string {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value.trim() ?? "";
}

function collect(part: GmailPart, out: { plain: string[]; html: string[] }) {
  if (part.filename) return;
  const type = part.mimeType?.toLowerCase() ?? "";
  if (part.body?.data) {
    if (type === "text/plain") out.plain.push(decodeBase64Url(part.body.data));
    else if (type === "text/html") out.html.push(decodeBase64Url(part.body.data));
  }
  for (const p of part.parts ?? []) collect(p, out);
}

/** Plain text of the body: the HTML part when there is one (it keeps link targets), else the text part. */
export function bodyText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const out = { plain: [] as string[], html: [] as string[] };
  collect(payload, out);
  if (out.html.length) return htmlToText(out.html.join("\n"));
  return out.plain.join("\n").trim();
}

export function toEmailText(m: GmailMessage, maxChars: number): EmailText {
  const subject = header(m.payload, "Subject") || "(no subject)";
  const body = bodyText(m.payload) || m.snippet || "";
  const date = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : undefined;
  return { id: m.id, from: header(m.payload, "From") || "(unknown sender)", subject, date, body: body.slice(0, maxChars) };
}
