import { z } from "zod";
import { generateJson, groundedJson, type LlmUsage } from "@/lib/llm/gemini";
import { FindingCategory, SourceType, type ScanSubject } from "@/lib/types";
import { normalizeUrl, type FindingCollector } from "./findings";
import { Limiter } from "./limit";
import { fetchPage, urlAllowed, type PageData } from "./pageFetch";
import { CATEGORY_GUIDE, subjectBlock } from "./prompts";

/**
 * Reads public pages in full (our own guarded fetcher, so we also see image
 * URLs and links), and has Gemini extract facts + photo candidates from the
 * page body with structured output. When our fetcher cannot get a page (bot
 * walls, odd encodings), Gemini's URL context tool reads it instead (text
 * facts only: no image/link lists, so no photos or follow-links from those).
 * Findings stream out as each page finishes.
 */

const Extraction = z.object({
  aboutSubject: z.boolean(),
  isSubjectsOwnPage: z.boolean(),
  findings: z.array(
    z.object({
      // "video" findings come only from the social module (they need a media URL).
      category: FindingCategory.exclude(["video", "connection"]),
      label: z.string(),
      value: z.string(),
      sourceType: SourceType,
      snippet: z.string(),
      imageUrl: z.string(),
      anchor: z.enum(["email", "github", "school", "unconfirmed"]),
      confidence: z.number(),
      riskWeight: z.number(),
    }),
  ),
  followLinks: z.array(z.string()),
});

const SYSTEM = `You read one public web page for "Scammer's View", a privacy self-audit the signed-in user ran on THEMSELF. Extract the facts on this page about the subject that a scammer could use.

Rules:
- Only facts about the subject. If the page is about a different person with the same name, set aboutSubject=false and return no findings.
- anchor: "email" if the page shows one of the subject's known emails; "github" if it shows or links their GitHub login or a handle already confirmed for them; "school" if it ties this exact name to their school; otherwise "unconfirmed". confidence 0..1 that the fact is about the subject. Be strict.
- value is the specific fact ("Biscuit", "Lincoln High School", "@janedoe"), label is short ("Dog's name").
- Relatives (parents, siblings, partner): record each once as category "relative"; nothing further about them.
- riskWeight 0..10: 9-10 security-answer material (pets, birthday, hometown, first/high school, phone, mother's maiden name); 7-8 personal emails, exact location, relatives, schedules; 5-6 employer, school, handles linking accounts; 2-4 interests, bio.
- Photos (important): photo candidates are checked later by a face match in the user's browser, so collect them generously. From the IMAGES list only, emit a "photo" finding for every image that could show the subject: the avatar/profile/preview image of a page that is the subject's own profile or site (Devpost, portfolio, about page, social profile preview), team/event/award/hackathon/club photos on a page that names them, news photos in an article about them. imageUrl copied exactly from the list; value describes it ("Team photo, HackX 2025 winners"); anchor = why the page is tied to them; confidence 0.35-0.95 that they appear in it. Skip only logos, UI screenshots, diagrams, stock art and portraits captioned with someone else's name. Use "" for imageUrl on non-photo findings.
- followLinks: up to 3 URLs copied exactly from the LINKS list that are very likely the subject's own other profiles or pages (their portfolio, Linktree, Devpost, personal blog, team page naming them). Never login/signup pages. [] if none.
- snippet: a short quote (under 200 chars) from the page showing the fact.
- isSubjectsOwnPage: true only if this page is the subject's own profile, site, portfolio or account.

Quality bar (fewer, sharper facts beat padding):
- Hunt for what scammers use: email addresses and their pattern, phone numbers, birthday or age hints, hometown, high school, pets' names, relatives' names, schedule/routine (classes, practice times, shifts, commute, gym), employer + role + manager/teammate names, payment-app handles (Venmo/Cash App).
- Interests only when specific enough to build a pretext around (a named team, club, game, band, event, project) — never generic skills like "web development" or "Python". At most 3 interests per page.
- One finding per handle per platform. Don't restate the same fact with different wording.

${CATEGORY_GUIDE}`;

export interface PageLead {
  url: string;
  why: string;
  depth: number;
}

export class PageReader {
  private seen = new Set<string>();
  private pending: Promise<void>[] = [];
  private started = 0;
  count = 0;
  pagesRead = 0;
  pagesFailed = 0;
  /** Pages read by Gemini's URL context tool after our fetcher failed. */
  urlContextReads = 0;
  usage = { input: 0, output: 0, thought: 0 };

  constructor(
    private subject: ScanSubject,
    private collector: FindingCollector,
    private opts: {
      model: string;
      onUsage?: (u: LlmUsage) => void;
      signal: AbortSignal;
      limiter: Limiter;
      maxPages: number;
      deadline: number;
      knownAnchors: () => string;
    },
  ) {}

  /** Queue a page; ignored if seen, disallowed, over budget or past the deadline. */
  enqueue(lead: PageLead): boolean {
    const check = urlAllowed(lead.url);
    if (!check.ok) return false;
    const key = normalizeUrl(lead.url);
    if (this.seen.has(key)) return false;
    if (this.started >= this.opts.maxPages || Date.now() > this.opts.deadline) return false;
    this.seen.add(key);
    this.started++;
    this.pending.push(this.read(lead));
    return true;
  }

  /** Extract from text we already have (e.g. GitHub README + repo list). */
  readDocument(doc: PageData, agentId: string): Promise<number> {
    const p = this.opts.limiter.run(() => this.extract(doc, 0, agentId));
    this.pending.push(p.then(() => undefined, () => undefined));
    return p.catch(() => 0);
  }

  /** Resolves when every queued page (including ones queued while waiting) is done. */
  async drain(): Promise<void> {
    while (this.pending.length) {
      const batch = this.pending.splice(0);
      await Promise.allSettled(batch);
    }
  }

  private async sitemapLeads(pageUrl: string, depth: number) {
    try {
      const origin = new URL(pageUrl).origin;
      const sm = await fetchPage(`${origin}/sitemap.xml`, this.opts.signal);
      if (!sm) return;
      const picks = sm.links
        .map((l) => l.url)
        .filter((u) => u.startsWith(origin) && /about|bio|\/me\b|resume|cv|project|portfolio|contact|team|blog/i.test(u))
        .slice(0, 3);
      for (const u of picks) this.enqueue({ url: u, why: "sitemap of a JS-only site", depth });
    } catch {
      /* no sitemap */
    }
  }

  private async read(lead: PageLead): Promise<void> {
    const { signal } = this.opts;
    try {
      const page = await fetchPage(lead.url, signal);
      if (!page) {
        if (process.env.SCAN_DEBUG === "1") console.log("[scan:pages] fetch gave nothing; trying URL context");
        if (Date.now() > this.opts.deadline + 10_000) return;
        const ok = await this.opts.limiter.run(() => this.extractViaUrlContext(lead));
        if (!ok) this.pagesFailed++;
        return;
      }
      if (Date.now() > this.opts.deadline + 10_000) return;
      this.pagesRead++;
      if (process.env.SCAN_DEBUG === "1") console.log(`[scan:pages] read ok depth=${lead.depth} text=${page.text.length} imgs=${page.images.length} metaOnly=${page.metaOnly}`);
      // JS-only sites: follow their static fallbacks (feed, sitemap pages) before giving up.
      if (page.text.length < 400 && !page.metaOnly && lead.depth < 1) {
        if (page.feedUrl) this.enqueue({ url: page.feedUrl, why: "feed of a JS-only page", depth: lead.depth + 1 });
        await this.sitemapLeads(page.url, lead.depth + 1);
      }
      await this.opts.limiter.run(() => this.extract(page, lead.depth, "pages"));
    } catch (e) {
      if (signal.aborted) return;
      this.pagesFailed++;
      console.warn("[scan:pages] page failed:", e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }

  /**
   * Code-side photo candidates on a page already judged to be about the subject:
   * the preview (og) image of their own page, and inline images whose alt or
   * nearby text names them. The in-browser face match decides later.
   */
  private photoCandidates(page: PageData, out: z.infer<typeof Extraction>, already: Set<string>) {
    const rank = { unconfirmed: 0, school: 1, github: 2, email: 3 } as const;
    const best = out.findings.reduce<keyof typeof rank>((a, f) => (rank[f.anchor] > rank[a] ? f.anchor : a), "unconfirmed");
    const s = this.subject;
    const names = [...s.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3), s.githubLogin?.toLowerCase(), s.email.split("@")[0].toLowerCase()].filter(Boolean) as string[];
    const title = (page.title || new URL(page.url).hostname).slice(0, 70);
    const res: z.infer<typeof Extraction>["findings"] = [];
    for (const im of page.images) {
      if (already.has(im.url) || res.length >= 4) continue;
      if (/logo|icon|banner|sprite|badge|screenshot|diagram|chart|placeholder|default[-_]?avatar/i.test(im.url + " " + im.alt)) continue;
      const isPreview = im.alt === "page preview image";
      const near = `${im.alt} ${im.context}`.toLowerCase();
      const mentions = names.some((nm) => near.includes(nm));
      // Also the preview image of an anchored page ABOUT them (Devpost project, team or news page):
      // event/team photos are often the og:image. The in-browser face match decides later.
      const anchoredAbout = isPreview && best !== "unconfirmed" && out.findings.length > 0;
      if (!(isPreview && out.isSubjectsOwnPage) && !mentions && !anchoredAbout) continue;
      res.push({
        category: "photo",
        label: `Photo on ${title}`,
        value: isPreview ? `Preview image of ${title}` : `Image near text naming you on ${title}`,
        sourceType: "web",
        snippet: im.alt || "",
        imageUrl: im.url,
        anchor: best,
        confidence: best === "unconfirmed" ? 0.4 : isPreview && out.isSubjectsOwnPage ? 0.6 : isPreview && !mentions ? 0.4 : 0.5,
        riskWeight: 3,
      });
    }
    return res;
  }

  private track = (u: LlmUsage) => {
    this.usage.input += u.inputTokens;
    this.usage.output += u.outputTokens;
    this.usage.thought += u.thoughtTokens;
    this.opts.onUsage?.(u);
  };

  /** Gemini URL context tool reads the page server-side; we keep text facts only. */
  private async extractViaUrlContext(lead: PageLead): Promise<boolean> {
    const { model, signal } = this.opts;
    try {
      const r = await groundedJson({
        model,
        system: SYSTEM,
        schema: Extraction,
        search: false,
        urls: [lead.url],
        thinking: "low",
        maxOutputTokens: 6000,
        prompt: `SUBJECT (the signed-in user):
${subjectBlock(this.subject)}
Already confirmed about them: ${this.opts.knownAnchors() || "(nothing yet)"}

Read ONLY this page with the URL context tool: ${lead.url}
There is no IMAGES or LINKS list for this page: return no "photo" findings, imageUrl "" everywhere, and followLinks [].`,
        signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
        onUsage: this.track,
      });
      const fetched = r.retrieved.some((x) => x.status === "success");
      if (r.retrieved.length && !fetched) return false;
      this.pagesRead++;
      this.urlContextReads++;
      if (!r.data.aboutSubject) return true;
      // All at once: the collector judges a page's facts together in one batch.
      const adds: Promise<{ ok: boolean }>[] = [];
      for (const f of r.data.findings) {
        if (f.category === "photo") continue;
        adds.push(this.collector.add(
          {
            ...f,
            imageUrl: undefined,
            snippet: f.snippet || undefined,
            sourceUrl: lead.url,
            confidence: Math.min(1, Math.max(0, f.confidence)),
            riskWeight: Math.min(10, Math.max(0, f.riskWeight)),
          },
          "pages",
        ));
      }
      const n = (await Promise.all(adds)).filter((x) => x.ok).length;
      this.count += n;
      return true;
    } catch (e) {
      if (!signal.aborted && process.env.SCAN_DEBUG === "1") console.log("[scan:pages] URL context failed:", e instanceof Error ? e.message.slice(0, 120) : e);
      return false;
    }
  }

  private async extract(page: PageData, depth: number, agentId: string): Promise<number> {
    const { model, signal } = this.opts;
    const imgList = page.images.map((im, i) => `${i + 1}. ${im.url}\n   alt: ${im.alt || "(none)"}\n   nearby text: ${im.context || "(none)"}`).join("\n");
    const linkList = page.links.slice(0, 60).map((l) => `- ${l.url} (${l.text || "no text"})`).join("\n");
    const content = `SUBJECT (the signed-in user):
${subjectBlock(this.subject)}
Already confirmed about them: ${this.opts.knownAnchors() || "(nothing yet)"}

PAGE URL: ${page.url}
TITLE: ${page.title}
DESCRIPTION: ${page.description}
${page.metaOnly ? "(This site only exposes its public preview tags to anonymous visitors; use the title/description/images only.)\n" : ""}
TEXT:
${page.text || "(none)"}

IMAGES:
${imgList || "(none)"}

LINKS:
${linkList || "(none)"}`;

    const out = await generateJson({
      model,
      system: SYSTEM,
      schema: Extraction,
      thinking: "low",
      maxOutputTokens: 6000,
      prompt: content,
      signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
      onUsage: this.track,
    });
    if (!out.aboutSubject) return 0;

    const imageSet = new Set(page.images.map((i) => i.url));
    let n = 0;
    const picked = new Set(out.findings.filter((f) => f.category === "photo").map((f) => f.imageUrl));
    const adds: Promise<{ ok: boolean }>[] = [];
    for (const f of [...out.findings, ...this.photoCandidates(page, out, picked)]) {
      if (f.category === "photo" && !imageSet.has(f.imageUrl)) continue;
      adds.push(this.collector.add(
        {
          ...f,
          imageUrl: f.imageUrl || undefined,
          snippet: f.snippet || undefined,
          sourceUrl: page.url,
          sourceTitle: page.title || undefined,
          confidence: Math.min(1, Math.max(0, f.confidence)),
          riskWeight: Math.min(10, Math.max(0, f.riskWeight)),
        },
        agentId,
      ));
    }
    n = (await Promise.all(adds)).filter((x) => x.ok).length;
    this.count += n;
    if (depth < 1) {
      const linkSet = new Set(page.links.map((l) => l.url));
      for (const u of out.followLinks.slice(0, 3)) {
        if (linkSet.has(u)) this.enqueue({ url: u, why: `linked from ${page.url}`, depth: depth + 1 });
      }
    }
    return n;
  }
}
