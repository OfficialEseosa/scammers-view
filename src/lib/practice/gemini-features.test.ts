// Run: npx tsx --test src/lib/practice/gemini-features.test.ts
// Mocks the Gemini client used by src/lib/llm/gemini.ts. Nothing here calls the network.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { FIXTURE_FINDINGS as findings } from "@/lib/fixes/fixture";
import { __setGeminiClientForTests } from "@/lib/llm/gemini";
import { fallbackItems } from "@/lib/quiz/fallback";
import { generateQuiz } from "@/lib/quiz/generate";
import { generateScript } from "@/lib/voice/script";
import { generatePractice } from "./generate";

const subject = { name: "Alex Rivera", email: "alex.rivera@example.com", school: "Lakeview High School" };

type Reply = string | Error | { status: string };
function mock(replies: Reply[]) {
  let n = 0;
  __setGeminiClientForTests({
    interactions: {
      create: async () => {
        const r = replies[Math.min(n++, replies.length - 1)];
        if (r instanceof Error) throw r;
        if (typeof r === "string") {
          return { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: r }] }] };
        }
        return { status: r.status, steps: [] };
      },
    },
  });
  return () => n;
}
afterEach(() => __setGeminiClientForTests(null));

const body = "Hi Alex, the Student Accounts Office owes you a refund. Verify now at https://finaid-portal.example/verify or it expires today.";
const draft = (quotes: string[]) =>
  JSON.stringify({
    from_name: "Student Accounts Office",
    from_address: "refunds@finaid-portal.example",
    subject: null,
    body,
    tells: quotes.map((q) => ({ quote: q, explanation: "Because.", finding_id: null, category: "urgency" })),
    what_to_do: ["Look up the official website yourself."],
  });

test("practice: success keeps only tells that are substrings of the body", async () => {
  mock([draft(["it expires today", "owes you a refund", "not in the body at all"])]);
  const { result } = await generatePractice({ subject, findings, kind: "sms", scenario: "financial_aid_refund" });
  assert.equal(result.mode, "message");
  if (result.mode !== "message") return;
  assert.equal(result.provider, "gemini");
  assert.equal(result.tells.length, 2);
  for (const t of result.tells) assert.ok(result.body.includes(t.quote));
});

test("practice: tells that don't match -> tellsOnly", async () => {
  mock([draft(["nope one", "nope two"])]);
  const { result, attempts } = await generatePractice({ subject, findings, kind: "sms", scenario: "rental_deposit" });
  assert.equal(result.mode, "tellsOnly");
  assert.ok(attempts.every((a) => a.outcome === "invalid"));
});

test("practice: invalid JSON twice -> tellsOnly (invalid)", async () => {
  mock(["not json", "still not json"]);
  const { result, attempts } = await generatePractice({ subject, findings, kind: "email", scenario: "professor_message" });
  assert.equal(result.mode, "tellsOnly");
  assert.equal(attempts[0].outcome, "invalid");
});

test("practice: invalid then repaired JSON succeeds", async () => {
  const calls = mock(["oops", draft(["owes you a refund", "it expires today"])]);
  const { result } = await generatePractice({ subject, findings, kind: "sms", scenario: "financial_aid_refund" });
  assert.equal(result.mode, "message");
  assert.equal(calls(), 2);
});

test("practice: refusal/block -> tellsOnly with declined outcome", async () => {
  mock([{ status: "failed" }]);
  const { result, attempts } = await generatePractice({ subject, findings, kind: "sms", scenario: "account_security_alert" });
  assert.equal(result.mode, "tellsOnly");
  assert.equal(attempts[0].outcome, "declined");
});

test("practice: not configured -> tellsOnly, no crash", async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const { result, attempts } = await generatePractice({ subject, findings, kind: "sms", scenario: "campus_job_offer" });
    assert.equal(result.mode, "tellsOnly");
    assert.equal(attempts[0].outcome, "unavailable");
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("quiz: refusal -> deterministic fallback set, source fallback", async () => {
  mock([{ status: "failed" }]);
  const { response, attempt } = await generateQuiz({ subject, findings });
  assert.equal(response.source, "fallback");
  assert.equal(response.items.length, 6);
  assert.match(attempt.detail ?? "", /declined/);
});

test("quiz: invalid output -> fallback", async () => {
  mock(["{}", "{}"]);
  const { response } = await generateQuiz({ subject, findings });
  assert.equal(response.source, "fallback");
  assert.equal(response.items.length, 6);
});

test("quiz: not configured -> fallback", async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const { response } = await generateQuiz({ subject, findings });
    assert.equal(response.source, "fallback");
    assert.equal(fallbackItems(findings, subject.name).length >= 6, true);
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("voice: success uses model text, refusal/invalid/not-configured use template", async () => {
  mock([
    JSON.stringify({
      text: "Hey, it's me, I'm stuck near Lakeview High School and my phone died. Please don't tell Hale. I need you to send money, I'll explain later.",
      uses: [{ findingId: "f-school", phrase: "Lakeview High School" }],
    }),
  ]);
  let s = await generateScript(findings, subject.name);
  assert.equal(s.source, "model");
  assert.ok(s.text.endsWith("practice voicemail from Scammer's View."));

  mock([{ status: "failed" }]);
  s = await generateScript(findings, subject.name);
  assert.equal(s.source, "template");

  mock(["garbage", "garbage"]);
  s = await generateScript(findings, subject.name);
  assert.equal(s.source, "template");

  __setGeminiClientForTests(null);
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    s = await generateScript(findings, subject.name);
    assert.equal(s.source, "template");
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});
