import { getScanSubject } from "@/lib/auth/subject";
import { checkBreaches } from "@/lib/breach";

/**
 * Has the signed-in person's own email appeared in known breaches?
 * The request carries no input: the address comes from the verified session only.
 */
export async function GET(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in to check your email." }, { status: 401, headers: { "cache-control": "no-store" } });

  const url = new URL(request.url);
  if (url.search !== "" || Number(request.headers.get("content-length") ?? 0) > 0) {
    return Response.json({ error: "This check takes no input." }, { status: 400 });
  }

  const outcome = await checkBreaches(subject.email);
  // Outcome only; never the address.
  console.info(`[breach] status=${outcome.status}${outcome.status === "ok" ? ` provider=${outcome.result.provider} n=${outcome.result.breaches.length}` : ""}`);

  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (outcome.status === "rate_limited") headers["retry-after"] = String(outcome.retryAfterSeconds);
  const code = outcome.status === "rate_limited" ? 429 : outcome.status === "error" ? 502 : 200;
  return Response.json(outcome, { status: code, headers });
}
