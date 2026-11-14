import { z } from "zod";
import { getScanSubject } from "@/lib/auth/subject";
import { firstNameFromSubject } from "@/lib/family/card";
import { SecretMissingError, buildCard, getFamilySecret, memberId, signCard } from "@/lib/family/token";

const Body = z.object({
  score: z.number().min(0).max(100),
  topFixTitle: z.string().max(400),
  chainsBroken: z.number().int().min(0).max(999),
  chainsTotal: z.number().int().min(0).max(999),
});

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Mints a signed family card for the signed-in person. Stateless: nothing is stored.
 * The first name comes from the verified session, never from the body.
 */
export async function POST(req: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });

  let secret: string;
  try {
    secret = getFamilySecret();
  } catch (e) {
    if (e instanceof SecretMissingError) {
      return Response.json({ error: "Family cards are not configured." }, { status: 503, headers: NO_STORE });
    }
    throw e;
  }

  const card = buildCard({
    id: memberId(secret, subject.email),
    firstName: firstNameFromSubject(subject),
    ...parsed.data,
  });
  return Response.json({ token: signCard(card, secret), card }, { headers: NO_STORE });
}
