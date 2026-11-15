/**
 * Owner-only kill switch, plus the small server-side record store it shares
 * with the daily scan limit and the encrypted saved scans.
 *
 * Records live in one Postgres table (`public.kv`) in the project's Supabase
 * database. The table has row level security on and no policies, so the
 * public key can read or write nothing directly. Access goes through three
 * database functions (`kv_get`, `kv_put`, `kv_del`) that only run when given
 * the server's secret (`SUPABASE_KV_SECRET`); the database holds just its hash.
 *
 * Reads of the kill flag are cached briefly per instance. If the database
 * cannot be reached the site stays up: an outage there must not take the app
 * down by accident.
 */

const FLAG_STORE = "flags";
const CACHE_MS = 10_000;

export interface KillState {
  on: boolean;
  at?: string;
  by?: string;
}

const recordKey = () => `kill-${process.env.VERCEL_ENV ?? "local"}`;

let cached: { state: KillState; until: number } | null = null;

function db(): { url: string; key: string; secret: string } | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const secret = process.env.SUPABASE_KV_SECRET?.trim();
  return url && key && secret ? { url, key, secret } : null;
}

export function storeConfigured(): boolean {
  return db() !== null;
}

async function rpc(fn: "kv_get" | "kv_put" | "kv_del", args: Record<string, unknown>, timeoutMs: number): Promise<Response | null> {
  const c = db();
  if (!c) return null;
  return fetch(`${c.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: c.secret, ...args }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Read one JSON record (from the flag store unless `storeName` is given). Null when missing or unreachable. */
export async function kvGet<T>(key: string, storeName: string = FLAG_STORE): Promise<T | null> {
  try {
    const res = await rpc("kv_get", { p_store: storeName, p_key: key }, 5000);
    if (!res?.ok) return null;
    return ((await res.json()) as T | null) ?? null;
  } catch {
    return null;
  }
}

/** Write one JSON record (to the flag store unless `storeName` is given). Best effort: failures are swallowed. */
export async function kvPut(key: string, value: unknown, storeName: string = FLAG_STORE): Promise<boolean> {
  try {
    const res = await rpc("kv_put", { p_store: storeName, p_key: key, p_value: value }, 8000);
    return !!res?.ok;
  } catch {
    return false;
  }
}

/** Delete one record. True when it is gone (including when it never existed). */
export async function kvDelete(key: string, storeName: string = FLAG_STORE): Promise<boolean> {
  try {
    const res = await rpc("kv_del", { p_store: storeName, p_key: key }, 8000);
    return !!res?.ok;
  } catch {
    return false;
  }
}

export function killSwitchConfigured(): boolean {
  return storeConfigured() && Boolean(process.env.ADMIN_EMAIL);
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
  let state: KillState = { on: false };
  try {
    const res = await rpc("kv_get", { p_store: FLAG_STORE, p_key: recordKey() }, 5000);
    if (res?.ok) {
      const data = (await res.json()) as KillState | null;
      state = { on: data?.on === true, at: data?.at, by: data?.by };
    } else if (cached) {
      // Unreachable or refused: keep the last known state, or stay up if there is none.
      state = cached.state;
    }
  } catch {
    if (cached) state = cached.state;
  }
  cached = { state, until: now + CACHE_MS };
  return state;
}

export async function writeKill(on: boolean, by: string): Promise<KillState> {
  if (!storeConfigured()) throw new Error("The kill switch needs the database settings (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_KV_SECRET).");
  const state: KillState = { on, at: new Date().toISOString(), by };
  const res = await rpc("kv_put", { p_store: FLAG_STORE, p_key: recordKey(), p_value: state }, 8000);
  if (!res?.ok) throw new Error(`The flag could not be saved (HTTP ${res?.status ?? "no response"}).`);
  cached = { state, until: Date.now() + CACHE_MS };
  return state;
}
