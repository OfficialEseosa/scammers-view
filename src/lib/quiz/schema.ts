import { z } from "zod";
import { Finding } from "@/lib/types";

/** Client-safe contract for the Spot-the-Scam quiz. */

export const QuizKind = z.enum(["sms", "email"]);
export type QuizKind = z.infer<typeof QuizKind>;

export const QuizTellCategory = z.enum([
  "urgency",
  "spoofed_sender",
  "personal_detail",
  "link",
  "payment_request",
  "too_good",
  "other",
]);
export type QuizTellCategory = z.infer<typeof QuizTellCategory>;

/** A scam-side tell anchored to the body. */
export const QuizTell = z.object({
  id: z.string(),
  /** Exact substring of the message body (enforced in code). */
  quote: z.string().min(2),
  explanation: z.string(),
  category: QuizTellCategory,
  /** The public fact this tell exploited, if any. */
  findingId: z.string().optional(),
});
export type QuizTell = z.infer<typeof QuizTell>;

/** For legitimate messages: why a part of it is fine. */
export const GoodSign = z.object({
  id: z.string(),
  quote: z.string().min(2),
  explanation: z.string(),
});
export type GoodSign = z.infer<typeof GoodSign>;

export const QuizItem = z
  .object({
    id: z.string(),
    kind: QuizKind,
    isScam: z.boolean(),
    from: z.object({ name: z.string(), address: z.string() }),
    subject: z.string().optional(),
    body: z.string().min(10),
    /** Scam items: what gives it away. Empty for legitimate items. */
    tells: z.array(QuizTell),
    /** Legitimate items: why it is fine. Empty for scam items. */
    goodSigns: z.array(GoodSign),
    /** Findings this practice scam was built from. */
    findingIds: z.array(z.string()),
    /** One-sentence verdict shown after answering. */
    summary: z.string(),
  })
  .superRefine((item, ctx) => {
    for (const t of [...item.tells, ...item.goodSigns]) {
      if (!item.body.includes(t.quote)) {
        ctx.addIssue({ code: "custom", message: `quote not in body: ${t.id}` });
      }
    }
  });
export type QuizItem = z.infer<typeof QuizItem>;

export const QuizResponse = z.object({
  practice: z.literal(true),
  /** Who wrote the content. "fallback" = built-in fictional set. */
  source: z.enum(["claude", "fallback"]),
  /** The signed-in person's name, so the UI can mask it. */
  recipient: z.string(),
  items: z.array(QuizItem).length(6),
});
export type QuizResponse = z.infer<typeof QuizResponse>;

/** Request body. No recipient field: the recipient is always the signed-in person. */
export const QuizRequest = z.object({ findings: z.array(Finding).max(200) }).strict();
export type QuizRequest = z.infer<typeof QuizRequest>;

export type MissedCategory = QuizTellCategory | "false_alarm";

export type QuizAnswer = {
  itemId: string;
  said: "real" | "scam";
  correct: boolean;
  isScam: boolean;
};

export type QuizResult = {
  score: number;
  total: number;
  answers: QuizAnswer[];
  /** Categories behind the user's mistakes (scams they called real, plus "false_alarm"). */
  missedCategories: MissedCategory[];
};

export const CATEGORY_LABEL: Record<MissedCategory, string> = {
  urgency: "Urgency and pressure",
  spoofed_sender: "Sender who is not who they claim",
  personal_detail: "Your own details used as bait",
  link: "Suspicious link",
  payment_request: "Unusual payment request",
  too_good: "Too good to be true",
  other: "Other warning signs",
  false_alarm: "Calling a real message a scam",
};

export const CATEGORY_TIP: Record<MissedCategory, string> = {
  urgency:
    "Real organisations give you time. When a message sets a countdown, stop and contact them through a number or app you already trust.",
  spoofed_sender:
    "Display names are free to fake. Check the full address or number, and when in doubt open the official app yourself instead of replying.",
  personal_detail:
    "Knowing your school, pet or employer proves nothing: it is all public. Treat personal detail as bait, not as proof the sender is genuine.",
  link: "Do not tap links in unexpected messages. Type the site address yourself, and watch for a domain that does not match the sender.",
  payment_request:
    "Gift cards, deposits, fees to release money and unrecoverable payment apps are the classic scam payments. Verify by phone first.",
  too_good:
    "Easy money, surprise refunds and effortless jobs are lures. If it sounds too good, ask who benefits from you acting fast.",
  other: "When a message feels off, trust that. Slow down and check it through a channel you started yourself.",
  false_alarm:
    "Not every unexpected message is a scam. Real ones have no countdown, no payment ask and no link mismatch. Verify through an official channel, then relax.",
};
