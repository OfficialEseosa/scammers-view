/** Server-only settings for live practice calls (LiveKit room + agent worker). */

export interface LiveCallConfig {
  livekit: { url: string; apiKey: string; apiSecret: string };
  agentSecret: string;
  /** Live calls allowed at once on this server; each one costs speech-to-text and voice minutes. */
  maxLiveCalls: number;
}

const env = (k: string) => process.env[k]?.trim() || undefined;

/** Null unless every piece is set, in which case the live mode is offered. */
export function liveCallConfig(): LiveCallConfig | null {
  const url = env("LIVEKIT_URL");
  const apiKey = env("LIVEKIT_API_KEY");
  const apiSecret = env("LIVEKIT_API_SECRET");
  const agentSecret = env("CALL_AGENT_SECRET");
  if (!url || !apiKey || !apiSecret || !agentSecret) return null;
  const max = Number(env("MAX_LIVE_CALLS") ?? 3);
  return {
    livekit: { url, apiKey, apiSecret },
    agentSecret,
    maxLiveCalls: Number.isFinite(max) && max >= 1 ? Math.floor(max) : 3,
  };
}
