import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AttackChain, ExposureScore, type Finding } from "@/lib/types";

/**
 * One reasoning call over the findings only (no tools, no browsing):
 * an exposure score and 1-3 attack chains whose steps cite real finding ids.
 */

// Output schema for the model. Kept constraint-free for structured outputs;
// contract ranges are enforced after parsing.
const ReasoningOutput = z.object({
  score: z.number(),
  topFindingIds: z.array(z.string()),
  summary: z.string(),
  duplicateGroups: z.array(z.array(z.string())),
  chains: z.array(
    z.object({
      target: z.string(),
      severity: z.number(),
      steps: z.array(
        z.object({
          title: z.string(),
          description: z.string(),
          findingIds: z.array(z.string()),
          enables: z.string(),
        }),
      ),
    }),
  ),
});

const SYSTEM = `You are the analyst inside "Scammer's View", a privacy self-audit tool. The signed-in user scanned their own public footprint. You receive the facts our agents found about them. Your job is to show the user, concretely, how a scammer would combine these facts against them, so they know what to lock down first.

Produce:
1. An exposure score 0-100 (0 = almost nothing useful public, 100 = trivially impersonated/taken over). Weigh riskWeight, confidence and anchor: unconfirmed low-confidence findings count much less. Few findings means a low score.
2. topFindingIds: the (at most) 3 findings that most help an attacker.
3. summary: ONE plain-English sentence to the user, second person.
4. 1-3 attack chains, most severe first. Each chain has a target (e.g. "School email account", "Instagram account", "Bank account via SIM swap"), a severity 0-10 and 3-5 steps. Each step: short title, a 1-2 sentence description written to the user explaining how the attacker uses the cited facts, the findingIds it relies on (ONLY ids from the list), and what it enables next. Typical patterns: exposed email + security-answer facts (pet, school, hometown, birthday) -> password reset; facts that make a phishing or pretexting message convincing (school, club, schedule, relatives' names) -> credential phish; phone + personal details -> SIM-swap pretext; handles linking accounts together.

5. duplicateGroups: groups of finding ids that state the same fact in different words (e.g. "@jdoe" and "instagram.com/jdoe", "UC Berkeley" and "University of California, Berkeley"). Put the id to keep first. Only true duplicates; [] if none. Cite only the kept id in topFindingIds and chains.

Rules: reason only over the provided findings; do not invent facts. Keep it at the level of a security-awareness explanation: no working phishing text, no tool names or step-by-step instructions for breaking into a specific service. If there are too few findings for a credible chain, return one short chain that uses what exists.`;

export interface ReasoningResult {
  score: ExposureScore;
  chains: AttackChain[];
  usage: { input: number; output: number };
  merged: number;
}

export async function runReasoning(
  findings: Finding[],
  opts: { client: Anthropic; model: string; signal: AbortSignal },
): Promise<ReasoningResult> {
  const ids = new Set(findings.map((f) => f.id));
  if (findings.length === 0) {
    return {
      score: { score: 0, topFindingIds: [], summary: "We found almost nothing about you on the public web, which leaves a scammer very little to work with." },
      chains: [],
      usage: { input: 0, output: 0 },
      merged: 0,
    };
  }
  const compact = findings.map((f) => ({
    id: f.id,
    category: f.category,
    label: f.label,
    value: f.value,
    source: f.sourceType,
    anchor: f.anchor,
    confidence: f.confidence,
    riskWeight: f.riskWeight,
    sourceCount: f.sources?.length ?? 1,
  }));

  const res = await opts.client.beta.messages.parse(
    {
      model: opts.model,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: "medium", format: betaZodOutputFormat(ReasoningOutput) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: `Findings (JSON):\n${JSON.stringify(compact, null, 1)}` }],
    },
    { signal: opts.signal },
  );
  if (res.stop_reason === "refusal" || !res.parsed_output) {
    throw new Error(`reasoning produced no output (stop_reason=${res.stop_reason})`);
  }
  const out = res.parsed_output;
  // Near-duplicate merge: map every duplicate id to its kept id.
  const canon = new Map<string, string>();
  let merged = 0;
  for (const g of out.duplicateGroups) {
    const valid = g.filter((id) => ids.has(id));
    if (valid.length < 2) continue;
    for (const id of valid.slice(1)) {
      if (!canon.has(id)) {
        canon.set(id, valid[0]);
        merged++;
      }
    }
  }
  const mapIds = (list: string[]) => [...new Set(list.filter((id) => ids.has(id)).map((id) => canon.get(id) ?? id))];
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

  const score = ExposureScore.parse({
    score: Math.round(clamp(out.score, 0, 100)),
    topFindingIds: mapIds(out.topFindingIds).slice(0, 3),
    summary: out.summary.trim(),
  });

  const chains: AttackChain[] = [];
  out.chains.slice(0, 3).forEach((c, ci) => {
    const steps = c.steps
      .map((s, si) => ({
        id: `c${ci + 1}s${si + 1}`,
        title: s.title.trim(),
        description: s.description.trim(),
        findingIds: mapIds(s.findingIds),
        enables: s.enables?.trim() || undefined,
      }))
      .filter((s) => s.title);
    if (steps.length === 0 || !steps.some((s) => s.findingIds.length > 0)) return;
    const parsed = AttackChain.safeParse({ id: `c${ci + 1}`, target: c.target.trim(), steps, severity: Math.round(clamp(c.severity, 0, 10) * 10) / 10 });
    if (parsed.success) chains.push(parsed.data);
  });

  return {
    score,
    chains,
    usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
    merged,
  };
}
