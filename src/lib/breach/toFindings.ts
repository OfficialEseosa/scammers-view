import type { Finding } from "@/lib/types";
import { PROVIDER_NAME, type BreachInfo, type BreachResult } from "./types";

export type ClassKind = "hint" | "password" | "security" | "phone" | "address" | "dob" | "id" | "financial" | "identity" | "network";

interface ClassRule {
  re: RegExp;
  kind: ClassKind;
  /** Singular noun for labels. */
  noun: string;
  weight: number;
}

/** Order matters: first match wins ("Password hints" before "Passwords"). */
const RULES: ClassRule[] = [
  { re: /security questions?/i, kind: "security", noun: "Security answers", weight: 9 },
  { re: /password hints?/i, kind: "hint", noun: "Password hint", weight: 7 },
  { re: /passwords?|credentials/i, kind: "password", noun: "Password", weight: 8 },
  { re: /government|passport|social security|national ids?|driver/i, kind: "id", noun: "ID number", weight: 9 },
  { re: /bank account|credit card|payment|financial/i, kind: "financial", noun: "Payment detail", weight: 8 },
  { re: /phone/i, kind: "phone", noun: "Phone number", weight: 7 },
  { re: /ip address/i, kind: "network", noun: "IP address", weight: 3 },
  { re: /physical address|home address|addresses?$/i, kind: "address", noun: "Address", weight: 7 },
  { re: /dates? of birth|birth/i, kind: "dob", noun: "Date of birth", weight: 7 },
  { re: /^(names?|usernames?|genders?|geographic|employers?|job titles?)/i, kind: "identity", noun: "Profile detail", weight: 2 },
];

export function classRule(dataClass: string): ClassRule | null {
  if (/^email addresses?$/i.test(dataClass)) return null;
  return RULES.find((r) => r.re.test(dataClass)) ?? null;
}

const MIN_WEIGHT = 3;

function year(b: BreachInfo): string {
  return b.date.slice(0, 4);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sourceUrl(b: BreachInfo, result: BreachResult): string {
  return result.provider === "hibp"
    ? `https://haveibeenpwned.com/PwnedWebsites#${encodeURIComponent(b.name.replace(/\s+/g, ""))}`
    : "https://xposedornot.com/xposed";
}

/**
 * One finding per breach per sensitive kind of data. Email-only exposure and trivia are skipped.
 * Values are the TYPE of data, never the data.
 */
export function breachesToFindings(result: BreachResult): Finding[] {
  const out: Finding[] = [];
  for (const b of result.breaches) {
    const seen = new Set<ClassKind>();
    const ranked = b.dataClasses
      .map((dc) => ({ dc, rule: classRule(dc) }))
      .sort((a, c) => (c.rule?.weight ?? 0) - (a.rule?.weight ?? 0));
    for (const { dc, rule } of ranked) {
      if (!rule || rule.weight < MIN_WEIGHT || seen.has(rule.kind)) continue;
      seen.add(rule.kind);
      out.push({
        id: `breach:${slug(b.name)}:${rule.kind}`,
        category: "other",
        label: `${rule.noun} exposed in ${b.name} (${year(b)})`,
        value: dc,
        sourceType: "other",
        sourceUrl: sourceUrl(b, result),
        sourceTitle: `${PROVIDER_NAME[result.provider].name}: ${b.name}`,
        anchor: "email",
        confidence: b.verified === false ? 0.7 : 0.95,
        riskWeight: rule.weight,
        foundAt: result.checkedAt,
      });
    }
  }
  return out.sort((a, b) => b.riskWeight - a.riskWeight || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ fixes */

export interface BreachFix {
  id: string;
  kind: "password" | "2fa" | "password-manager" | "security-answers" | "awareness";
  title: string;
  why: string;
  steps: string[];
  link?: string;
  /** True only when the URL was opened and checked against the service's own help page. */
  linkConfirmed?: boolean;
  effort: "1 min" | "5 min" | "15 min";
  /** Finding ids this fix addresses. */
  removesFindingIds: string[];
  breaches: string[];
}

/** Service 2FA help pages that were opened and checked. Keyed by registrable domain. */
const TWO_FA: Record<string, string> = {
  "dropbox.com": "https://help.dropbox.com/security/enable-two-step-verification",
  "google.com": "https://support.google.com/accounts/answer/185839",
  "apple.com": "https://support.apple.com/en-us/102660",
  "facebook.com": "https://www.facebook.com/help/148233965247823",
};

function twoFaLink(domain?: string): string | undefined {
  if (!domain) return undefined;
  const d = domain.toLowerCase().replace(/^www\./, "");
  return TWO_FA[d] ?? TWO_FA[d.split(".").slice(-2).join(".")];
}

export function breachFixes(result: BreachResult): BreachFix[] {
  const findings = breachesToFindings(result);
  const fixes: BreachFix[] = [];
  const idsFor = (name: string, kinds: ClassKind[]) =>
    findings.filter((f) => f.id.startsWith(`breach:${slug(name)}:`) && kinds.some((k) => f.id.endsWith(`:${k}`))).map((f) => f.id);

  const withPw = result.breaches.filter((b) => idsFor(b.name, ["password"]).length > 0);
  for (const b of withPw) {
    const link = twoFaLink(b.domain);
    fixes.push({
      id: `fix:${slug(b.name)}:password`,
      kind: "password",
      title: `Change your ${b.name} password`,
      why: `Passwords leaked in ${b.name} (${year(b)}). Anywhere you reused it is open.`,
      steps: [
        `Set a new, unique password on ${b.name}.`,
        "Change it on every other site where you used the old one.",
        link ? `Turn on app-based 2FA for ${b.name}.` : `Turn on app-based 2FA for ${b.name} if it offers it.`,
      ],
      link,
      linkConfirmed: link ? true : undefined,
      effort: "5 min",
      removesFindingIds: idsFor(b.name, ["password"]),
      breaches: [b.name],
    });
  }

  if (withPw.length > 0) {
    fixes.push({
      id: "fix:2fa:app",
      kind: "2fa",
      title: "Use an authenticator app, not texts",
      why: "A leaked password alone should not open an account.",
      steps: ["Install an authenticator app.", "Turn on 2FA for email, banking and social accounts first.", "Save the recovery codes offline."],
      effort: "15 min",
      removesFindingIds: withPw.flatMap((b) => idsFor(b.name, ["password"])),
      breaches: withPw.map((b) => b.name),
    });
    fixes.push({
      id: "fix:password-manager",
      kind: "password-manager",
      title: "Set up a password manager",
      why: "One unique password per site means one leak opens one door.",
      steps: ["Pick a password manager.", "Let it generate a password for each account, starting with the leaked ones.", "Protect it with a long passphrase and 2FA."],
      effort: "15 min",
      removesFindingIds: withPw.flatMap((b) => idsFor(b.name, ["password"])),
      breaches: withPw.map((b) => b.name),
    });
  }

  const withHint = result.breaches.filter((b) => idsFor(b.name, ["hint"]).length > 0 && !withPw.includes(b));
  for (const b of withHint) {
    fixes.push({
      id: `fix:${slug(b.name)}:hint`,
      kind: "password",
      title: `Remove the password hint on ${b.name}`,
      why: "Hints give scammers a head start on your password.",
      steps: [`Change the password on ${b.name}.`, "Clear the hint, or make it meaningless."],
      effort: "5 min",
      removesFindingIds: idsFor(b.name, ["hint"]),
      breaches: [b.name],
    });
  }

  const withSecurity = result.breaches.filter((b) => idsFor(b.name, ["security"]).length > 0);
  if (withSecurity.length > 0) {
    fixes.push({
      id: "fix:security-answers",
      kind: "security-answers",
      title: "Replace your security answers",
      why: "Leaked answers let someone reset your accounts by phone or chat.",
      steps: [
        "Change them everywhere you used the same answers.",
        "Use random answers kept in your password manager, not true facts.",
      ],
      effort: "15 min",
      removesFindingIds: withSecurity.flatMap((b) => idsFor(b.name, ["security"])),
      breaches: withSecurity.map((b) => b.name),
    });
  }

  const withContact = result.breaches.filter((b) => idsFor(b.name, ["phone", "address", "dob"]).length > 0);
  if (withContact.length > 0) {
    fixes.push({
      id: "fix:contact-exposed",
      kind: "awareness",
      title: "Expect calls and texts that know you",
      why: "Leaked phone, address or birthday make a scam call sound real.",
      steps: [
        "Hang up and call back on a number you look up yourself.",
        "Never read out codes sent to your phone.",
        "Ask your carrier for a port-out PIN.",
      ],
      effort: "5 min",
      removesFindingIds: withContact.flatMap((b) => idsFor(b.name, ["phone", "address", "dob"])),
      breaches: withContact.map((b) => b.name),
    });
  }
  return fixes;
}
