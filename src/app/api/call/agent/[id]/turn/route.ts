import { agentConfig } from "@/lib/call/agentAuth";
import { nextTurn } from "@/lib/call/agent";
import { cleanupCall, gradeAndStore } from "@/lib/call/live";
import { CallTurnRequest } from "@/lib/call/schema";
import { ticketForAgent, updateTicket } from "@/lib/call/tickets";

export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

/**
 * Agent-only. One turn of a live call: the caller's transcribed words in, the scammer's line out.
 * When the caller hangs up, the call is graded and the room released straight away. When the scammer
 * ends it, the agent speaks the closing line first and then calls /done.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = agentConfig(request);
  if (!cfg) return new Response("unauthorized", { status: 401, headers: NO_STORE });
  const t = ticketForAgent((await params).id);
  if (!t || t.status !== "live") return Response.json({ line: null, ended: true }, { status: 404, headers: NO_STORE });

  const parsed = CallTurnRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });

  const r = await nextTurn(t.state, parsed.data.utterance, { hangup: parsed.data.hangup });
  if (!r.ended) {
    updateTicket(t.id, { state: r.state });
    return Response.json({ line: r.line, ended: false }, { headers: NO_STORE });
  }
  await gradeAndStore(t, r.state);
  if (parsed.data.hangup) await cleanupCall(t, cfg);
  return Response.json({ line: r.line, ended: true }, { headers: NO_STORE });
}
