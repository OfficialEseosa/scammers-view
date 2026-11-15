import { z } from "zod";
import { MODELS, generateJson, isLlmConfigured } from "@/lib/llm/gemini";
import { fetchPage, type PageData } from "@/lib/scan/pageFetch";
import { siteDraft } from "@/lib/fixes/optout";
import { findSiteContact, type SiteContact } from "./contact";

/*
 * A ready-made removal request for a site that shows the person's details.
 * Nothing is sent from here: the person copies it or opens it in their own
 * email app. The site's own privacy or terms page is read so the request can
 * point at what the site itself promises; when that page can't be read, or
 * says nothing useful, a plain template is used instead.
 */

export interface RemovalDraft {
  /** Best address to send to, or "" when none was found. */
  to: string;
  contacts: SiteContact[];
  subject: string;
  body: string;
  /** The part of the site's own policy the request relies on, in one sentence. "" when none. */
  basis: string;
  /** The policy page that was read, when one was. */
  policyUrl: string;
}

export interface DraftInput {
  name: string;
  email: string;
  site: string;
  listingUrl: string;
  fields: { label: string; value: string }[];
}

const POLICY_LINK = /privacy|terms|legal|removal|opt.?out|data.?protection|gdpr|ccpa|dmca/i;
const POLICY_CHARS = 14_000;

const Written = z.object({
  subject: z.string().max(200),
  body: z.string().max(4000),
  basis: z.string().max(300),
  address: z.string().max(120),
});

const SYSTEM = `You write a short removal request email for a person whose details appear on a web page. You are given the page address, the details, the person's name and email, and the text of the site's own privacy or terms page.

Rules:
- Write as the person, in plain polite English, under 180 words. Plain text only.
- Say which page, list the details to remove, and ask for confirmation by reply.
- If the policy text describes a way to ask for removal, correction or deletion, or a right the person has, refer to it by the name the site uses (for example its section heading). Do this only when the policy text clearly supports it.
- Never invent a clause, a law, a deadline or a section name. If the policy text gives nothing useful, write the request without citing it and return an empty "basis".
- "basis" is one sentence naming what in the site's policy the request relies on, or "".
- "address" is an email address that the policy text itself gives for privacy or removal requests, copied exactly, or "".
- End with the person's name and email on their own lines.`;

type Fetcher = (url: string, signal: AbortSignal) => Promise<PageData | null>;

/** The site's privacy or terms page: the best match among the listing page's own links. */
export function policyLink(links: { url: string; text: string }[], listingUrl: string): string {
  let host = "";
  try {
    host = new URL(listingUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
  const score = (l: { url: string; text: string }) => {
    const s = `${l.text} ${l.url}`;
    return (/privacy/i.test(s) ? 4 : 0) + (/removal|opt.?out|data.?protection/i.test(s) ? 3 : 0) + (/terms|legal/i.test(s) ? 1 : 0);
  };
  const same = links.filter((l) => {
    try {
      return new URL(l.url).hostname.replace(/^www\./, "").endsWith(host.split(".").slice(-2).join(".")) && POLICY_LINK.test(`${l.text} ${l.url}`);
    } catch {
      return false;
    }
  });
  return same.sort((a, b) => score(b) - score(a))[0]?.url ?? "";
}

export async function draftRemoval(input: DraftInput, signal: AbortSignal, fetcher: Fetcher = fetchPage): Promise<RemovalDraft> {
  const template = siteDraft(input);
  const [contacts, listing] = await Promise.all([
    findSiteContact(input.listingUrl, signal, fetcher).catch(() => [] as SiteContact[]),
    fetcher(input.listingUrl, signal).catch(() => null),
  ]);
  const base: RemovalDraft = { to: contacts[0]?.address ?? "", contacts, subject: template.subject, body: template.body, basis: "", policyUrl: "" };

  const policyUrl = listing ? policyLink([...(listing.contactLinks ?? []), ...listing.links], input.listingUrl) : "";
  if (!policyUrl || !isLlmConfigured()) return base;
  const policy = await fetcher(policyUrl, signal).catch(() => null);
  const policyText = (policy?.text ?? "").slice(0, POLICY_CHARS);
  if (policyText.length < 400) return base;

  try {
    const w = await generateJson({
      model: MODELS.fast,
      system: SYSTEM,
      prompt: [
        `Site: ${input.site}`,
        `Page with the details: ${input.listingUrl}`,
        `Person: ${input.name} <${input.email}>`,
        "Details to remove:",
        ...input.fields.map((f) => `- ${f.label}: ${f.value}`),
        "",
        `Text of the site's policy page (${policyUrl}):`,
        policyText,
      ].join("\n"),
      schema: Written,
      maxOutputTokens: 900,
      signal,
    });
    const body = w.body.trim();
    // Keep the model's text only when it is a usable request about this page.
    if (body.length < 80 || !body.includes(input.listingUrl)) return { ...base, policyUrl };
    // An address is trusted only when the policy page really prints it.
    const address = w.address.trim().toLowerCase();
    const printed = address && z.string().email().safeParse(address).success && policyText.toLowerCase().includes(address);
    return {
      ...base,
      to: printed ? address : base.to,
      subject: w.subject.trim() || template.subject,
      body,
      basis: w.basis.trim(),
      policyUrl,
    };
  } catch {
    return { ...base, policyUrl };
  }
}
