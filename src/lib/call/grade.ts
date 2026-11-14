import { z } from "zod";
import { MODELS, generateJson, isLlmConfigured } from "@/lib/llm/gemini";
import type { CallState } from "./agent";
import type { CheckId, ScoreCheck, Scorecard } from "./schema";
import { readSignals } from "./signals";

const WEIGHT: Record<CheckId, number> = { verified: 20, secret: 15, refused: 25, callback: 15, hungUp: 10, noInfo: 15 };

/** Rule-based scorecard. Deterministic, so it works with no API key and is easy to test. */
export function gradeRules(state: CallState): Scorecard {
  const said = state.transcript.filter((l) => l.speaker === "you").map((l) => l.text);
  const sigs = said.map(readSignals);
  const any = (k: keyof ReturnType<typeof readSignals>) => sigs.some((s) => s[k]);
  const complied = any("comply");
  const revealed = any("revealedNumber");
  const s = state.scenario;

  const checks: ScoreCheck[] = [
    {
      id: "verified",
      label: "Asked who was really calling",
      passed: any("verify"),
      detail: any("verify") ? "You questioned the caller instead of taking the story at face value." : "Ask for a name, a department or an official number you can check yourself.",
    },
    {
      id: "secret",
      label: s.safeWordExpected ? "Asked for the family safe word" : "Asked something only the real person would know",
      passed: any("secret"),
      detail: any("secret")
        ? "A question a stranger can't answer is the fastest way to end this."
        : s.safeWordExpected
          ? "Agree a family safe word now, and ask for it on any panicked call."
          : "A detail only the real person knows beats anything a scammer read online.",
    },
    {
      id: "refused",
      label: "Refused to pay or hand anything over",
      passed: any("refuse") && !complied,
      detail: complied ? "You agreed to the ask. In a real call, that is where the money or the number goes." : any("refuse") ? "You said no clearly." : "Say no out loud. Scammers keep pushing until you do.",
    },
    {
      id: "callback",
      label: "Offered to call back on a number you already have",
      passed: any("callback"),
      detail: any("callback") ? "Calling back on a known number defeats spoofed numbers and cloned voices." : "Hang up and call the person or company on a number you already have.",
    },
    {
      id: "hungUp",
      label: "Hung up before the scammer finished",
      passed: state.endedBy === "you",
      detail: state.endedBy === "you" ? "You ended the call yourself." : "You can hang up at any time. You don't owe a caller the end of their pitch.",
    },
    {
      id: "noInfo",
      label: "Didn't give away numbers or codes",
      passed: !revealed && !complied,
      detail: revealed ? "You read out a number. We blanked it, but a real scammer would keep it." : "Nothing sensitive left your mouth.",
    },
  ];

  const score = checks.reduce((n, c) => n + (c.passed ? WEIGHT[c.id] : 0), 0);
  return {
    score,
    verdict: complied || revealed ? "caught" : score >= 60 ? "safe" : score >= 35 ? "close" : "caught",
    checks,
    usedFindingIds: s.details.filter((d) => state.transcript.some((l) => l.speaker === "scammer" && l.text.includes(d.value))).map((d) => d.findingId),
    source: "rules",
  };
}

const GradeOut = z.object({
  checks: z.array(z.object({ id: z.string(), passed: z.boolean(), detail: z.string() })),
});

/**
 * Rules first, then an optional model pass that can correct individual checks (rules miss paraphrases).
 * "Gave something away" stays rule-owned: the model can never clear it.
 */
export async function gradeCall(state: CallState, useModel = isLlmConfigured()): Promise<Scorecard> {
  const rules = gradeRules(state);
  if (!useModel || !state.transcript.some((l) => l.speaker === "you")) return rules;
  try {
    const parsed = await generateJson({
      model: process.env.GEMINI_MODEL_CALL?.trim() || MODELS.fast,
      maxOutputTokens: 1200,
      timeoutMs: 20_000,
      schema: GradeOut,
      system:
        "You grade a scam-awareness practice call. For each check id, decide if the trainee (THEM) passed, with one short, kind sentence of feedback in second person. " +
        "Check ids: verified (questioned who was calling), secret (asked something only the real person would know, or a safe word), " +
        "refused (clearly declined to pay or hand anything over, and never agreed), callback (offered to hang up and call back on a known number), " +
        "hungUp (ended the call themselves), noInfo (gave no numbers, codes or personal data).",
      prompt:
        `Scam: ${state.scenario.name}. Call ended by: ${state.endedBy ?? "unknown"}.\n` +
        state.transcript.map((l) => `${l.speaker === "scammer" ? "SCAMMER" : "THEM"}: ${l.text}`).join("\n"),
    });
    const byId = new Map(parsed.checks.map((c) => [c.id, c]));
    const checks = rules.checks.map((c) => {
      const m = byId.get(c.id);
      if (!m || c.id === "hungUp" || (c.id === "noInfo" && !c.passed)) return c;
      const detail = m.detail.trim().slice(0, 240);
      return { ...c, passed: Boolean(m.passed), detail: detail || c.detail };
    });
    const caught = !checks.find((c) => c.id === "noInfo")?.passed;
    const score = checks.reduce((n, c) => n + (c.passed ? WEIGHT[c.id] : 0), 0);
    return { ...rules, checks, score, verdict: caught ? "caught" : score >= 60 ? "safe" : score >= 35 ? "close" : "caught", source: "model" };
  } catch {
    return rules;
  }
}
