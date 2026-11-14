import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionSubject } from "@/lib/auth/subject";
import { clientIp, takeCheck } from "@/lib/check/limits";
import { STATE_COOKIE, appOrigin, authorizeUrl, gmailConfigured } from "@/lib/gmail/oauth";

/**
 * Starts the one-time, read-only Gmail check for the signed-in student. Requires a real
 * Google sign-in (never the development stand-in), and Google asks for consent every time.
 */
export async function GET(request: Request) {
  const origin = appOrigin(request);
  if (!gmailConfigured()) return NextResponse.redirect(`${origin}/inbox-check?error=setup`, 303);
  const subject = await getSessionSubject();
  if (!subject) return NextResponse.redirect(`${origin}/inbox-check?error=signin`, 303);
  if (!takeCheck("image", clientIp(request))) return NextResponse.redirect(`${origin}/inbox-check?error=busy`, 303);

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(origin, state, subject.email), 303);
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
