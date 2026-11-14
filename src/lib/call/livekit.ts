import { AccessToken, AgentDispatchClient, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import type { LiveCallConfig } from "./config";

/*
 * One LiveKit room per practice call. The signed-in browser gets a short-lived, room-scoped token
 * that can only publish its microphone; the agent worker is sent in by explicit dispatch.
 * API credentials never leave this server.
 */

export const AGENT_NAME = "scammers-view-practice";
export const CALLER_PREFIX = "caller-";
const CALLER_TTL = "15m";

const httpUrl = (wss: string) => wss.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

export async function preparePracticeRoom(cfg: LiveCallConfig, ticketId: string): Promise<{ room: string; callerToken: string }> {
  const { url, apiKey, apiSecret } = cfg.livekit;
  const room = `practice-${ticketId.slice(0, 12)}`;

  const rooms = new RoomServiceClient(httpUrl(url), apiKey, apiSecret);
  await rooms.createRoom({ name: room, emptyTimeout: 60, departureTimeout: 10, maxParticipants: 2 });
  const dispatch = new AgentDispatchClient(httpUrl(url), apiKey, apiSecret);
  await dispatch.createDispatch(room, AGENT_NAME, { metadata: JSON.stringify({ ticketId }) });

  const at = new AccessToken(apiKey, apiSecret, { identity: `${CALLER_PREFIX}${ticketId.slice(0, 8)}`, ttl: CALLER_TTL });
  at.addGrant({ roomJoin: true, room, canPublish: true, canPublishSources: [TrackSource.MICROPHONE], canSubscribe: true, canPublishData: false });
  return { room, callerToken: await at.toJwt() };
}

export async function deletePracticeRoom(cfg: LiveCallConfig, room: string) {
  const { url, apiKey, apiSecret } = cfg.livekit;
  await new RoomServiceClient(httpUrl(url), apiKey, apiSecret).deleteRoom(room).catch(() => {});
}
