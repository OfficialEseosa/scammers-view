import { getScanSubject } from "@/lib/auth/subject";
import { liveCallConfig } from "@/lib/call/config";
import { deletePracticeRoom } from "@/lib/call/livekit";
import { deleteTicket, getTicket, ownerKey, toView } from "@/lib/call/tickets";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  const t = getTicket((await params).id, ownerKey(subject.email));
  if (!t) return Response.json({ error: "This call has ended or expired." }, { status: 404, headers: NO_STORE });
  return Response.json(toView(t), { headers: NO_STORE });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const subject = await getScanSubject();
  if (!subject) return new Response(null, { status: 204, headers: NO_STORE });
  const { id } = await params;
  const t = getTicket(id, ownerKey(subject.email));
  if (t) {
    deleteTicket(id);
    const cfg = liveCallConfig();
    if (t.room && cfg) await deletePracticeRoom(cfg, t.room);
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
