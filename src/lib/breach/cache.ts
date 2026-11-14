import { createHash } from "node:crypto";
import type { BreachResult } from "./types";

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, { at: number; result: BreachResult }>();
const inflight = new Map<string, Promise<BreachResult>>();

/** Hash of the normalised email. The address itself is never a key, a log field or a stored value. */
export function emailKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export function cacheGet(key: string): BreachResult | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return hit.result;
}

/** Cache successes only; share one in-flight call per key. */
export function cached(key: string, load: () => Promise<BreachResult>): Promise<BreachResult> {
  const hit = cacheGet(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = load()
    .then((result) => {
      store.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function clearBreachCache() {
  store.clear();
  inflight.clear();
}
