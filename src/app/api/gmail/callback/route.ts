import { timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { getSessionSubject } from "@/lib/auth/subject";
import { cleanupOwner } from "@/lib/cleanup/tasks";
import { gmailAddress } from "@/lib/gmail/api";
import { PURPOSE_SCOPES, STATE_COOKIE, appOrigin, exchangeCode, revokeToken, type GmailPurpose } from "@/lib/gmail/oauth";
import { runInboxCheck } from "@/lib/gmail/run";
import { startGmailSession } from "@/lib/gmail/session";
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

/** The cleanup pop-up tells the scan page how it went, then closes itself. */
function popupPage(origin: string, result: string): Response {
  const msg = JSON.stringify({ svx: "gmail", result });
  const html = `<!doctype html><meta charset="utf-8"><title>Scammer's View</title><body style="font:16px system-ui;padding:24px">
<p>${result === "ok" ? "Gmail connected for this cleanup. You can close this window." : "Gmail wasn't connected. You can close this window."}</p>
<script>try{window.opener&&window.opener.postMessage(${msg},${JSON.stringify(origin)})}catch(e){}setTimeout(function(){window.close()},600)</script></body>`;
  const res = new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  return res;
}

/**
 * Google sends the student back here. Checks the request is the one we started and that the
 * Gmail account is the signed-in person's own. Inbox check: reads and checks emails in the
 * background and revokes the access. Cleanup: keeps the access for one cleanup session.
 */
export async function GET(request: Request) {
  const origin = appOrigin(request);
  const url = new URL(request.url);

  const popupError = url.searchParams.get("popup_error");
  if (popupError) return popupPage(origin, popupError.slice(0, 20));

  const cookieState = readCookie(request, STATE_COOKIE);
  const purpose: GmailPurpose = cookieState?.startsWith("cleanup.") ? "cleanup" : "inbox";
  const done = (result: string) => {
    const res =
      purpose === "cleanup"
        ? popupPage(origin, result || "ok")
        : (() => {
            const r = NextResponse.redirect(`${origin}/inbox-check${result ? `?error=${result}` : ""}`, 303);
            r.headers.set("cache-control", "no-store");
            return r;
          })();
    res.headers.append("set-cookie", `${STATE_COOKIE}=; Path=/api/gmail; Max-Age=0; HttpOnly; SameSite=Lax`);
    return res;
  };

  if (!sameState(cookieState, url.searchParams.get("state"))) return done("expired");
  if (url.searchParams.get("error")) return done("denied");
  const code = url.searchParams.get("code");
  if (!code) return done("denied");
  const subject = await getSessionSubject();
  if (!subject) return done("signin");

  let token: string;
  try {
    token = await exchangeCode(code, origin, fetch, PURPOSE_SCOPES[purpose]);
  } catch {
    return done("denied");
  }

  try {
    const address = await gmailAddress(token);
    if (address.trim().toLowerCase() !== subject.email.trim().toLowerCase()) {
      await revokeToken(token);
      return done("account");
    }
  } catch {
    await revokeToken(token);
    return done("gmail");
  }

  if (purpose === "cleanup") {
    startGmailSession(cleanupOwner(subject.email), token);
    return done("");
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
