import { connection } from "next/server";
import { getScanSubject } from "@/lib/auth/subject";
import { MAX_BODY_BYTES, deleteSaved, loadSaved, parseSavedScan, storeKey, storeSaved } from "@/lib/store/savedScan";

/**
 * The signed-in person's last finished scan, saved encrypted to their account.
 * The record is chosen from the session identity only, never from the request.
 * Reading it never counts against the daily scan limit.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

async function ready() {
  await connection();
  const subject = await getScanSubject();
  if (!subject) return { res: json({ error: "unauthorized" }, 401) } as const;
  const key = storeKey();
  if (!key) return { res: json({ saved: null, state: "not_configured" }) } as const;
  return { email: subject.email, key } as const;
}

export async function GET() {
  const r = await ready();
  if ("res" in r) return r.res;
  return json({ saved: await loadSaved(r.email, r.key) });
}

export async function PUT(request: Request) {
  const r = await ready();
  if ("res" in r) return r.res;
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  const parsed = parseSavedScan(await request.text());
  if (!parsed.ok) return json({ error: parsed.error }, parsed.error === "too_large" ? 413 : 400);
  const ok = await storeSaved(r.email, parsed.scan, r.key);
  return ok ? json({ ok: true, savedAt: parsed.scan.savedAt }) : json({ error: "store_unavailable" }, 502);
}

export async function DELETE() {
  const r = await ready();
  if ("res" in r) return r.res;
  const ok = await deleteSaved(r.email, r.key);
  return ok ? json({ ok: true }) : json({ error: "store_unavailable" }, 502);
}
