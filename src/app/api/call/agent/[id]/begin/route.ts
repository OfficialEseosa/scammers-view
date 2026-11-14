import { agentConfig } from "@/lib/call/agentAuth";
import { ticketForAgent, updateTicket } from "@/lib/call/tickets";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Agent-only. Called once when the signed-in caller has joined the room: the agent gets the
 * opener (built from that user's findings) and, for the family drill, the voice sample to clone.
 * The sample is handed over once and dropped from memory; a second begin is refused.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = agentConfig(request);
  if (!cfg) return new Response("unauthorized", { status: 401, headers: NO_STORE });
  const t = ticketForAgent((await params).id);
  if (!t || t.status !== "waiting") return Response.json({ ok: false }, { status: 404, headers: NO_STORE });

  const sample = t.voiceSample;
  updateTicket(t.id, { status: "live", voiceSample: undefined });
  return Response.json(
    {
      ok: true,
      opener: t.state.transcript[0]?.text ?? "",
      scenario: t.state.scenario.id,
      voiceSample: sample ? { base64: Buffer.from(sample.bytes).toString("base64"), type: sample.type } : undefined,
    },
    { headers: NO_STORE },
  );
}
