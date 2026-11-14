import type { z } from "zod";
import { extractText, getGemini, LlmOutputError, LlmRefusalError, toGeminiSchema, type LlmUsage } from "@/lib/llm/gemini";

/**
 * One multimodal structured-output call on the Interactions API.
 *
 * Why not generateJson({ parts }): on the current API (v1) a multi-part
 * `input` must be a list of STEPS, so text + media go inside one
 * `{ type: "user_input", content: [...] }` step. A bare content list is
 * rejected with 400 "'text' is not supported for 'input[1].type' in v1"
 * (seen live 2026-11-14). This helper sends the documented step shape and
 * reuses the shared client, schema conversion and text extraction.
 */

type AnyRec = Record<string, unknown>;

export interface VisionCall<S extends z.ZodType> {
  model: string;
  system: string;
  prompt: string;
  /** One Interactions content block: { type: "image" | "video" | "audio", data | uri, mime_type, ... }. */
  media: AnyRec;
  schema: S;
  signal: AbortSignal;
  thinking?: "minimal" | "low" | "medium" | "high";
}

function readUsage(model: string, usage: AnyRec | undefined): LlmUsage {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { model, inputTokens: n(usage?.total_input_tokens), outputTokens: n(usage?.total_output_tokens), thoughtTokens: n(usage?.total_thought_tokens), searchQueries: 0 };
}

const addUsage = (a: LlmUsage | undefined, b: LlmUsage): LlmUsage =>
  a ? { ...a, inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, thoughtTokens: a.thoughtTokens + b.thoughtTokens } : b;

function parseJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
    throw new SyntaxError("No JSON in model output");
  }
}

export async function callVisionJson<S extends z.ZodType>(c: VisionCall<S>): Promise<{ data: z.output<S>; usage: LlmUsage }> {
  const client = getGemini();
  const create = client.interactions.create.bind(client.interactions) as unknown as (p: AnyRec, o?: AnyRec) => Promise<AnyRec>;
  const schema = toGeminiSchema(c.schema);
  let usage: LlmUsage | undefined;
  let lastError = "";

  // One repair retry when the JSON does not validate.
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? c.prompt : `${c.prompt}\n\nYour previous answer did not match the schema (${lastError.slice(0, 300)}). Return only valid JSON.`;
    const interaction = await create(
      {
        model: c.model,
        system_instruction: c.system,
        input: [{ type: "user_input", content: [{ type: "text", text: prompt }, c.media] }],
        store: false,
        generation_config: { thinking_level: c.thinking ?? "low" },
        response_format: { type: "text", mime_type: "application/json", schema },
      },
      { fetch_options: { signal: c.signal } },
    );
    c.signal.throwIfAborted();
    usage = addUsage(usage, readUsage(c.model, interaction.usage as AnyRec | undefined));
    const text = extractText(interaction as Parameters<typeof extractText>[0]);
    if (!text.trim()) throw new LlmRefusalError(String(interaction.status ?? "empty_response"));
    try {
      const parsed = c.schema.safeParse(parseJson(text));
      if (parsed.success) return { data: parsed.data, usage };
      lastError = parsed.error.issues[0]?.message ?? "invalid";
    } catch (e) {
      lastError = e instanceof Error ? e.message : "invalid JSON";
    }
  }
  throw new LlmOutputError(`Gemini returned invalid JSON after one repair: ${lastError}`);
}
