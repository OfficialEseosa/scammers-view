import type { Finding } from "@/lib/types";
import type { ModelDraft } from "./prompt";
import {
  PRACTICE_FOOTER,
  PRACTICE_LABEL,
  type PracticeKind,
  type PracticeMessage,
  type PracticeScenario,
  type Tell,
} from "./schema";

/**
 * Content safety rails applied to every generated message, whatever the provider:
 * links -> non-functional .example placeholders, phone numbers -> fictional 555-01xx,
 * payment handles -> neutralised, sender -> forced fictional. Applied identically to
 * the body and to every tell quote so quotes stay exact substrings.
 */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
// bare domains like bit.ly/abc or portal-login.com (not .example)
const BARE_DOMAIN_RE =
  /\b(?<![@\w.-])([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|edu|io|co|ly|me|info|biz|app|link|xyz|site|online|us|gov|page|ai))(\/[^\s<>"')\]]*)?/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
const CASHTAG_RE = /(^|[\s(])\$(?=[A-Za-z])[A-Za-z][A-Za-z0-9_-]{1,30}\b/g;
const WALLET_RE = /\b(?:0x[a-fA-F0-9]{20,}|bc1[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g;

function isExampleHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "example" || h.endsWith(".example") || h.endsWith("example.com") || h.endsWith("example.org");
}

function placeholderHostFor(host: string): string {
  const base = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 24);
  return `${base || "portal"}-verify.example`;
}

function fixUrl(raw: string): string {
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    if (isExampleHost(u.hostname)) return raw;
    return `https://${placeholderHostFor(u.hostname)}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return "https://link-placeholder.example";
  }
}

export function makeSanitizer(allowedValues: string[]) {
  const allowed = new Set(allowedValues.map((v) => v.trim().toLowerCase()).filter(Boolean));
  return (text: string): string => {
    let out = text.replace(URL_RE, (m) => fixUrl(m));
    out = out.replace(EMAIL_RE, (m, host: string) => {
      if (isExampleHost(host) || allowed.has(m.toLowerCase())) return m;
      return `${m.split("@")[0]}@${placeholderHostFor(host)}`;
    });
    out = out.replace(BARE_DOMAIN_RE, (m, host: string, path?: string) => {
      if (isExampleHost(host)) return m;
      return `${placeholderHostFor(host)}${path ?? ""}`;
    });
    out = out.replace(PHONE_RE, (m, _a: string, b: string, c: string) => {
      if (b === "555" && c.startsWith("01")) return m;
      return `(555) 010-0${c.slice(-3)}`.slice(0, 14);
    });
    out = out.replace(CASHTAG_RE, (_m, pre: string) => `${pre}[payment handle]`);
    out = out.replace(WALLET_RE, "[wallet address]");
    return out;
  };
}

function fictionalSender(kind: PracticeKind, name: string, address: string, sanitize: (s: string) => string) {
  const cleanName = sanitize(name).slice(0, 60) || "Student Services";
  if (kind === "email") {
    const a = sanitize(address.trim());
    const m = a.match(/^[^@\s]+@([^@\s]+)$/);
    if (m && isExampleHost(m[1])) return { name: cleanName, address: a };
    const local = (a.split("@")[0] || "notices").replace(/[^a-z0-9._-]/gi, "").slice(0, 30) || "notices";
    return { name: cleanName, address: `${local}@student-notices.example` };
  }
  const digits = address.replace(/\D/g, "");
  const fake = /^1?55501\d{2}$/.test(digits.slice(-7)) || digits.slice(-7, -4) === "555";
  return { name: cleanName, address: fake ? address : `(555) 010-0${(digits.slice(-3) || "147").padStart(3, "0")}` };
}

function normalizeWs(s: string) {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-");
}

/**
 * Returns the exact substring of body that the quote refers to, or null.
 * Tries exact, case-insensitive, then punctuation/whitespace-normalised matching.
 */
export function locateQuote(body: string, quote: string): string | null {
  const q = quote.trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  if (q.length < 2) return null;
  if (body.includes(q)) return q;
  const lower = body.toLowerCase();
  const i = lower.indexOf(q.toLowerCase());
  if (i >= 0) return body.slice(i, i + q.length);
  // normalised match: build regex that tolerates whitespace/quote/dash variations
  const nq = normalizeWs(q);
  const pattern = nq
    .split(/\s+/)
    .map((w) =>
      w
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/'/g, "['‘’]")
        .replace(/"/g, '["“”]')
        .replace(/-/g, "[-–—]"),
    )
    .join("\\s+");
  try {
    const m = body.match(new RegExp(pattern, "i"));
    if (m) return m[0];
  } catch {
    /* ignore */
  }
  return null;
}

export function finalizeDraft(args: {
  draft: ModelDraft;
  kind: PracticeKind;
  scenario: PracticeScenario;
  provider: "claude" | "gemini";
  findings: Finding[];
  addressedTo: string;
  subjectEmail: string;
}): PracticeMessage | null {
  const { draft, kind, findings } = args;
  const sanitize = makeSanitizer([args.subjectEmail, ...findings.map((f) => f.value)]);
  const body = sanitize(draft.body).trim();
  if (body.length < 20) return null;

  const ids = new Set(findings.map((f) => f.id));
  const tells: Tell[] = [];
  const usedQuotes = new Set<string>();
  draft.tells.forEach((t) => {
    const located = locateQuote(body, sanitize(t.quote));
    if (!located || usedQuotes.has(located)) return; // drop tells that don't match the body
    usedQuotes.add(located);
    tells.push({
      id: `t${tells.length + 1}`,
      quote: located,
      explanation: sanitize(t.explanation).slice(0, 400),
      findingId: t.finding_id && ids.has(t.finding_id) ? t.finding_id : undefined,
      category: t.category,
    });
  });
  // invariant enforced in code, not trusted from the model
  const verified = tells.filter((t) => body.includes(t.quote));
  if (verified.length < 2) return null;

  const from = fictionalSender(kind, draft.from_name, draft.from_address, sanitize);
  const rawSubject = kind === "email" ? sanitize(draft.subject ?? "").trim() : "";
  return {
    mode: "message",
    practice: true,
    label: PRACTICE_LABEL,
    kind,
    scenario: args.scenario,
    provider: args.provider,
    addressedTo: args.addressedTo,
    from,
    subject: kind === "email" ? `[${PRACTICE_LABEL}] ${rawSubject || "Action required"}` : undefined,
    body: `${body}\n\n${PRACTICE_FOOTER}`,
    tells: verified,
    // Advice never carries links: point to the official site instead of a placeholder domain.
    whatToDo: draft.what_to_do
      .map((s) =>
        s
          .replace(URL_RE, "the official website")
          .replace(EMAIL_RE, "the official contact address")
          .replace(BARE_DOMAIN_RE, "the official website"),
      )
      .map((s) => sanitize(s).slice(0, 300))
      .filter(Boolean)
      .slice(0, 6),
  };
}
