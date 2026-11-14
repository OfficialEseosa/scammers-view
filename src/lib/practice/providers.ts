import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ModelDraft, SYSTEM_PROMPT } from "./prompt";

/** Outcome of one provider attempt. `declined` = the model refused; `invalid` = output unusable. */
export type ProviderResult =
  | { ok: true; draft: ModelDraft }
  | { ok: false; reason: "declined" | "invalid" | "unavailable" | "error"; detail: string };

export interface PracticeProvider {
  readonly name: "claude" | "gemini";
  available(): boolean;
  generate(userPrompt: string): Promise<ProviderResult>;
}

/* ---------------------------------- Claude --------------------------------- */

let anthropic: Anthropic | null = null;

export const claudeProvider: PracticeProvider = {
  name: "claude",
  available: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async generate(userPrompt) {
    anthropic ??= new Anthropic({ timeout: 90_000, maxRetries: 1 });
    const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
    try {
      const res = await anthropic.messages.parse({
        model,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        output_config: { effort: "low", format: zodOutputFormat(ModelDraft) },
        messages: [{ role: "user", content: userPrompt }],
      });
      if (res.stop_reason === "refusal") {
        const cat = res.stop_details?.category ?? "unspecified";
        return { ok: false, reason: "declined", detail: `refusal (category: ${cat})` };
      }
      if (res.stop_reason === "max_tokens") return { ok: false, reason: "invalid", detail: "hit max_tokens" };
      if (!res.parsed_output) return { ok: false, reason: "invalid", detail: "no parsed output" };
      return { ok: true, draft: res.parsed_output };
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        return { ok: false, reason: "error", detail: `Anthropic API ${err.status ?? "?"}` };
      }
      return { ok: false, reason: "invalid", detail: err instanceof Error ? err.message.slice(0, 200) : "unknown" };
    }
  },
};

/* ---------------------------------- Gemini --------------------------------- */
// Gemini REST generateContent with JSON-schema constrained output.
// Docs: https://ai.google.dev/api/generate-content and https://ai.google.dev/gemini-api/docs/structured-output

const GEMINI_BLOCK_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_SAFETY",
  "OTHER",
]);

type GeminiResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
};

export const geminiProvider: PracticeProvider = {
  name: "gemini",
  available: () => Boolean(process.env.GEMINI_API_KEY),
  async generate(userPrompt) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { ok: false, reason: "unavailable", detail: "GEMINI_API_KEY not set" };
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const jsonSchema = z.toJSONSchema(ModelDraft, { target: "draft-7" });
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: jsonSchema,
              maxOutputTokens: 8000,
            },
          }),
          signal: AbortSignal.timeout(90_000),
        },
      );
      if (!r.ok) return { ok: false, reason: "error", detail: `Gemini HTTP ${r.status}` };
      const data = (await r.json()) as GeminiResponse;
      if (data.promptFeedback?.blockReason) {
        return { ok: false, reason: "declined", detail: `blocked: ${data.promptFeedback.blockReason}` };
      }
      const cand = data.candidates?.[0];
      if (!cand) return { ok: false, reason: "declined", detail: "no candidates" };
      if (cand.finishReason && GEMINI_BLOCK_REASONS.has(cand.finishReason)) {
        return { ok: false, reason: "declined", detail: `finishReason: ${cand.finishReason}` };
      }
      const text = cand.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: false, reason: "invalid", detail: "non-JSON output" };
      }
      const parsed = ModelDraft.safeParse(json);
      if (!parsed.success) return { ok: false, reason: "invalid", detail: "schema mismatch" };
      return { ok: true, draft: parsed.data };
    } catch (err) {
      return { ok: false, reason: "error", detail: err instanceof Error ? err.message.slice(0, 200) : "unknown" };
    }
  },
};

export const PROVIDERS: PracticeProvider[] = [claudeProvider, geminiProvider];
