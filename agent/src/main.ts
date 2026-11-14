import { fileURLToPath } from "node:url";
import { type JobContext, type JobProcess, ServerOptions, cli, defineAgent, voice } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as silero from "@livekit/agents-plugin-silero";
import { RoomEvent, type RemoteParticipant } from "@livekit/rtc-node";
import { app, checkConfig } from "./app.js";
import { cloneVoice, deleteVoice } from "./voice.js";

/*
 * Plays the scammer on an in-app practice call. The signed-in browser joins the LiveKit room as
 * `caller-…`; this worker is sent in by explicit dispatch with { ticketId } in the job metadata.
 * Flow: wait for the caller -> fetch the opener (and any voice sample) from the app -> speak it ->
 * relay each final transcript to the app, speak its reply -> on hang-up (either side) tell the app,
 * delete any voice clone, leave. Nothing is recorded or logged here: no audio, no transcripts.
 */

const AGENT_NAME = "scammers-view-practice";
const CALLER_PREFIX = "caller-";

const tts = (voiceId?: string) => new elevenlabs.TTS({ apiKey: process.env.ELEVENLABS_API_KEY, ...(voiceId ? { voiceId } : {}) });

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    const problem = checkConfig();
    const { ticketId } = JSON.parse(ctx.job.metadata || "{}") as { ticketId?: string };
    if (problem || !ticketId) {
      console.error(`[agent] not starting: ${problem ?? "no ticket in job metadata"}`);
      ctx.shutdown("misconfigured");
      return;
    }

    let cloneId: string | null = null;
    let stage: "call" | "over" = "call";
    const dropClone = async () => {
      if (!cloneId) return;
      const id = cloneId;
      cloneId = null;
      if (!(await deleteVoice(id))) console.warn("[agent] voice clone delete failed; remove it in ElevenLabs");
    };
    const finish = async () => {
      if (stage === "over") return;
      stage = "over";
      await app.done(ticketId).catch(() => null);
      await dropClone();
      ctx.shutdown("call over");
    };
    ctx.addShutdownCallback(async () => {
      await dropClone();
      if (stage !== "over") await app.done(ticketId).catch(() => null);
    });

    await ctx.connect();
    const caller: RemoteParticipant = await ctx.waitForParticipant();
    if (!caller.identity.startsWith(CALLER_PREFIX)) {
      console.warn("[agent] unexpected participant; leaving");
      return finish();
    }

    const begun = await app.begin(ticketId).catch(() => null);
    if (!begun?.ok) {
      console.warn("[agent] ticket not available; leaving");
      return finish();
    }
    if (begun.voiceSample) cloneId = await cloneVoice(begun.voiceSample);

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new deepgram.STT({ model: "nova-3", language: "en-US" }),
      tts: tts(cloneId ?? undefined),
    });
    await session.start({ agent: new voice.Agent({ instructions: "" }), room: ctx.room });

    // One utterance at a time, in order.
    let queue = Promise.resolve();
    const handle = (said: string) => {
      queue = queue
        .then(async () => {
          if (stage !== "call") return;
          const r = await app.turn(ticketId, said);
          if (!r) return finish();
          if (r.line) {
            const speech = session.say(r.line);
            if (r.ended) await speech.waitForPlayout();
          }
          if (r.ended) return finish();
        })
        .catch((e: unknown) => {
          console.warn("[agent] turn failed:", e instanceof Error ? e.message : "error");
        });
    };

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal && ev.transcript.trim()) handle(ev.transcript.trim());
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      if (p.identity !== caller.identity || stage === "over") return;
      queue = queue.then(async () => {
        await app.turn(ticketId, "", true).catch(() => null);
        await finish();
      });
    });

    session.say(begun.opener || "Hello?");
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: AGENT_NAME,
  }),
);
