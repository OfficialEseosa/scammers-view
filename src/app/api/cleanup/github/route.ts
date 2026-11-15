import { z } from "zod";
import { getScanSubject } from "@/lib/auth/subject";
import { takeCheck } from "@/lib/check/limits";
import { setGithubEmailPrivacy } from "@/lib/cleanup/github";
import { addLog, logOwner } from "@/lib/cleanup/log";

const NO_STORE = { "cache-control": "no-store" };
const Body = z.object({ token: z.string().trim().min(20).max(200) });

/**
 * One-click: set GitHub email visibility to private. The token is used for this request only
 * and never stored. The student creates it at github.com/settings/tokens.
 */
export async function POST(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  if (!takeCheck("browser", subject.email)) return Response.json({ error: "That's a lot of cleanups. Try again later." }, { status: 429, headers: NO_STORE });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Paste a GitHub personal access token." }, { status: 400, headers: NO_STORE });

  const result = await setGithubEmailPrivacy(parsed.data.token);
  if (result.ok) {
    addLog(logOwner(subject.email), {
      site: "GitHub",
      taskId: "settings:github-email",
      outcome: "github",
      note: "Set your GitHub email to private.",
    });
  }
  return Response.json(result, { status: result.ok ? 200 : 400, headers: NO_STORE });
}
