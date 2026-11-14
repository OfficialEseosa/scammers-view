import type { Finding } from "@/lib/types";
import type { QuizItem, QuizTellCategory } from "./schema";

/**
 * Deterministic fictional quiz set. Used when the model fails or declines so the quiz always works.
 * Scam items weave in the user's own findings when usable; everything else is obviously fictional.
 */

const SAFE_VALUE = /^[^\n<>@/\\]{2,40}$/;

function usable(findings: Finding[]): Finding[] {
  return [...findings]
    .filter((f) => SAFE_VALUE.test(f.value.trim()) && !/\d{6,}/.test(f.value))
    .sort((a, b) => b.riskWeight - a.riskWeight);
}

function phrase(f: Finding): string {
  const v = f.value.trim();
  switch (f.category) {
    case "school":
      return `your ${v} student account`;
    case "employer":
      return `your ${v} work account`;
    case "location":
      return `your place near ${v}`;
    case "pet":
      return `the vet bill for ${v}`;
    case "relative":
      return `your family link to ${v}`;
    case "birthday":
      return `your birthday on ${v}`;
    case "handle":
      return `the ${v} account`;
    case "interest":
      return `your ${v} group`;
    default:
      return `your ${f.label.toLowerCase()} (${v})`;
  }
}

/** The part of `phrase` that is the finding's actual value (used as the tell quote). */
function factQuote(f: Finding): string {
  return f.value.trim();
}

function firstName(recipient: string): string {
  return recipient.trim().split(/\s+/)[0] || "there";
}

type Draft = Omit<QuizItem, "id">;

export function fallbackItems(findings: Finding[], recipient: string): Draft[] {
  const facts = usable(findings);
  const name = firstName(recipient);
  const [f1, f2, f3] = [facts[0], facts[1] ?? facts[0], facts[2] ?? facts[1] ?? facts[0]];

  const tell = (
    n: number,
    quote: string,
    category: QuizTellCategory,
    explanation: string,
    f?: Finding,
  ) => ({ id: `t${n}`, quote, category, explanation, findingId: f?.id });

  // Scam 1: account alert (SMS)
  const p1 = f1 ? phrase(f1) : "your student account";
  const s1Body = `Hi ${name}, we found a sign-in problem on ${p1}. Confirm within 30 minutes or access will be suspended: https://campus-check.example/verify`;
  const scam1: Draft = {
    kind: "sms",
    isScam: true,
    from: { name: "Account Security", address: "555-0199" },
    body: s1Body,
    tells: [
      ...(f1
        ? [tell(1, factQuote(f1), "personal_detail", `Public detail (${f1.label.toLowerCase()}) used to look like it knows you. Anyone can find it.`, f1)]
        : []),
      tell(2, "within 30 minutes", "urgency", "A countdown is designed to stop you thinking or checking."),
      tell(3, "https://campus-check.example/verify", "link", "A link from an unexpected alert. Real alerts let you open the official app or site yourself."),
    ],
    goodSigns: [],
    findingIds: f1 ? [f1.id] : [],
    summary: "An alert with a countdown and a link, dressed up with a detail anyone can find about you.",
  };

  // Scam 2: job offer with payment (email)
  const p2 = f2 ? phrase(f2) : "your profile";
  const s2Body = `Hi ${name},\n\nI came across ${p2} and think you would be perfect for a flexible remote assistant role: $450 per week, no experience needed. To start, we mail you a check for equipment. Deposit it and send $200 back by gift card codes to our vendor.\n\nReply today, spots are limited.`;
  const scam2: Draft = {
    kind: "email",
    isScam: true,
    from: { name: "Jordan Lee, Talent Team", address: "hiring@remote-roles-hub.example" },
    subject: "Paid remote role, you were recommended",
    body: s2Body,
    tells: [
      ...(f2 ? [tell(1, factQuote(f2), "personal_detail", `A public fact (${f2.label.toLowerCase()}) used to make a cold message feel personal.`, f2)] : []),
      tell(2, "$450 per week, no experience needed", "too_good", "High pay for no skills is the lure."),
      tell(3, "send $200 back by gift card codes", "payment_request", "Overpaid-check and gift card schemes: the check bounces later and the money you sent is gone."),
    ],
    goodSigns: [],
    findingIds: f2 ? [f2.id] : [],
    summary: "A too-good job that asks you to send money back. The check will bounce; your money will not come back.",
  };

  // Scam 3: friend/family emergency (SMS)
  const p3 = f3 ? phrase(f3) : "our group";
  const s3Body = `hey ${name} it's me, new number. phone broke. can you grab two gift cards for ${p3}? I'll pay you back tonight. don't tell anyone yet, it's embarrassing`;
  const scam3: Draft = {
    kind: "sms",
    isScam: true,
    from: { name: "Unknown number", address: "555-0199" },
    body: s3Body,
    tells: [
      tell(1, "new number", "spoofed_sender", "Someone claiming to be a friend from an unfamiliar number. Call the person on the old number to check."),
      tell(2, "grab two gift cards", "payment_request", "Gift cards cannot be traced or reversed, which is why scammers ask for them."),
      tell(3, "don't tell anyone yet", "urgency", "Secrecy keeps you from the check that would expose it."),
      ...(f3 ? [tell(4, factQuote(f3), "personal_detail", `Borrowed context (${f3.label.toLowerCase()}) from your public profile to sound familiar.`, f3)] : []),
    ],
    goodSigns: [],
    findingIds: f3 ? [f3.id] : [],
    summary: "A 'friend' on a new number asking for gift cards and secrecy. Call the old number first.",
  };

  const legit1: Draft = {
    kind: "email",
    isScam: false,
    from: { name: "Northgate Registrar", address: "records@northgate-college.example" },
    subject: "Spring registration opens next Monday",
    body: `Hi ${name},\n\nA reminder that spring course registration opens Monday at 9:00 AM. You can browse the catalog and plan your schedule any time in the student portal you already use. There is nothing to pay and no action needed today.\n\nRegistrar's Office, Northgate College`,
    tells: [],
    goodSigns: [
      { id: "g1", quote: "opens Monday at 9:00 AM", explanation: "A plain date with no pressure to act right now." },
      { id: "g2", quote: "the student portal you already use", explanation: "Points to a site you already know, not a link to click." },
      { id: "g3", quote: "nothing to pay and no action needed today", explanation: "No payment request and no deadline." },
    ],
    findingIds: [],
    summary: "Fine: routine reminder, no link, no payment, no pressure.",
  };

  const legit2: Draft = {
    kind: "sms",
    isScam: false,
    from: { name: "Riverside Dental", address: "555-0150" },
    body: "Riverside Dental: reminder of your cleaning on Tue 3:00 PM. If you need to change it, call the office number on your appointment card. Reply C to confirm.",
    tells: [],
    goodSigns: [
      { id: "g1", quote: "call the office number on your appointment card", explanation: "Sends you to contact details you already hold." },
      { id: "g2", quote: "Reply C to confirm", explanation: "A simple confirmation with no link and no payment." },
    ],
    findingIds: [],
    summary: "Fine: appointment reminder with no link and no money involved.",
  };

  const legit3: Draft = {
    kind: "email",
    isScam: false,
    from: { name: "Maple Street Library", address: "holds@maplestreet-library.example" },
    subject: "Your hold is ready for pickup",
    body: `Hello ${name},\n\nThe book you reserved is ready at the front desk and will be held until Friday. Bring your library card. Late fees never apply to holds.\n\nMaple Street Library`,
    tells: [],
    goodSigns: [
      { id: "g1", quote: "held until Friday", explanation: "A normal holding window, not a threat." },
      { id: "g2", quote: "Bring your library card", explanation: "Asks only for something you already have, in person." },
      { id: "g3", quote: "Late fees never apply to holds", explanation: "No money is requested." },
    ],
    findingIds: [],
    summary: "Fine: pickup notice with no link, no login and no payment.",
  };

  return [scam1, scam2, scam3, legit1, legit2, legit3];
}
