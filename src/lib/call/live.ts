import type { CallState } from "./agent";
import type { LiveCallConfig } from "./config";
import { gradeCall } from "./grade";
import { deletePracticeRoom } from "./livekit";
import { deleteTicket, updateTicket, type CallTicket } from "./tickets";

/** Grade a call the agent actually began and keep only the scorecard view; a call that never began is dropped. */
export async function gradeAndStore(t: CallTicket, state: CallState) {
  if (t.status === "waiting") {
    deleteTicket(t.id);
    return null;
  }
  const scorecard = await gradeCall(state);
  updateTicket(t.id, { state, status: "ended", scorecard });
  console.info(`[call] graded live/${state.scenario.id} -> ${scorecard.verdict} (${scorecard.source})`);
  return scorecard;
}

/** Release the LiveKit room, which also disconnects anyone still in it. */
export async function cleanupCall(t: CallTicket, cfg: LiveCallConfig) {
  if (t.room) await deletePracticeRoom(cfg, t.room);
  updateTicket(t.id, { room: undefined });
}
