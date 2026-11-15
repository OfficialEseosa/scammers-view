import { z } from "zod";
import { getScanSubject, getSessionSubject } from "@/lib/auth/subject";
import { takeCheck } from "@/lib/check/limits";
import { buildRawEmail, brokerForEmail, confirmationLinks } from "@/lib/cleanup/mail";
import { addLog, logOwner } from "@/lib/cleanup/log";
import { BROKER_SITES } from "@/lib/cleanup/sites";
import { cleanupOwner } from "@/lib/cleanup/tasks";
import { getMessage, searchMessages, sendRaw } from "@/lib/gmail/api";
import { bodyText, header } from "@/lib/gmail/message";
import { endGmailSession, gmailSession, countSend } from "@/lib/gmail/session";
import { templateDraft } from "@/lib/fixes/optout";

const NO_STORE = { "cache-control": "no-store" };

const SendBody = z.object({
  op: z.literal("send"),
  to: z.string().email().max(120),
  broker: z.string().min(1).max(80),
  listingUrl: z.string().url().max(500),
  fields: z.array(z.object({ label: z.string().max(80), value: z.string().max(200) })).min(1).max(10),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
});

const ConfirmBody = z.object({
  op: z.literal("confirm"),
  brokerId: z.string().min(1).max(40),
});

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("end") }),
  SendBody,
  ConfirmBody,
]);

/**
 * Gmail help for cleanup: status of the short-lived session, send an approved removal email,
 * look for confirmation links from a broker. Access is revoked when the session ends.
 */
export async function POST(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  // Cleanup Gmail needs a real Google sign-in (never the development stand-in).
  const session = await getSessionSubject();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });

  const owner = cleanupOwner(subject.email);
  const b = parsed.data;

  if (b.op === "status") {
    const s = gmailSession(owner);
    return Response.json({ connected: Boolean(s), signedIn: Boolean(session) }, { headers: NO_STORE });
  }
  if (b.op === "end") {
    await endGmailSession(owner);
    return Response.json({ ok: true }, { headers: NO_STORE });
  }

  const gmail = gmailSession(owner);
  if (!gmail) return Response.json({ error: "Connect Gmail for this cleanup first." }, { status: 401, headers: NO_STORE });

  if (b.op === "send") {
    if (!takeCheck("browser", subject.email)) return Response.json({ error: "That's a lot of emails. Try again later." }, { status: 429, headers: NO_STORE });
    const allowed = brokerForEmail(b.to) || BROKER_SITES.find((x) => x.name.toLowerCase() === b.broker.toLowerCase());
    if (!allowed) return Response.json({ error: "That address isn't a known data-broker privacy inbox." }, { status: 400, headers: NO_STORE });
    if (!countSend(owner)) return Response.json({ error: "This cleanup has sent enough emails." }, { status: 429, headers: NO_STORE });

    const draft = templateDraft({
      name: subject.name,
      email: subject.email,
      broker: b.broker,
      listingUrl: b.listingUrl,
      fields: b.fields,
    });
    const subjectLine = b.subject?.trim() || draft.subject;
    const body = b.body?.trim() || draft.body;
    try {
      await sendRaw(gmail.token, buildRawEmail(b.to, subjectLine, body));
      addLog(logOwner(subject.email), {
        site: allowed.name,
        taskId: `broker:${allowed.id}`,
        outcome: "sent",
        note: `Sent a removal request to ${b.to}.`,
        nextCheck: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      return Response.json({ ok: true }, { headers: NO_STORE });
    } catch {
      return Response.json({ error: "Gmail couldn't send that email." }, { status: 502, headers: NO_STORE });
    }
  }

  // confirm: find recent confirmation links from this broker
  const broker = BROKER_SITES.find((x) => x.id === b.brokerId);
  if (!broker) return Response.json({ error: "Unknown broker." }, { status: 400, headers: NO_STORE });
  try {
    const ids = await searchMessages(gmail.token, `from:${broker.domain} newer_than:2d`, 8);
    const links: { url: string; subject: string }[] = [];
    for (const id of ids) {
      const msg = await getMessage(gmail.token, id);
      const text = `${header(msg.payload, "Subject")}\n${bodyText(msg.payload)}`;
      for (const url of confirmationLinks(text, broker)) {
        if (!links.some((l) => l.url === url)) links.push({ url, subject: header(msg.payload, "Subject") || "(no subject)" });
      }
      if (links.length >= 5) break;
    }
    return Response.json({ links }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Couldn't read your Gmail." }, { status: 502, headers: NO_STORE });
  }
}
