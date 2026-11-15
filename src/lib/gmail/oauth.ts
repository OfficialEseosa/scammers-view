/*
 * One-time, read-only Gmail access. Separate from sign-in (which never asks for Gmail): the
 * student starts it from a button, Google asks for consent each time, and the token is revoked
 * as soon as the check finishes. Uses the same Google OAuth client as sign-in.
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** "inbox": the one-time inbox check (read only). "cleanup": read confirmation emails and send approved removal emails. */
export type GmailPurpose = "inbox" | "cleanup";
export const PURPOSE_SCOPES: Record<GmailPurpose, string[]> = {
  inbox: [GMAIL_SCOPE],
  cleanup: [GMAIL_SCOPE, GMAIL_SEND_SCOPE],
};
export const STATE_COOKIE = "sv_gmail_state";
export const CALLBACK_PATH = "/api/gmail/callback";

export function gmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET);
}

/** Public origin for the redirect address; AUTH_URL wins so it matches what Google has on file. */
export function appOrigin(request: Request): string {
  const configured = process.env.AUTH_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through */
    }
  }
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return host ? `${proto}://${host}` : url.origin;
}

export function authorizeUrl(origin: string, state: string, loginHint: string, scopes: string[] = [GMAIL_SCOPE]): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: scopes.join(" "),
    // Online access: no refresh token, so nothing could be used later.
    access_type: "online",
    include_granted_scopes: "false",
    prompt: "consent",
    login_hint: loginHint,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function exchangeCode(code: string, origin: string, fetchImpl: typeof fetch = fetch, scopes: string[] = [GMAIL_SCOPE]): Promise<string> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: `${origin}${CALLBACK_PATH}`,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  const data = (await res.json()) as { access_token?: string; scope?: string };
  if (!data.access_token) throw new Error("No access token");
  const granted = data.scope?.split(" ") ?? [];
  if (!scopes.every((s) => granted.includes(s))) {
    await revokeToken(data.access_token, fetchImpl);
    throw new Error("Gmail access was not granted");
  }
  return data.access_token;
}

/** Gives the access back to Google. Best effort; the token also dies on its own within an hour. */
export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
