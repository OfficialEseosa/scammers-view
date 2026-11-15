import { revokeToken } from "./oauth";

/*
 * Gmail access for one cleanup session: read (confirmation links) + send (approved removal
 * emails). Memory only, never logged, at most 30 minutes, then revoked with Google. Ending the
 * cleanup revokes it straight away.
 */

export const SESSION_MS = 30 * 60 * 1000;
export const MAX_SENDS = 20;

interface GmailSession {
  token: string;
  expiresAt: number;
  sent: number;
}

type State = { sessions: Map<string, GmailSession>; sweeper?: ReturnType<typeof setInterval> };
const g = globalThis as unknown as { __svGmailSessions?: State };
const state: State = (g.__svGmailSessions ??= { sessions: new Map() });

function sweep(now = Date.now()) {
  for (const [owner, s] of state.sessions) {
    if (s.expiresAt <= now) {
      state.sessions.delete(owner);
      void revokeToken(s.token);
    }
  }
}

export function startGmailSession(owner: string, token: string, now = Date.now()) {
  const old = state.sessions.get(owner);
  if (old && old.token !== token) void revokeToken(old.token);
  state.sessions.set(owner, { token, expiresAt: now + SESSION_MS, sent: 0 });
  state.sweeper ??= setInterval(() => sweep(), 30_000);
  state.sweeper.unref?.();
}

export function gmailSession(owner: string, now = Date.now()): GmailSession | null {
  sweep(now);
  return state.sessions.get(owner) ?? null;
}

/** False when the session has used up its email allowance. */
export function countSend(owner: string): boolean {
  const s = state.sessions.get(owner);
  if (!s || s.sent >= MAX_SENDS) return false;
  s.sent++;
  return true;
}

export async function endGmailSession(owner: string): Promise<void> {
  const s = state.sessions.get(owner);
  state.sessions.delete(owner);
  if (s) await revokeToken(s.token);
}

/** Test hook. */
export function __clearGmailSessionsForTests() {
  state.sessions.clear();
}
