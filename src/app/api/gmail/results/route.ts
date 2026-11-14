import { getSessionSubject } from "@/lib/auth/subject";
import { forgetInboxResults, inboxOwner, takeInboxResults } from "@/lib/gmail/store";

const NO_STORE = { "cache-control": "no-store" };

/**
 * POST: the signed-in student's inbox-check results. While the check runs this answers
 * { status: "working" }; finished results are deleted from the server as they are sent.
 * DELETE: forget them now (also cancels a running check's results).
 */
export async function POST() {
  const subject = await getSessionSubject();
  if (!subject) return Response.json({ status: "signin" }, { status: 401, headers: NO_STORE });
  const entry = takeInboxResults(inboxOwner(subject.email));
  if (!entry) return Response.json({ status: "none" }, { headers: NO_STORE });
  if (entry.status === "working") return Response.json({ status: "working" }, { headers: NO_STORE });
  if (entry.status === "error") return Response.json({ status: "error", message: entry.message }, { headers: NO_STORE });
  return Response.json({ status: "done", results: entry.results }, { headers: NO_STORE });
}

export async function DELETE() {
  const subject = await getSessionSubject();
  if (subject) forgetInboxResults(inboxOwner(subject.email));
  return new Response(null, { status: 204, headers: NO_STORE });
}
