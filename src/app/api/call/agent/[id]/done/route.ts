import { agentConfig } from "@/lib/call/agentAuth";
import { cleanupCall, gradeAndStore } from "@/lib/call/live";
import { ticketForAgent } from "@/lib/call/tickets";

const NO_STORE = { "cache-control": "no-store" };

/** Agent-only. The agent has finished speaking (or lost the caller): grade if needed and release the room. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = agentConfig(request);
  if (!cfg) return new Response("unauthorized", { status: 401, headers: NO_STORE });
  const t = ticketForAgent((await params).id);
  if (!t) return new Response(null, { status: 204, headers: NO_STORE });
  if (t.status !== "ended") await gradeAndStore(t, { ...t.state, phase: "done", endedBy: t.state.endedBy ?? "you" });
  await cleanupCall(t, cfg);
  return new Response(null, { status: 204, headers: NO_STORE });
}
