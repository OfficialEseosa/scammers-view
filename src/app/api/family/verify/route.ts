import { z } from "zod";
import { SecretMissingError, getFamilySecret, verifyToken } from "@/lib/family/token";

const Body = z.union([
  z.object({ token: z.string().max(1200) }),
  z.object({ tokens: z.array(z.string().max(1200)).min(1).max(20) }),
]);

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Checks a family card's signature and expiry and returns its payload.
 * Open to anyone holding a link: a card holds only a first name, a score and a fix title.
 * `{ token }` returns `{ ok, card | reason }`; `{ tokens }` returns `{ results: [...] }` in order.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "malformed" }, { status: 400, headers: NO_STORE });

  let secret: string;
  try {
    secret = getFamilySecret();
  } catch (e) {
    if (e instanceof SecretMissingError) {
      return Response.json({ ok: false, reason: "unconfigured" }, { status: 503, headers: NO_STORE });
    }
    throw e;
  }

  const now = Date.now();
  if ("tokens" in parsed.data) {
    return Response.json({ results: parsed.data.tokens.map((t) => verifyToken(t, secret, now)) }, { headers: NO_STORE });
  }
  const res = verifyToken(parsed.data.token, secret, now);
  return Response.json(res, { status: res.ok ? 200 : 400, headers: NO_STORE });
}
