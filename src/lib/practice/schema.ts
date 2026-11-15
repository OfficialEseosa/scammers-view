import { z } from "zod";
import { Finding } from "@/lib/types";

/** Client-safe contract for the Practice Attacks feature. */

export const PracticeKind = z.enum(["sms", "email"]);
export type PracticeKind = z.infer<typeof PracticeKind>;

export const PracticeScenario = z.enum([
  "campus_job_offer",
  "financial_aid_refund",
  "rental_deposit",
  "professor_message",
  "account_security_alert",
]);
export type PracticeScenario = z.infer<typeof PracticeScenario>;

export const SCENARIOS: { id: PracticeScenario; label: string; brief: string }[] = [
  {
    id: "campus_job_offer",
    label: "Campus job offer",
    brief:
      "A too-good-to-be-true remote/campus job (e.g. research or admin assistant) that leads to an upfront 'equipment' payment or a fake-check scheme.",
  },
  {
    id: "financial_aid_refund",
    label: "Financial-aid refund",
    brief:
      "A notice that a financial-aid or tuition refund is waiting and the recipient must 'verify' details or pay a processing fee to release it.",
  },
  {
    id: "rental_deposit",
    label: "Rental deposit",
    brief:
      "A landlord or sublet listing near the recipient that asks for a holding deposit before any viewing, sent through a payment app.",
  },
  {
    id: "professor_message",
    label: '"Your professor" message',
    brief:
      "A message impersonating a professor or advisor asking for a quick favour (gift cards, a personal number, or clicking a 'shared document').",
  },
  {
    id: "account_security_alert",
    label: "Account security alert",
    brief:
      "A fake security alert about the recipient's school or personal account that pushes them to 'confirm' a login or code via a link.",
  },
];

export const TellCategory = z.enum([
  "urgency",
  "spoofed_sender",
  "personal_detail",
  "link",
  "payment_request",
  "too_good",
  "other",
]);
export type TellCategory = z.infer<typeof TellCategory>;

export const Tell = z.object({
  id: z.string(),
  /** Exact substring of `body` (enforced server-side). */
  quote: z.string(),
  explanation: z.string(),
  /** The fact this tell exploited, if any. */
  findingId: z.string().optional(),
  category: TellCategory,
});
export type Tell = z.infer<typeof Tell>;

export const PRACTICE_LABEL = "PRACTICE";
export const PRACTICE_FOOTER =
  "PRACTICE MESSAGE - Scammer's View awareness training. Not a real message. Do not act on it.";

export const PracticeMessage = z.object({
  mode: z.literal("message"),
  practice: z.literal(true),
  label: z.literal(PRACTICE_LABEL),
  kind: PracticeKind,
  scenario: PracticeScenario,
  provider: z.literal("gemini"),
  /** The recipient's name as used in the message (the signed-in person). Lets the UI mask it. */
  addressedTo: z.string(),
  from: z.object({ name: z.string(), address: z.string() }),
  subject: z.string().optional(),
  body: z.string(),
  tells: z.array(Tell),
  whatToDo: z.array(z.string()),
  /** The published scam report the message was modelled on, when one fits the scenario. */
  basedOn: z.object({ title: z.string(), source: z.string(), year: z.number(), url: z.string() }).optional(),
});
export type PracticeMessage = z.infer<typeof PracticeMessage>;

export const TellsOnly = z.object({
  mode: z.literal("tellsOnly"),
  practice: z.literal(true),
  label: z.literal(PRACTICE_LABEL),
  kind: PracticeKind,
  scenario: PracticeScenario,
  reason: z.string(),
  exploitable: z.array(z.object({ findingId: z.string(), label: z.string(), how: z.string() })),
  tells: z.array(
    z.object({
      id: z.string(),
      category: TellCategory,
      explanation: z.string(),
      findingId: z.string().optional(),
    }),
  ),
  whatToDo: z.array(z.string()),
});
export type TellsOnly = z.infer<typeof TellsOnly>;

export const PracticeResponse = z.discriminatedUnion("mode", [PracticeMessage, TellsOnly]);
export type PracticeResponse = z.infer<typeof PracticeResponse>;

/** Request body. Deliberately has no recipient field: the recipient is always the signed-in person. */
export const PracticeRequest = z
  .object({
    findings: z.array(Finding).max(200),
    kind: PracticeKind,
    scenario: PracticeScenario,
  })
  .strict();
export type PracticeRequest = z.infer<typeof PracticeRequest>;
