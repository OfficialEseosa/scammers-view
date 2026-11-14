import type { ZodType } from "zod";
import { getScanSubject } from "@/lib/auth/subject";
import { isLlmConfigured, LlmNotConfiguredError, LlmOutputError, LlmRefusalError } from "@/lib/llm/gemini";
import { VisionFetchError } from "./fetch";
import { takeQuota } from "./limits";

/** Shared POST handling for /api/vision/photo and /api/vision/video. */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleVision<Req>(
  request: Request,
  kind: "photo" | "video",
  schema: ZodType<Req>,
  run: (req: Req, signal: AbortSignal) => Promise<unknown>,
): Promise<Response> {
  // Only the signed-in person may use this; the subject is never taken from the request.
  const subject = await getScanSubject();
  if (!subject) return json({ error: "Sign in first" }, 401);
  if (!isLlmConfigured()) return json({ error: "Gemini is not set up", code: "llm_not_configured" }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  if (!takeQuota(kind, subject.email)) return json({ error: "Hourly limit reached. Try later." }, 429);

  try {
    return json(await run(parsed.data, request.signal));
  } catch (e) {
    // Log the class of failure only (never URLs, images or model output).
    console.warn(`[vision/${kind}] ${e instanceof Error ? e.name : "error"}`);
    if (e instanceof VisionFetchError) return json({ error: e.message }, e.status === 400 || e.status === 403 ? e.status : 502);
    if (e instanceof LlmNotConfiguredError) return json({ error: "Gemini is not set up", code: "llm_not_configured" }, 503);
    if (e instanceof LlmRefusalError) return json({ error: "Gemini declined this one" }, 422);
    if (e instanceof LlmOutputError) return json({ error: "Gemini's answer was unreadable. Try again." }, 502);
    const name = (e as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") return json({ error: "Took too long" }, 504);
    return json({ error: "Could not analyse this one" }, 502);
  }
}
