import { z } from "zod";
import { MODELS, generateJson, isLlmConfigured } from "@/lib/llm/gemini";
import type { CallScenario } from "./scenarios";
import type { TranscriptLine } from "./schema";
import { readSignals, redact, type Signals } from "./signals";

/*
 * The scammer's side of a practice call. Channel-agnostic: the simulated browser call
 * and the live-call agent both drive it one utterance at a time.
 * Escalation: open -> pressure -> (pivot when challenged) -> close -> done.
 */

export type Phase = "open" | "pressure" | "pivot" | "close" | "done";

export interface CallState {
  scenario: CallScenario;
  phase: Phase;
  transcript: TranscriptLine[];
  scammerTurns: number;
  endedBy?: "you" | "scammer";
}

export const PRACTICE_TAG = "This was a practice call from Scammer's View.";
const MAX_SCAMMER_TURNS = 8;
const MAX_LINE = 320;

/** Spoken lines must never carry anything that could be used for real: links, long numbers, account details. */
export function safeLine(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > MAX_LINE) return false;
  return !/https?:|www\.|\.(com|net|org|io)\b|\d{4,}|routing|account number|wallet|bitcoin|crypto address|@\w/i.test(t);
}

const lead = (s: CallScenario, i = 0) => s.details[i]?.value;

function scripted(s: CallScenario, phase: Phase, sig: Signals | null, turn: number): string {
  const d0 = lead(s, 0);
  const d1 = lead(s, 1);
  const lines: Record<CallScenario["id"], Record<Exclude<Phase, "done">, string[]>> = {
    "fake-recruiter": {
      open: [`Hi, this is Jordan from campus recruiting. I came across your profile${d0 ? ` and saw ${d0}` : ""}, and we'd love to fast-track you for a paid summer internship. Do you have two minutes?`],
      pressure: [
        `Great. The team was really impressed${d1 ? `, especially with ${d1}` : ""}. We just need to run the background check today, so I'll need your Social Security number.`,
        "Offers like this usually go in an hour. If we can get the background check done now, you're set.",
      ],
      pivot: ["Totally fair to ask. Your professor actually recommended you personally, and the hiring manager is waiting on the other line. I really don't want you to lose this."],
      close: ["So can you read me the number now? Then I can send the offer letter straight away.", "Last chance before I give the spot to the next candidate. Can we finish this now?"],
    },
    "professor-gift-cards": {
      open: [`Hey, it's me, calling from a new number. Are you free for a quick favor${d0 ? `? It's about ${d0}` : ""}?`],
      pressure: [
        "I'm putting together a surprise for the team and I'm stuck in meetings all day. Could you pick up a few gift cards on your way? I'll pay you back tonight.",
        "It's really time-sensitive. I just need you to read me the card numbers once you have them.",
      ],
      pivot: ["I know it's an odd ask, I'm sorry. I'm about to walk into a meeting and it's embarrassing to ask anyone else. Please keep it between us."],
      close: ["Can you grab them now and call me back with the numbers? I promise I'll pay you back tonight.", "I really need this in the next half hour. Can you do it?"],
    },
    "family-voice-clone": {
      open: [`It's me. I'm in trouble and my phone died, so I'm calling from someone else's${d0 ? `. I'm near ${d0}` : ""}. Please don't freak out.`],
      pressure: [
        `I had an accident and I need money right now to sort it out. Please don't tell ${d1 ?? "anyone else"} yet, I don't want everyone to panic.`,
        "I can't explain everything right now, I just need you to send it as soon as possible.",
      ],
      pivot: ["Hang on, I'm passing you to the lawyer who's helping me. He says it has to be paid within the hour or it gets much worse."],
      close: ["Please, can you send it now? I'll explain everything later.", "I'm begging you, I don't have long on this phone."],
    },
  };
  if (phase === "pressure" && sig?.hesitate) return "I know it's sudden, but I really need your help with this right now.";
  const pool = lines[s.id][phase as Exclude<Phase, "done">];
  return pool[turn % pool.length];
}

function closingLine(s: CallScenario, comply: boolean): string {
  const said = comply
    ? "Okay, thank you. That's everything I needed."
    : s.id === "family-voice-clone"
      ? "Fine. I have to go."
      : "Alright, forget it then.";
  return `${said} ${PRACTICE_TAG}`;
}

export function startCall(scenario: CallScenario): { state: CallState; line: string } {
  const line = scripted(scenario, "open", null, 0);
  return {
    state: { scenario, phase: "open", transcript: [{ speaker: "scammer", text: line }], scammerTurns: 1 },
    line,
  };
}

function advance(state: CallState, sig: Signals): Phase {
  if (state.scammerTurns >= MAX_SCAMMER_TURNS) return "done";
  const challenged = sig.verify || sig.secret || sig.callback || sig.refuse;
  switch (state.phase) {
    case "open":
      return "pressure";
    case "pressure":
      return challenged ? "pivot" : "close";
    case "pivot":
      return "close";
    case "close":
      return sig.comply || sig.refuse || sig.callback ? "done" : "close";
    default:
      return "done";
  }
}

const LineOut = z.object({ line: z.string() });

const PHASE_BRIEF: Record<Exclude<Phase, "done">, string> = {
  open: "Introduce yourself and build trust.",
  pressure: "Make the ask and add urgency. If they hesitate, reassure them and push gently.",
  pivot: "They pushed back. Change your story using the pivot below, without admitting anything.",
  close: "Make the final ask, firmly and briefly.",
};

async function modelLine(state: CallState, phase: Exclude<Phase, "done">): Promise<string | null> {
  const s = state.scenario;
  const transcript = state.transcript.map((l) => `${l.speaker === "scammer" ? "YOU" : "THEM"}: ${l.text}`).join("\n");
  const out = await generateJson({
    model: process.env.GEMINI_MODEL_CALL?.trim() || MODELS.fast,
    maxOutputTokens: 400,
    timeoutMs: 8000,
    schema: LineOut,
    system:
      "You play the scammer in a scam-awareness training call. The person on the line signed in, chose this drill and dialled in themselves; " +
      "the goal is for them to practise spotting and refusing a scam that uses their own public details. " +
      `You are: ${s.persona}. They are: ${s.userRole}. Your goal: ${s.goal} Pivot if challenged: ${s.pivot} ` +
      "Speak naturally, one turn only, under 35 words. Use at most one of the supplied details per turn, copying its wording. " +
      "Never include links, phone numbers, account numbers, any number of 4 or more digits, payment app handles or real payment instructions. " +
      "Never say you are an AI or that this is practice; the app handles that.",
    prompt:
      `Details you may use:\n${s.details.map((d) => `- ${d.label}: ${d.value}`).join("\n") || "(none)"}\n\n` +
      `Call so far:\n${transcript}\n\nThis turn: ${PHASE_BRIEF[phase]}`,
  });
  const line = out.line.trim();
  return safeLine(line) ? line : null;
}

export interface TurnOptions {
  /** Pass false to force scripted lines (tests). Defaults to whether Gemini is configured. */
  useModel?: boolean;
}

export async function nextTurn(
  state: CallState,
  utterance: string,
  opts: TurnOptions & { hangup?: boolean } = {},
): Promise<{ state: CallState; line: string | null; ended: boolean }> {
  if (state.phase === "done") return { state, line: null, ended: true };
  const said = redact(utterance.trim()).slice(0, 600);
  const transcript = said ? [...state.transcript, { speaker: "you" as const, text: said }] : state.transcript;

  if (opts.hangup) {
    return { state: { ...state, transcript, phase: "done", endedBy: "you" }, line: null, ended: true };
  }

  const sig = readSignals(said);
  const phase = advance(state, sig);
  if (phase === "done") {
    const line = closingLine(state.scenario, sig.comply);
    return {
      state: { ...state, transcript: [...transcript, { speaker: "scammer", text: line }], phase, scammerTurns: state.scammerTurns + 1, endedBy: "scammer" },
      line,
      ended: true,
    };
  }

  let line: string | null = null;
  if (opts.useModel ?? isLlmConfigured()) {
    try {
      line = await modelLine({ ...state, transcript }, phase);
    } catch {
      line = null;
    }
  }
  line ??= scripted(state.scenario, phase, sig, state.scammerTurns);

  return {
    state: { ...state, transcript: [...transcript, { speaker: "scammer", text: line }], phase, scammerTurns: state.scammerTurns + 1 },
    line,
    ended: false,
  };
}
