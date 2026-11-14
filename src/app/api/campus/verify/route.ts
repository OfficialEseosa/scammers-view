import { z } from "zod";
import { verifyCode } from "@/lib/campus/code";
import { campusSecret } from "@/lib/campus/secret";

const Body = z.object({ code: z.string().max(16) });

/** Checks a room code's signature. Anonymous: takes a code, returns its band and scam type. */
export async function POST(request: Request) {
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
  const decoded = verifyCode(secret, parsed.data.code);
  if (!decoded) return Response.json({ error: "Not a valid code." }, { status: 422 });
  return Response.json(decoded, { headers: { "cache-control": "no-store" } });
}
