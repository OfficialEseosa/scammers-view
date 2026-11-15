import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionSubject } from "@/lib/auth/subject";
import { clientIp, takeCheck } from "@/lib/check/limits";
import { PURPOSE_SCOPES, STATE_COOKIE, appOrigin, authorizeUrl, gmailConfigured, type GmailPurpose } from "@/lib/gmail/oauth";

/**
 * Starts one-time Gmail access for the signed-in student. Requires a real Google sign-in
 * (never the development stand-in), and Google asks for consent every time.
 * ?purpose=cleanup asks for read + send for one cleanup session and runs in a pop-up window.
 */
export async function GET(request: Request) {
  const origin = appOrigin(request);
  const purpose: GmailPurpose = new URL(request.url).searchParams.get("purpose") === "cleanup" ? "cleanup" : "inbox";
  const fail = (error: string) =>
    NextResponse.redirect(purpose === "cleanup" ? `${origin}/api/gmail/callback?popup_error=${error}` : `${origin}/inbox-check?error=${error}`, 303);
  if (!gmailConfigured()) return fail("setup");
  const subject = await getSessionSubject();
  if (!subject) return fail("signin");
  if (!takeCheck("image", clientIp(request))) return fail("busy");

  const state = `${purpose}.${randomBytes(24).toString("base64url")}`;
  const res = NextResponse.redirect(authorizeUrl(origin, state, subject.email, PURPOSE_SCOPES[purpose]), 303);
  res.headers.set("cache-control", "no-store");
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/gmail",
    maxAge: 600,
  });
  return res;
}
