import { getScanSubject } from "@/lib/auth/subject";
import { nextTurn } from "@/lib/call/agent";
import { gradeCall } from "@/lib/call/grade";
import { CallTurnRequest } from "@/lib/call/schema";
import { getTicket, ownerKey, toView, updateTicket } from "@/lib/call/tickets";

export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

/** One turn of a simulated call: the user's words in, the scammer's next line out. Never logs what was said. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  const t = getTicket((await params).id, ownerKey(subject.email));
  if (!t || t.mode !== "simulated") return Response.json({ error: "This call has ended or expired." }, { status: 404, headers: NO_STORE });
  if (t.status === "ended") return Response.json({ ...toView(t), line: null, ended: true }, { headers: NO_STORE });

  const parsed = CallTurnRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });

  const r = await nextTurn(t.state, parsed.data.utterance, { hangup: parsed.data.hangup });
  if (!r.ended) {
    updateTicket(t.id, { state: r.state });
    return Response.json({ ...toView(t), line: r.line, ended: false }, { headers: NO_STORE });
  }
  const scorecard = await gradeCall(r.state);
  const done = updateTicket(t.id, { state: r.state, status: "ended", scorecard }) ?? t;
  console.info(`[call] graded simulated/${r.state.scenario.id} -> ${scorecard.verdict} (${scorecard.source})`);
  return Response.json({ ...toView(done), line: r.line, ended: true }, { headers: NO_STORE });
}
