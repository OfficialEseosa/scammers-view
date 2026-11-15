import { z } from "zod";
import { getScanSubject } from "@/lib/auth/subject";
import { takeCheck } from "@/lib/check/limits";
import { isLlmConfigured } from "@/lib/llm/gemini";
import { nextStep } from "@/lib/cleanup/step";
import { taskFor } from "@/lib/cleanup/tasks";
import { Details, PageSnapshot } from "@/lib/cleanup/types";

const NO_STORE = { "cache-control": "no-store" };

const Body = z.object({
  taskId: z.string().max(80),
  details: Details,
  page: PageSnapshot,
  history: z.array(z.string().max(300)).max(40),
});

/**
 * One step of the cleanup agent: page summary in, next action out. Signed-in only. The page
 * summary and details are used for this one model call and never stored or logged.
 */
export async function POST(request: Request) {
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  if (!isLlmConfigured()) return Response.json({ error: "The agent needs GEMINI_API_KEY." }, { status: 503, headers: NO_STORE });
  if (!takeCheck("agent", subject.email)) return Response.json({ error: "That's a lot of steps. Take a short break." }, { status: 429, headers: NO_STORE });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const { taskId, details, page, history } = parsed.data;
  const task = taskFor(taskId, details.listingUrl);
  if (!task) return Response.json({ error: "Unknown site." }, { status: 400, headers: NO_STORE });

  try {
    const action = await nextStep({ task, details, page, history }, AbortSignal.timeout(30_000));
    return Response.json({ action }, { headers: NO_STORE });
  } catch {
    return Response.json(
      { action: { action: "needs_user", say: "I couldn't work out the next step. Please take a look.", submits: false } },
      { headers: NO_STORE },
    );
  }
}
