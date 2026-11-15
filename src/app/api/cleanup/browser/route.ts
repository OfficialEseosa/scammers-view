import { z } from "zod";
import { getScanSubject } from "@/lib/auth/subject";
import { takeCheck } from "@/lib/check/limits";
import { actSession, closeOwnerSessions, closeSession, openSession, serverBrowserAvailable, snapshotSession, visitSession } from "@/lib/cleanup/serverBrowser";
import { cleanupOwner, taskFor } from "@/lib/cleanup/tasks";

export const maxDuration = 60;
const NO_STORE = { "cache-control": "no-store" };

const Step = z.object({
  action: z.enum(["click", "type", "select", "goto"]),
  index: z.number().int().min(0).optional(),
  text: z.string().max(500).optional(),
  url: z.string().max(2000).optional(),
  say: z.string().max(300).default(""),
  submits: z.boolean().default(false),
});

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("open"), taskId: z.string().max(80), listingUrl: z.string().url().max(500).optional() }),
  z.object({ op: z.literal("snapshot"), id: z.string().max(40) }),
  z.object({ op: z.literal("act"), id: z.string().max(40), step: Step }),
  z.object({ op: z.literal("visit"), id: z.string().max(40), url: z.string().url().max(2000) }),
  z.object({ op: z.literal("close"), id: z.string().max(40).optional() }),
]);

/**
 * Remote hands for the cleanup agent when the student chose "run it on the server".
 * Broker removals only: account settings need the student's own signed-in browser.
 */
export async function POST(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const owner = cleanupOwner(subject.email);
  const b = parsed.data;

  if (b.op === "status") return Response.json({ available: serverBrowserAvailable() }, { headers: NO_STORE });
  if (b.op === "close") {
    if (b.id) await closeSession(b.id);
    else await closeOwnerSessions(owner);
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
  if (!serverBrowserAvailable()) return Response.json({ error: "The server browser isn't set up here. Watch it in your Chrome instead." }, { status: 503, headers: NO_STORE });

  if (b.op === "open") {
    if (!takeCheck("browser", subject.email)) return Response.json({ error: "That's a lot of sites for one hour." }, { status: 429, headers: NO_STORE });
    const task = taskFor(b.taskId, b.listingUrl);
    if (!task || task.kind !== "broker") return Response.json({ error: "Only removal requests run on the server." }, { status: 400, headers: NO_STORE });
    try {
      const res = await openSession(owner, task);
      return "error" in res ? Response.json(res, { status: 503, headers: NO_STORE }) : Response.json(res, { headers: NO_STORE });
    } catch {
      return Response.json({ error: "The server browser didn't start." }, { status: 503, headers: NO_STORE });
    }
  }
  if (b.op === "snapshot") {
    const snap = await snapshotSession(b.id, owner).catch(() => null);
    return snap ? Response.json(snap, { headers: NO_STORE }) : Response.json({ error: "This browser session ended." }, { status: 404, headers: NO_STORE });
  }
  if (b.op === "act") return Response.json(await actSession(b.id, owner, b.step), { headers: NO_STORE });
  return Response.json(await visitSession(b.id, owner, b.url), { headers: NO_STORE });
}
