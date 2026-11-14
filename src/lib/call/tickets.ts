import { createHash, randomBytes } from "node:crypto";
import type { CallState } from "./agent";
import type { CallMode, CallStatus, CallView, Scorecard } from "./schema";

/*
 * Practice-call tickets. Memory only (never disk, never logs), single-use, 10-minute life.
 * A ticket holds the scenario built from the user's findings, the live transcript
 * (numbers already redacted) and, for the family scenario on a live call, the voice sample
 * until the agent has cloned it. Everything goes when the call is graded and collected,
 * when the user ends the session, or when the ticket expires.
 */

export const TICKET_TTL_MS = 10 * 60 * 1000;
/** After grading, the browser has this long to collect the scorecard. */
const RESULT_TTL_MS = 2 * 60 * 1000;

export interface CallTicket {
  id: string;
  /** Hash of the signed-in email. The address itself is never stored. */
  owner: string;
  mode: CallMode;
  /** Live calls start "waiting" and go "live" when the agent joins and begins. */
  status: CallStatus;
  state: CallState;
  voiceSample?: { bytes: Uint8Array; type: string };
  scorecard?: Scorecard;
  /** Live: the LiveKit room, until it is released. */
  room?: string;
  createdAt: number;
  expiresAt: number;
}

type Store = Map<string, CallTicket>;
// One store per server process, shared by every route module (Turbopack can load a module once per route in dev).
const g = globalThis as unknown as { __svCallTickets?: Store };
const store: Store = (g.__svCallTickets ??= new Map());

export function ownerKey(email: string): string {
  return createHash("sha256").update(`call:${email.trim().toLowerCase()}`).digest("hex");
}

export function sweep(now = Date.now()) {
  for (const [id, t] of store) if (t.expiresAt <= now) store.delete(id);
}

export type CreateResult = { ok: true; ticket: CallTicket } | { ok: false; reason: "live_busy" };

/** Replaces any earlier ticket of the same owner. Live: at most `maxLive` unfinished live calls on the server. */
export function createTicket(
  input: { owner: string; mode: CallMode; state: CallState; voiceSample?: CallTicket["voiceSample"]; maxLive?: number },
  now = Date.now(),
): CreateResult {
  sweep(now);
  for (const [id, t] of store) if (t.owner === input.owner) store.delete(id);
  if (input.mode === "live") {
    const live = [...store.values()].filter((t) => t.mode === "live" && t.status !== "ended").length;
    if (live >= (input.maxLive ?? 3)) return { ok: false, reason: "live_busy" };
  }
  const ticket: CallTicket = {
    id: randomBytes(16).toString("base64url"),
    owner: input.owner,
    mode: input.mode,
    status: input.mode === "simulated" ? "live" : "waiting",
    state: input.state,
    voiceSample: input.voiceSample,
    createdAt: now,
    expiresAt: now + TICKET_TTL_MS,
  };
  store.set(ticket.id, ticket);
  return { ok: true, ticket };
}

/** Owner-checked lookup for browser routes. */
export function getTicket(id: string, owner: string, now = Date.now()): CallTicket | null {
  sweep(now);
  const t = store.get(id);
  return t && t.owner === owner ? t : null;
}

/** Agent-side lookup by id (the agent has no session; it holds the id from its dispatch metadata). */
export function ticketForAgent(id: string, now = Date.now()): CallTicket | null {
  sweep(now);
  const t = store.get(id);
  return t && t.mode === "live" ? t : null;
}

export function updateTicket(id: string, patch: Partial<Pick<CallTicket, "status" | "state" | "scorecard" | "voiceSample" | "room">>, now = Date.now()) {
  const t = store.get(id);
  if (!t) return null;
  Object.assign(t, patch);
  if (patch.scorecard) {
    // The transcript is no longer needed once graded; keep only what the scorecard view shows.
    t.voiceSample = undefined;
    t.expiresAt = Math.min(t.expiresAt, now + RESULT_TTL_MS);
  }
  return t;
}

export function deleteTicket(id: string) {
  store.delete(id);
}

/** Removes every ticket of this owner and returns them, so callers can release their rooms. */
export function deleteOwnerTickets(owner: string): CallTicket[] {
  const gone: CallTicket[] = [];
  for (const [id, t] of store) {
    if (t.owner !== owner) continue;
    gone.push(t);
    store.delete(id);
  }
  return gone;
}

export function toView(t: CallTicket): CallView {
  return {
    id: t.id,
    mode: t.mode,
    scenario: t.state.scenario.id,
    status: t.status,
    transcript: t.status === "waiting" ? [] : t.state.transcript,
    scorecard: t.scorecard,
    expiresAt: t.expiresAt,
  };
}

/** Test hook. */
export function clearTickets() {
  store.clear();
}
