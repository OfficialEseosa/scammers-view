import type { PatternId } from "../campus/patterns";

/** Warning signs that can be pointed at in a pasted message, each tied to the scams it suggests. */
export interface Cue {
  id: string;
  why: string;
  re: RegExp;
  patterns: PatternId[];
}

export const CUES: Cue[] = [
  {
    id: "urgency",
    why: "Pressure to act right now",
    re: /\b(urgent(ly)?|immediately|right (now|away)|asap|as soon as possible|within (the |an |24 |48 )?(hour|hours|minutes)|today only|act now|final (notice|warning)|before it'?s too late|expires? (today|soon|tonight))\b/gi,
    patterns: ["aid-refund-phish", "login-suspension", "family-voice-clone", "immigration-threat", "professor-gift-cards", "rental-deposit"],
  },
  {
    id: "gift-cards",
    why: "Gift cards are never a real way to pay",
    re: /\b(gift ?cards?|itunes cards?|apple cards?|google play cards?|steam cards?|card numbers?|scratch (off )?the back)\b/gi,
    patterns: ["professor-gift-cards", "immigration-threat", "fake-job-check"],
  },
  {
    id: "payment",
    why: "Hard-to-reverse payment",
    re: /\b(wire (transfer|the money)?|western union|moneygram|zelle|cash ?app|venmo|crypto(currency)?|bitcoin|usdt|bitcoin atm)\b/gi,
    patterns: ["rental-deposit", "roommate-ticket", "family-voice-clone", "immigration-threat", "marketplace-overpayment"],
  },
  {
    id: "check",
    why: "A check you're told to deposit and send part back",
    re: /\b(deposit (the |this )?(check|cheque)|send (back|the (rest|difference|extra))|overpa(id|yment)|mobile deposit|refund the difference)\b/gi,
    patterns: ["fake-job-check", "marketplace-overpayment", "fake-recruiter"],
  },
  {
    id: "code",
    why: "Nobody legitimate asks for your verification code",
    re: /\b(verification code|one[- ]time (code|passcode|password)|otp|2fa code|security code|the code (we|i) (just )?sent|pin number)\b/gi,
    patterns: ["login-suspension", "aid-refund-phish", "immigration-threat"],
  },
  {
    id: "credentials",
    why: "Asks for sensitive personal data",
    re: /\b(social security( number)?|ssn|fsa id|bank (login|details|account( number)?)|routing number|password|date of birth|passport (number|copy))\b/gi,
    patterns: ["fake-recruiter", "aid-refund-phish", "loan-forgiveness", "fake-scholarship-fee", "immigration-threat"],
  },
  {
    id: "link",
    why: "A link to log in or pay, instead of the real site",
    re: /(https?:\/\/\S+|\bbit\.ly\/\S+|\btinyurl\.com\/\S+|\bclick (here|the link|below)|\b(log ?in|sign ?in|verify) (here|now|at))/gi,
    patterns: ["aid-refund-phish", "login-suspension", "fake-scholarship-fee"],
  },
  {
    id: "secrecy",
    why: "Asked to keep it secret",
    re: /\b(keep (it|this) (quiet|between us|a secret|confidential)|don'?t tell (anyone|mom|dad|your)|it'?s a surprise)\b/gi,
    patterns: ["professor-gift-cards", "family-voice-clone"],
  },
  {
    id: "threat",
    why: "A threat if you don't comply",
    re: /\b(suspend(ed)?|deactivat(ed|ion)|locked|drop(ped)? (from )?your classes|deport(ed|ation)?|arrest(ed)?|warrant|legal action|prosecut(ed|ion))\b/gi,
    patterns: ["login-suspension", "aid-refund-phish", "immigration-threat"],
  },
  {
    id: "fee",
    why: "A fee to receive money or help",
    re: /\b(processing fee|release (the |your )?(funds|award)|application fee|upfront fee|small fee|guarantee(d)? (approval|award)|you('ve| have) (won|been selected))\b/gi,
    patterns: ["fake-scholarship-fee", "loan-forgiveness", "fake-job-check"],
  },
  {
    id: "too-good",
    why: "Too good to be true",
    re: /\b(easy money|flexible hours|work from home|no experience (needed|required)|\$\d+ ?(\/|per) ?(hour|hr|week)|below market|cheap rent)\b/gi,
    patterns: ["fake-job-check", "fake-recruiter", "rental-deposit"],
  },
  {
    id: "new-number",
    why: "A familiar name from an unfamiliar number or address",
    re: /\b(new (number|phone|email)|my phone (died|broke)|someone else'?s phone|personal email|can'?t talk (right now|long)|in a meeting)\b/gi,
    patterns: ["family-voice-clone", "professor-gift-cards", "fake-recruiter"],
  },
];

export interface Span {
  start: number;
  end: number;
  cueId: string;
  why: string;
}

/** Non-overlapping cue spans in reading order. */
export function findSpans(text: string, max = 24): Span[] {
  const all: Span[] = [];
  for (const c of CUES) {
    for (const m of text.matchAll(c.re)) {
      if (m.index === undefined || !m[0].trim()) continue;
      all.push({ start: m.index, end: m.index + m[0].length, cueId: c.id, why: c.why });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of all) {
    if (out.length && s.start < out[out.length - 1].end) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
