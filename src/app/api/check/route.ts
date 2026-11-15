import { z } from "zod";
import { searchFixes } from "@/lib/search";
import { analyzeMessage } from "@/lib/check/analyze";
import { clientIp, takeCheck } from "@/lib/check/limits";

const Body = z.union([
  z.object({ text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ fixQuery: z.string().trim().min(1).max(200) }).strict(),
]);

const NO_STORE = { "cache-control": "no-store" };

/**
 * "Is this a scam?" Compares pasted text with reference scam patterns and points at the
 * warning signs in it. Open without sign-in: nothing personal is
 * involved, and the pasted text is never stored or logged. Links and phone numbers in it are
 * also looked up in public scam reports (only those, never the message).
 */
export async function POST(request: Request) {
  if (!takeCheck("text", clientIp(request))) {
    return Response.json({ error: "Too many checks. Try again later." }, { status: 429, headers: { ...NO_STORE, "retry-after": "600" } });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Paste up to 4,000 characters." }, { status: 400, headers: NO_STORE });

  if ("fixQuery" in parsed.data) {
    return Response.json({ fixes: await searchFixes(parsed.data.fixQuery, 6) }, { headers: NO_STORE });
  }

  return Response.json(await analyzeMessage(parsed.data.text), { headers: NO_STORE });
}
