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
