import type { Finding, ScanSubject } from "@/lib/types";
import { buildUserPrompt, factsForPrompt, recipientFirstName } from "./prompt";
import { PROVIDERS, type PracticeProvider } from "./providers";
import { finalizeDraft } from "./sanitize";
import {
  PRACTICE_LABEL,
  SCENARIOS,
  type PracticeKind,
  type PracticeResponse,
  type PracticeScenario,
  type TellsOnly,
} from "./schema";

export type Attempt = { provider: string; outcome: string; detail?: string };

/**
 * Generates a practice message addressed to the signed-in subject.
 * Tries each available provider in order; a refusal or invalid output falls through
 * to the next. If none produce a usable message, returns a tells-only lesson.
 */
export async function generatePractice(args: {
  subject: ScanSubject;
  findings: Finding[];
  kind: PracticeKind;
  scenario: PracticeScenario;
  providers?: PracticeProvider[];
}): Promise<{ result: PracticeResponse; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  const userPrompt = buildUserPrompt(args);
  const addressedTo = recipientFirstName(args.subject);

  for (const p of args.providers ?? PROVIDERS) {
    if (!p.available()) {
      attempts.push({ provider: p.name, outcome: "unavailable" });
      continue;
    }
    // one retry per provider for invalid output (not for refusals)
    for (let i = 0; i < 2; i++) {
      const r = await p.generate(userPrompt);
      if (!r.ok) {
        attempts.push({ provider: p.name, outcome: r.reason, detail: r.detail });
        if (r.reason !== "invalid") break;
        continue;
      }
      const msg = finalizeDraft({
        draft: r.draft,
        kind: args.kind,
        scenario: args.scenario,
        provider: p.name,
        findings: args.findings,
        addressedTo,
        subjectEmail: args.subject.email,
      });
      if (msg) {
        attempts.push({ provider: p.name, outcome: "ok", detail: `${msg.tells.length}/${r.draft.tells.length} tells kept` });
        return { result: msg, attempts };
      }
      attempts.push({ provider: p.name, outcome: "invalid", detail: "too few tells matched the body" });
    }
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
