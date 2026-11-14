import { timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { getSessionSubject } from "@/lib/auth/subject";
import { gmailAddress } from "@/lib/gmail/api";
import { STATE_COOKIE, appOrigin, exchangeCode, revokeToken } from "@/lib/gmail/oauth";
import { runInboxCheck } from "@/lib/gmail/run";
import { inboxOwner, startInboxCheck } from "@/lib/gmail/store";

export const maxDuration = 120;

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * Google sends the student back here. Checks the request is the one we started, that the Gmail
 * account is the signed-in person's own, then reads and checks the emails in the background and
 * revokes the access. The page polls for the results.
 */
export async function GET(request: Request) {
  const origin = appOrigin(request);
  const url = new URL(request.url);
  const done = (query: string) => {
    const res = NextResponse.redirect(`${origin}/inbox-check${query}`, 303);
    res.headers.set("cache-control", "no-store");
    res.cookies.set(STATE_COOKIE, "", { path: "/api/gmail", maxAge: 0 });
    return res;
  };

  if (!sameState(readCookie(request, STATE_COOKIE), url.searchParams.get("state"))) return done("?error=expired");
  if (url.searchParams.get("error")) return done("?error=denied");
  const code = url.searchParams.get("code");
  if (!code) return done("?error=denied");
  const subject = await getSessionSubject();
  if (!subject) return done("?error=signin");

  let token: string;
  try {
    token = await exchangeCode(code, origin);
  } catch {
    return done("?error=denied");
  }

  try {
    const address = await gmailAddress(token);
    if (address.trim().toLowerCase() !== subject.email.trim().toLowerCase()) {
      await revokeToken(token);
      return done("?error=account");
    }
  } catch {
    await revokeToken(token);
    return done("?error=gmail");
  }

  const owner = inboxOwner(subject.email);
  const run = startInboxCheck(owner);
  if (!run) {
    await revokeToken(token);
    return done("");
  }
  after(() => runInboxCheck(token, owner, run));
  return done("");
}
