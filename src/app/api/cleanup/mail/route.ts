import { z } from "zod";
import { getScanSubject } from "@/lib/auth/subject";
import { takeCheck } from "@/lib/check/limits";
import { draftRemoval } from "@/lib/cleanup/draft";

const NO_STORE = { "cache-control": "no-store" };

const Body = z.object({
  op: z.literal("draftSite"),
  site: z.string().min(1).max(80),
  listingUrl: z.string().url().max(500),
  fields: z.array(z.object({ label: z.string().max(80), value: z.string().max(200) })).min(1).max(10),
});

/**
 * Writes a removal request for a site that shows the signed-in person's details:
 * the address to send it to, a subject and the message. It never sends anything
 * and has no access to anyone's mailbox; the person sends it themselves.
 */
export async function POST(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  if (!takeCheck("browser", subject.email)) return Response.json({ error: "That's a lot of lookups. Try again later." }, { status: 429, headers: NO_STORE });

  const b = parsed.data;
  const draft = await draftRemoval(
    { name: subject.name, email: subject.email, site: b.site, listingUrl: b.listingUrl, fields: b.fields },
    AbortSignal.timeout(40_000),
  );
  return Response.json(draft, { headers: NO_STORE });
}
