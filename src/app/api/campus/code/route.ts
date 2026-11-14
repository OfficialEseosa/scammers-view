import { z } from "zod";
import { getScanSubject } from "@/lib/auth/subject";
import { signCode } from "@/lib/campus/code";
import { PATTERNS } from "@/lib/campus/patterns";
import { campusSecret } from "@/lib/campus/secret";

const Body = z.object({
  score: z.number().min(0).max(100),
  patternId: z.enum(PATTERNS.map((p) => p.id) as [string, ...string[]]),
});

/** Signs a 6-character room code. Body carries a score and a scam type id, nothing else. */
export async function POST(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in to get a room code." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  const secret = campusSecret();
  if (!secret) return Response.json({ error: "Room codes are not configured." }, { status: 503 });

  const code = signCode(secret, parsed.data.score, parsed.data.patternId as (typeof PATTERNS)[number]["id"]);
  if (!code) return Response.json({ error: "Invalid request." }, { status: 400 });
  return Response.json({ code }, { headers: { "cache-control": "no-store" } });
}
