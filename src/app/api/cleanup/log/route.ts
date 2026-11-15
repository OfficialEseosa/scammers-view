import { z } from "zod";
import { getScanSubject } from "@/lib/auth/subject";
import { addLog, clearLog, logOwner, readLog } from "@/lib/cleanup/log";

const NO_STORE = { "cache-control": "no-store" };

const Body = z.object({
  site: z.string().trim().min(1).max(60),
  taskId: z.string().trim().min(1).max(80),
  outcome: z.enum(["done", "not_found", "needs_user", "stopped", "failed", "sent", "confirmed", "github"]),
  note: z.string().trim().min(1).max(300),
  nextCheck: z.number().int().positive().optional(),
});

/** GET: the signed-in student's cleanup record. POST: add a row. DELETE: forget it. */
export async function GET() {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  return Response.json({ entries: readLog(logOwner(subject.email)) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const entry = addLog(logOwner(subject.email), parsed.data);
  return Response.json({ entry }, { headers: NO_STORE });
}

export async function DELETE() {
  const subject = await getScanSubject();
  if (subject) clearLog(logOwner(subject.email));
  return new Response(null, { status: 204, headers: NO_STORE });
}
