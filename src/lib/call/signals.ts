/** What the user's replies show. Shared by the turn engine (to react) and the grader (to score). */

const VERIFY = /\b(who (is|are) (this|you)|how do i know|prove|verify|verification|what('?s| is) your (name|number|employee|badge|title|full name)|which (office|department|company|team)|send (me )?(it )?in writing|official (email|number|site|website)|look (you|it|that) up)\b/i;
const SECRET = /\b(safe ?word|code ?word|password we|family (word|code)|what('?s| is| was) (my|our|the) (dog|cat|pet|middle|nickname|safe)|only (you|the real)|tell me something only)\b/i;
const CALLBACK = /\b(call (you|them|her|him|my \w+|the (real|official|office|company|school)) back|i'?ll call (you|them|her|him|my|the|your)|hang up and call|call the number (i|on)|let me call)\b/i;
const REFUSE = /\b(no(pe)?\b|not (going to|gonna|doing|paying|sending|giving)|won'?t|will not|i'?m not|refuse|can'?t do that|absolutely not|this is a scam|scam|nice try)\b/i;
const COMPLY = /\b(ok(ay)?,? i'?ll (buy|send|pay|get|do)|sure,? i'?ll|here (is|are) (the|my)|my (social|ssn|social security|card number|account number|password|pin) is|i (bought|sent|paid)|i'?ll (buy|send|wire|pay))\b/i;
const HESITATE = /\b(um+|uh+|i don'?t know|not sure|wait|hold on|what\?|really\?|why)\b/i;

export interface Signals {
  verify: boolean;
  secret: boolean;
  callback: boolean;
  refuse: boolean;
  comply: boolean;
  hesitate: boolean;
  /** A number of 3+ digits was said (and redacted). */
  revealedNumber: boolean;
}

export const REDACTED = "[number]";

/** Replace runs of 3+ digits (SSNs, card numbers, codes) before anything is kept, even in memory. */
export function redact(text: string): string {
  return text.replace(/\d[\d\s-]{1,}\d/g, (m) => (m.replace(/\D/g, "").length >= 3 ? REDACTED : m));
}

export function readSignals(utterance: string): Signals {
  const t = utterance;
  return {
    verify: VERIFY.test(t),
    secret: SECRET.test(t),
    callback: CALLBACK.test(t),
    refuse: REFUSE.test(t) && !COMPLY.test(t),
    comply: COMPLY.test(t),
    hesitate: HESITATE.test(t),
    revealedNumber: t.includes(REDACTED),
  };
}
