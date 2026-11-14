/*
 * Client for the web app's agent-only routes (/api/call/agent/*). The scenario, transcript and
 * scoring all live in the app's memory; this worker only relays speech.
 */

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const SECRET = process.env.CALL_AGENT_SECRET || "";

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (res.status === 204) return null;
  return (await res.json().catch(() => null)) as T | null;
}

export type BeginResult = {
  ok: boolean;
  opener?: string;
  scenario?: string;
  voiceSample?: { base64: string; type: string };
};

export type TurnResult = { line: string | null; ended: boolean };

export const app = {
  begin: (ticketId: string) => post<BeginResult>(`/api/call/agent/${encodeURIComponent(ticketId)}/begin`, {}),
  turn: (ticketId: string, utterance: string, hangup = false) =>
    post<TurnResult>(`/api/call/agent/${encodeURIComponent(ticketId)}/turn`, { utterance, hangup }),
  done: (ticketId: string) => post<null>(`/api/call/agent/${encodeURIComponent(ticketId)}/done`, {}),
};

export function checkConfig(): string | null {
  if (!SECRET) return "CALL_AGENT_SECRET is not set";
  if (!process.env.ELEVENLABS_API_KEY) return "ELEVENLABS_API_KEY is not set";
  if (!process.env.DEEPGRAM_API_KEY) return "DEEPGRAM_API_KEY is not set";
  return null;
}
