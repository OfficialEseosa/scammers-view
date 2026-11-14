import { getScanSubject } from "@/lib/auth/subject";
import { generatePractice } from "@/lib/practice/generate";
import { PracticeRequest, PracticeResponse } from "@/lib/practice/schema";

// Node.js runtime is the default (and the only option with cacheComponents enabled).
export const maxDuration = 120;

export async function POST(request: Request) {
  // The recipient is always the signed-in person; nothing in the request can change that.
  const subject = await getScanSubject();
  if (!subject) return Response.json({ error: "Sign in to use practice attacks." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = PracticeRequest.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request.", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }

  const { result, attempts } = await generatePractice({ subject, ...parsed.data });
  // Log outcomes only (never message content or personal values).
  console.info(
    `[practice] ${parsed.data.kind}/${parsed.data.scenario} -> ${result.mode}`,
    attempts.map((a) => `${a.provider}:${a.outcome}${a.detail ? `(${a.detail})` : ""}`).join(" "),
  );

  const out = PracticeResponse.parse(result);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (process.env.NODE_ENV === "development") {
    headers["x-practice-attempts"] = attempts.map((a) => `${a.provider}:${a.outcome}`).join(",");
  }
  return Response.json(out, { headers });
}
