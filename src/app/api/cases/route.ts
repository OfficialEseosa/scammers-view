import { searchCases } from "@/lib/cases/search";
import { CaseRequest } from "@/lib/cases/types";
import { clientIp, takeCheck } from "@/lib/check/limits";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Real, published scam reports that fit an exposure. The request carries which kinds of fact are
 * public and a short description per attack chain; it is used for this one search and never
 * stored or logged. Open without sign-in so the fictional demo works: only reference documents
 * come back.
 */
export async function POST(request: Request) {
  if (!takeCheck("text", clientIp(request))) {
    return Response.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...NO_STORE, "retry-after": "600" } });
  }
  const parsed = CaseRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });
  return Response.json(await searchCases(parsed.data), { headers: NO_STORE });
}
