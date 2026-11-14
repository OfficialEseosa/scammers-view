import { getScanSubject } from "@/lib/auth/subject";
import { startCall } from "@/lib/call/agent";
import { liveCallConfig } from "@/lib/call/config";
import { deletePracticeRoom, preparePracticeRoom } from "@/lib/call/livekit";
import { buildScenario } from "@/lib/call/scenarios";
import { CallStartRequest, type LiveJoin } from "@/lib/call/schema";
import { createTicket, deleteOwnerTickets, deleteTicket, ownerKey, toView, updateTicket } from "@/lib/call/tickets";

const NO_STORE = { "cache-control": "no-store" };

/** Which modes this server can offer. */
export async function GET() {
  return Response.json({ live: Boolean(liveCallConfig()) }, { headers: NO_STORE });
}

/** Starts a practice call for the signed-in person, inside their own browser. Nothing here dials anyone. */
export async function POST(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in to practise a call." }, { status: 401, headers: NO_STORE });

  const parsed = CallStartRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });
  const { findings, scenario, mode, voiceSample } = parsed.data;

  const cfg = liveCallConfig();
  if (mode === "live" && !cfg) return Response.json({ error: "Live calls aren't set up on this server." }, { status: 503, headers: NO_STORE });

  for (const old of deleteOwnerTickets(ownerKey(subject.email))) if (old.room && cfg) await deletePracticeRoom(cfg, old.room);

  const { state } = startCall(buildScenario(scenario, findings, subject.name));
  const sample =
    mode === "live" && scenario === "family-voice-clone" && voiceSample
      ? { bytes: new Uint8Array(Buffer.from(voiceSample.base64, "base64")), type: voiceSample.type }
      : undefined;
  const res = createTicket({ owner: ownerKey(subject.email), mode, state, voiceSample: sample, maxLive: cfg?.maxLiveCalls });
  if (!res.ok) return Response.json({ error: "Too many practice calls are running right now. Try again in a few minutes." }, { status: 409, headers: NO_STORE });

  let join: LiveJoin | undefined;
  if (mode === "live" && cfg) {
    try {
      const { room, callerToken } = await preparePracticeRoom(cfg, res.ticket.id);
      updateTicket(res.ticket.id, { room });
      join = { url: cfg.livekit.url, token: callerToken };
    } catch (e) {
      deleteTicket(res.ticket.id);
      console.warn("[call] live room setup failed:", e instanceof Error ? e.message.slice(0, 120) : "error");
      return Response.json({ error: "Couldn't start the live call. Try the browser version." }, { status: 502, headers: NO_STORE });
    }
  }

  console.info(`[call] start ${mode}/${scenario}`);
  return Response.json({ ...toView(res.ticket), join }, { status: 201, headers: NO_STORE });
}

/** "End session": drop every ticket this person has and close any live room. */
export async function DELETE() {
  const subject = await getScanSubject();
  if (subject) {
    const cfg = liveCallConfig();
    for (const t of deleteOwnerTickets(ownerKey(subject.email))) if (t.room && cfg) await deletePracticeRoom(cfg, t.room);
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
