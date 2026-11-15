/**
 * Owner-only kill switch. When it is on, the proxy turns every page into the
 * "unavailable" screen and every API route into a 503, so nothing can spend
 * money or read data.
 *
 * The flag has to outlive a single server instance and there is no database,
 * so it lives as one small record in an Apify key-value store (the project
 * already has an Apify token). Reads are cached briefly per instance. If the
 * store cannot be reached the site stays up: an outage there must not take
 * the app down by accident.
 */

const API = "https://api.apify.com/v2";
const STORE_NAME = "scammers-view-flags";
const CACHE_MS = 10_000;

export interface KillState {
  on: boolean;
  at?: string;
  by?: string;
}

const recordKey = () => `kill-${process.env.VERCEL_ENV ?? "local"}`;

let storeId: string | null = null;
let cached: { state: KillState; until: number } | null = null;

async function store(token: string): Promise<string | null> {
  if (storeId) return storeId;
  const res = await fetch(`${API}/key-value-stores?name=${STORE_NAME}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const id = ((await res.json()) as { data?: { id?: string } }).data?.id ?? null;
  storeId = id;
  return id;
}

export function killSwitchConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN && process.env.ADMIN_EMAIL);
}

/** The owner's address comes from ADMIN_EMAIL (never from the request or the code). */
export function isAdmin(email: string | null | undefined): boolean {
  const allowed = (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allowed.includes(email.trim().toLowerCase());
}

export async function readKill(fresh = false): Promise<KillState> {
  const now = Date.now();
  if (!fresh && cached && cached.until > now) return cached.state;
  const token = process.env.APIFY_TOKEN;
  let state: KillState = { on: false };
  if (token) {
    try {
      const id = await store(token);
      if (id) {
        const res = await fetch(`${API}/key-value-stores/${id}/records/${recordKey()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = (await res.json()) as KillState;
          state = { on: data?.on === true, at: data?.at, by: data?.by };
        }
      }
    } catch {
      // Unreachable store: keep the last known state, or stay up if there is none.
      if (cached) state = cached.state;
    }
  }
  cached = { state, until: now + CACHE_MS };
  return state;
}

export async function writeKill(on: boolean, by: string): Promise<KillState> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("The kill switch needs APIFY_TOKEN.");
  const id = await store(token);
  if (!id) throw new Error("The flag store could not be opened.");
  const state: KillState = { on, at: new Date().toISOString(), by };
  const res = await fetch(`${API}/key-value-stores/${id}/records/${recordKey()}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(state),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`The flag could not be saved (HTTP ${res.status}).`);
  cached = { state, until: Date.now() + CACHE_MS };
  return state;
}
