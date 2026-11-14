import { getScanSubject } from "@/lib/auth/subject";
import { generateQuiz } from "@/lib/quiz/generate";
import { QuizRequest } from "@/lib/quiz/schema";

export const maxDuration = 120;

export async function POST(request: Request) {
  // The recipient is always the signed-in person; nothing in the request can change that.
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in to take the quiz." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = QuizRequest.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request.", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }

  const { response, attempt } = await generateQuiz({ subject, findings: parsed.data.findings });
  // Outcome only: never message content or personal values.
  console.info(`[quiz] source=${attempt.source}${attempt.detail ? ` (${attempt.detail})` : ""}`);

  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (process.env.NODE_ENV === "development") {
    headers["x-quiz-source"] = attempt.source;
    if (attempt.detail) headers["x-quiz-detail"] = attempt.detail.replace(/[^\x20-\x7e]/g, "?").slice(0, 120);
  }
  return Response.json(response, { headers });
}
