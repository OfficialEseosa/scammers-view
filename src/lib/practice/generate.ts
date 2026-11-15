import { LlmNotConfiguredError, LlmRefusalError, MODELS, generateJson, isLlmConfigured } from "@/lib/llm/gemini";
import type { Finding, ScanSubject } from "@/lib/types";
import { exposedCategories } from "@/lib/cases/match";
import { searchCases } from "@/lib/cases/search";
import type { CaseHit } from "@/lib/cases/types";
import { ModelDraft, SYSTEM_PROMPT, buildUserPrompt, factsForPrompt, recipientFirstName } from "./prompt";
import { finalizeDraft } from "./sanitize";
import {
  PRACTICE_LABEL,
  SCENARIOS,
  type PracticeKind,
  type PracticeResponse,
  type PracticeScenario,
  type TellsOnly,
} from "./schema";

export type Attempt = { provider: "gemini"; outcome: string; detail?: string };

/** Whole-request deadline (both attempts); past it the route answers with the tells-only lesson. */
const TIMEOUT_MS = 45_000;
/** Practice messages: fast model, low thinking (bench 2026-11-14: tells still exact, ~2x faster than argon). */
const PRACTICE_MODEL = () => process.env.GEMINI_MODEL_PRACTICE?.trim() || MODELS.fast;

/** Kinds of published case that are the same scam as each scenario; anything else is not used. */
const CASE_TYPES: Record<PracticeScenario, string[]> = {
  campus_job_offer: ["job-offer", "money-mule"],
  financial_aid_refund: ["student-loan", "financial-aid"],
  rental_deposit: ["rental"],
  professor_message: ["boss-gift-cards", "business-email-compromise", "known-contact-impersonation"],
  account_security_alert: ["account-takeover", "phishing", "bank-impersonation", "tech-support", "sim-swap"],
};

/** The closest published scam report of the scenario's own kind that this person's exposure allows. */
export async function realCaseFor(findings: Finding[], scenario: PracticeScenario): Promise<CaseHit | undefined> {
  const sc = SCENARIOS.find((s) => s.id === scenario)!;
  try {
    const { byQuery } = await searchCases({ exposed: exposedCategories(findings), queries: [{ id: "s", text: `${sc.label}. ${sc.brief}`.slice(0, 600) }], limit: 12 });
    return byQuery.s?.find((h) => CASE_TYPES[scenario].includes(h.scam_type));
  } catch {
    return undefined;
  }
}

/**
 * Generates a practice message addressed to the signed-in subject with Gemini.
 * A block/refusal, invalid output, or a message whose tells don't match its body
 * falls back to a tells-only lesson. (The shared layer already does one repair
 * retry for schema-invalid JSON.)
 */
export async function generatePractice(args: {
  subject: ScanSubject;
  findings: Finding[];
  kind: PracticeKind;
  scenario: PracticeScenario;
}): Promise<{ result: PracticeResponse; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  if (!isLlmConfigured()) {
    attempts.push({ provider: "gemini", outcome: "unavailable", detail: "GEMINI_API_KEY not set" });
    return { result: buildTellsOnly(args, attempts), attempts };
  }
  const realCase = await realCaseFor(args.findings, args.scenario);
  const userPrompt = buildUserPrompt({ ...args, realCase });
  const addressedTo = recipientFirstName(args.subject);

  // One extra attempt only when the model's tells didn't match its own body, within one deadline.
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  for (let i = 0; i < 2; i++) {
    if (deadline.aborted) break;
    let draft: ModelDraft;
    try {
      draft = await generateJson({
        model: PRACTICE_MODEL(),
        thinking: "low",
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        schema: ModelDraft,
        signal: deadline,
        timeoutMs: TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof LlmRefusalError) {
        attempts.push({ provider: "gemini", outcome: "declined", detail: `blocked: ${err.reason.slice(0, 80)}` });
      } else if (err instanceof LlmNotConfiguredError) {
        attempts.push({ provider: "gemini", outcome: "unavailable", detail: "GEMINI_API_KEY not set" });
      } else {
        attempts.push({
          provider: "gemini",
          outcome: err instanceof Error && err.name === "LlmOutputError" ? "invalid" : "error",
          detail: err instanceof Error ? err.message.slice(0, 120) : "unknown",
        });
      }
      break;
    }
    const msg = finalizeDraft({
      draft,
      kind: args.kind,
      scenario: args.scenario,
      provider: "gemini",
      findings: args.findings,
      addressedTo,
      subjectEmail: args.subject.email,
    });
    if (msg) {
      attempts.push({ provider: "gemini", outcome: "ok", detail: `${msg.tells.length}/${draft.tells.length} tells kept` });
      const basedOn = realCase && { title: realCase.title, source: realCase.source, year: realCase.year, url: realCase.url };
      return { result: basedOn ? { ...msg, basedOn } : msg, attempts };
    }
    attempts.push({ provider: "gemini", outcome: "invalid", detail: "too few tells matched the body" });
  }

  return { result: buildTellsOnly(args, attempts), attempts };
}

const HOW: Record<Finding["category"], string> = {
  school: "Naming your school makes a fake office or professor sound official.",
  employer: "Your workplace lets a scammer pose as HR, a manager or a recruiter.",
  email: "A known address lets them target you directly and guess your logins.",
  phone: "Your number is all they need to text you a lure or try a SIM swap.",
  location: "Your city or neighbourhood makes a rental or local job scam feel real.",
  relative: "A family member's name sets up 'it's your mom/brother' emergencies.",
  pet: "Pet names are common security answers and friendly small-talk bait.",
  birthday: "Birthdays are used for identity checks and 'birthday reward' lures.",
  handle: "Your handles let them find more of your life and message you on other apps.",
  photo: "Photos reveal places, routines and people to reference.",
  schedule: "Knowing your schedule lets them time a message when you're rushed.",
  interest: "Your interests let them tailor a too-good-to-be-true offer.",
  other: "Any personal detail makes a stranger sound like someone who knows you.",
  video: "Public videos of you speaking are enough to clone your voice for a fake emergency call.",
  connection: "The people you follow are public, so a scammer can pose as one of them or reach you through them.",
};

const CLASSIC: Record<PracticeScenario, { category: TellsOnly["tells"][number]["category"]; explanation: string }[]> = {
  campus_job_offer: [
    { category: "too_good", explanation: "High pay for little work with no interview is the hook." },
    { category: "payment_request", explanation: "Any job that asks you to buy equipment or forward a check first is a scam." },
  ],
  financial_aid_refund: [
    { category: "payment_request", explanation: "Real refunds never require a fee to release them." },
    { category: "link", explanation: "A link to 'verify' your account instead of your school's portal you open yourself." },
  ],
  rental_deposit: [
    { category: "payment_request", explanation: "A deposit before you've seen the place or signed a lease, via a payment app." },
    { category: "urgency", explanation: "'Other people are interested' pressure to pay today." },
  ],
  professor_message: [
    { category: "spoofed_sender", explanation: "A personal address or new number claiming to be your professor." },
    { category: "payment_request", explanation: "Requests for gift cards or a 'quick favour' are never real faculty asks." },
  ],
  account_security_alert: [
    { category: "urgency", explanation: "Threats that your account will be locked within hours." },
    { category: "link", explanation: "A login link in the message instead of the site you navigate to yourself." },
  ],
};

export function buildTellsOnly(
  args: { findings: Finding[]; kind: PracticeKind; scenario: PracticeScenario },
  attempts: Attempt[],
): TellsOnly {
  const facts = factsForPrompt(args.findings).slice(0, 6);
  const byId = new Map(args.findings.map((f) => [f.id, f]));
  const exploitable = facts.map((f) => ({
    findingId: f.id,
    label: f.label,
    how: HOW[byId.get(f.id)?.category ?? "other"],
  }));
  const tells: TellsOnly["tells"] = [
    ...CLASSIC[args.scenario].map((t, i) => ({ id: `c${i + 1}`, ...t })),
    ...exploitable.slice(0, 4).map((e, i) => ({
      id: `p${i + 1}`,
      category: "personal_detail" as const,
      explanation: `It mentions your ${e.label.toLowerCase()}. ${e.how}`,
      findingId: e.findingId,
    })),
  ];
  const sc = SCENARIOS.find((s) => s.id === args.scenario)!;
  const anyDeclined = attempts.some((a) => a.outcome === "declined");
  return {
    mode: "tellsOnly",
    practice: true,
    label: PRACTICE_LABEL,
    kind: args.kind,
    scenario: args.scenario,
    reason: anyDeclined
      ? `The example ${sc.label.toLowerCase()} message couldn't be generated, so here are the tells it would contain.`
      : `No example message is available right now, so here are the tells a ${sc.label.toLowerCase()} scam would contain.`,
    exploitable,
    tells,
    whatToDo: [
      "Never use a link or number from the message: look up the official site or office yourself.",
      "No real school, landlord or employer asks for gift cards, payment-app deposits or codes by text.",
      ...exploitable.slice(0, 2).map((e) => `Lock down or remove your public ${e.label.toLowerCase()}.`),
    ],
  };
}
