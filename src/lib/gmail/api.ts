import type { GmailMessage } from "./message";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function get<T>(token: string, path: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}`);
  return (await res.json()) as T;
}

/** The address of the Gmail account the token belongs to. */
export async function gmailAddress(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const p = await get<{ emailAddress?: string }>(token, "/profile", fetchImpl);
  if (!p.emailAddress) throw new Error("No Gmail address");
  return p.emailAddress;
}

export async function listMessageIds(token: string, folder: "INBOX" | "SPAM", max: number, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const q = new URLSearchParams({ labelIds: folder, maxResults: String(max) });
  if (folder === "SPAM") q.set("includeSpamTrash", "true");
  const data = await get<{ messages?: { id: string }[] }>(token, `/messages?${q}`, fetchImpl);
  return (data.messages ?? []).map((m) => m.id);
}

export function getMessage(token: string, id: string, fetchImpl: typeof fetch = fetch): Promise<GmailMessage> {
  return get<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?format=full`, fetchImpl);
}

/** Recent messages matching a Gmail search query (e.g. from:spokeo.com newer_than:1d). */
export async function searchMessages(token: string, query: string, max: number, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const q = new URLSearchParams({ q: query, maxResults: String(max) });
  const data = await get<{ messages?: { id: string }[] }>(token, `/messages?${q}`, fetchImpl);
  return (data.messages ?? []).map((m) => m.id);
}

/** Sends a plain-text email as the signed-in person. `raw` is base64url RFC 2822. */
export async function sendRaw(token: string, raw: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${BASE}/messages/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Gmail send ${res.status}`);
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("No message id");
  return data.id;
}
