import { createHash, timingSafeEqual } from "node:crypto";
import { liveCallConfig, type LiveCallConfig } from "./config";

/** The agent worker authenticates with `Authorization: Bearer <CALL_AGENT_SECRET>`. */
export function agentConfig(request: Request): LiveCallConfig | null {
  const cfg = liveCallConfig();
  if (!cfg) return null;
  const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(cfg.agentSecret).digest();
  return got && timingSafeEqual(a, b) ? cfg : null;
}
