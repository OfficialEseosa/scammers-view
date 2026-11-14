import { MODELS, generateText, isLlmConfigured } from "@/lib/llm/gemini";
import { MAX_CHECK_CHARS } from "./shared";

const NONE = "NONE";

/**
 * Reads the message text out of a shared screenshot with Gemini, so it can go through the
 * same checker as pasted text. The image is sent once and never stored. Returns null when
 * Gemini isn't set up, fails, or finds no message.
 */
export async function readScreenshot(shot: File, signal?: AbortSignal): Promise<string | null> {
  if (!isLlmConfigured()) return null;
  try {
    const data = Buffer.from(await shot.arrayBuffer()).toString("base64");
    const out = await generateText({
      model: MODELS.fast,
      maxOutputTokens: 1500,
      timeoutMs: 25_000,
      signal,
      system:
        "You transcribe screenshots of messages (texts, emails, DMs, pop-ups) so a scam checker can read them. " +
        "Copy the message wording exactly, including links, phone numbers and sender names shown. " +
        "Leave out phone status bars, keyboards, app buttons and timestamps. " +
        "Never describe or identify people in photos. " +
        `If there is no readable message, reply with exactly ${NONE}.`,
      prompt: "Transcribe the message in this screenshot.",
      parts: [{ mimeType: shot.type, data }],
    });
    const text = out.trim();
    return !text || text === NONE ? null : text.slice(0, MAX_CHECK_CHARS);
  } catch {
    return null;
  }
}
