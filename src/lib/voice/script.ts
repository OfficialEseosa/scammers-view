import Anthropic from "@anthropic-ai/sdk";
import type { Finding } from "@/lib/types";

export interface VoicemailScript {
  text: string;
  /** Personal details used in the text, each tied to a Finding. */
  uses: { findingId: string; phrase: string }[];
  source: "model" | "template";
}

const PRACTICE_TAG = "This was a practice voicemail from Scammer's View.";
const USEFUL: Finding["category"][] = ["relative", "pet", "school", "location", "employer", "interest", "schedule", "handle"];

function pick(findings: Finding[]): Finding[] {
  return [...findings]
    .filter((f) => USEFUL.includes(f.category) && f.value.trim().length > 0 && f.value.length < 80)
    .sort((a, b) => b.riskWeight - a.riskWeight)
    .slice(0, 8);
}

function finish(text: string, uses: VoicemailScript["uses"], source: VoicemailScript["source"]): VoicemailScript {
  return { text: `${text} ${PRACTICE_TAG}`, uses, source };
}

/** Deterministic fallback; always safe, always generic about money. */
export function templateScript(findings: Finding[]): VoicemailScript {
  const usable = pick(findings);
  const rel = usable.find((f) => f.category === "relative");
  const place = usable.find((f) => f.category === "school" || f.category === "location");
  const uses: VoicemailScript["uses"] = [];
  let text = "Hey, it's me. I'm in trouble, and my phone died so I'm calling from someone else's.";
  if (place) {
    text += ` I'm near ${place.value} and I can't get home.`;
    uses.push({ findingId: place.id, phrase: place.value });
  }
  if (rel) {
    text += ` Please don't tell ${rel.value} yet, I don't want to scare anyone.`;
    uses.push({ findingId: rel.id, phrase: rel.value });
  }
  text += " I need you to send money, I'll explain later. Please hurry.";
  return finish(text, uses, "template");
}

const SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    uses: {
      type: "array",
      items: {
        type: "object",
        properties: { findingId: { type: "string" }, phrase: { type: "string" } },
        required: ["findingId", "phrase"],
        additionalProperties: false,
      },
    },
  },
  required: ["text", "uses"],
  additionalProperties: false,
} as const;

export async function generateScript(findings: Finding[], subjectName: string): Promise<VoicemailScript> {
  const usable = pick(findings);
  if (!process.env.ANTHROPIC_API_KEY) return templateScript(findings);
  try {
    const client = new Anthropic();
    const list = usable.map((f) => `- id=${f.id} | ${f.label}: ${f.value}`).join("\n");
    const res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 1200,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system:
        "You write a short fake 'family emergency' voicemail for a scam-awareness training tool. " +
        "The person it imitates has consented: it plays only to themselves, in the app, to show how a scammer could use their public information. " +
        "Write in first person as the person, speaking to a parent or close relative. Spoken length under 18 seconds (about 40 words). " +
        "Weave in 2-3 of the supplied personal details naturally, copying each detail's wording exactly into `phrase` and its id into `findingId`. " +
        "The ask must stay generic: 'I need you to send money, I'll explain later'. " +
        "Never include account numbers, payment apps, wire or gift-card instructions, phone numbers, URLs, or any real payment detail. " +
        "Do not add a practice disclaimer; the app adds one.",
      messages: [
        {
          role: "user",
          content: `Person's first name: ${subjectName.split(" ")[0]}\nPublic details found:\n${list || "(none)"}`,
        },
      ],
    });
    if (res.stop_reason === "refusal") return templateScript(findings);
    const block = res.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return templateScript(findings);
    const parsed = JSON.parse(block.text) as { text?: string; uses?: { findingId: string; phrase: string }[] };
    const text = (parsed.text ?? "").trim();
    if (text.length < 20 || text.length > 600 || /https?:|www\.|\d{4,}/i.test(text)) return templateScript(findings);
    const ids = new Set(usable.map((f) => f.id));
    const uses = (parsed.uses ?? []).filter(
      (u) => ids.has(u.findingId) && u.phrase && text.toLowerCase().includes(u.phrase.toLowerCase()),
    );
    return finish(text, uses, "model");
  } catch {
    return templateScript(findings);
  }
}
