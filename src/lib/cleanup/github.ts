/*
 * Optional GitHub privacy via GitHub's own API (token paste fallback).
 * The primary path is the Chrome extension agent on github.com/settings/emails —
 * the API can only set email visibility, not "Block command line pushes…".
 * https://docs.github.com/en/rest/users/emails#set-primary-email-visibility-for-the-authenticated-user
 */

export interface GithubPrivacyResult {
  ok: boolean;
  privateEmail: boolean;
  /** noreply address to use in `git config`, when GitHub returned one. */
  noreply?: string;
  error?: string;
}

function ghHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token.trim()}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
    "user-agent": "scammers-view",
  };
}

function pickNoreply(emails: unknown): string | undefined {
  if (!Array.isArray(emails)) return undefined;
  for (const row of emails) {
    if (!row || typeof row !== "object") continue;
    const email = (row as { email?: unknown }).email;
    if (typeof email === "string" && /@users\.noreply\.github\.com$/i.test(email)) return email;
  }
  return undefined;
}

export async function setGithubEmailPrivacy(token: string, fetchImpl: typeof fetch = fetch): Promise<GithubPrivacyResult> {
  const headers = ghHeaders(token);
  try {
    const res = await fetchImpl("https://api.github.com/user/email/visibility", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ visibility: "private" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, privateEmail: false, error: "GitHub refused that token. Create one with the 'user' permission." };
    }
    if (!res.ok) return { ok: false, privateEmail: false, error: `GitHub returned ${res.status}.` };

    let noreply = pickNoreply(await res.json().catch(() => null));
    if (!noreply) {
      const list = await fetchImpl("https://api.github.com/user/emails", {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (list.ok) noreply = pickNoreply(await list.json().catch(() => null));
    }
    return { ok: true, privateEmail: true, noreply };
  } catch {
    return { ok: false, privateEmail: false, error: "Couldn't reach GitHub." };
  }
}
