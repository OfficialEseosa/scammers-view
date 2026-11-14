import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  Finding,
  FindingCategory,
  IdentityAnchor,
  SourceType,
  type ScanEvent,
} from "@/lib/types";
import { ANCHOR_RANK, canonicalUrl, classify, exactKey, isUsefulInterest, jaccard, richer, tokens } from "./dedupe";

export type Emit = (event: ScanEvent) => void;

/** What a source agent hands to the collector; id, sources and foundAt are assigned here. */
export const RawFinding = z.object({
  category: FindingCategory,
  label: z.string().min(1),
  value: z.string().min(1),
  sourceType: SourceType,
  sourceUrl: z.string().min(1),
  sourceTitle: z.string().optional(),
  snippet: z.string().optional(),
  imageUrl: z.string().optional(),
  mediaUrl: z.string().optional(),
  durationSec: z.number().min(0).optional(),
  soundOriginal: z.boolean().optional(),
  soundTitle: z.string().optional(),
  anchor: IdentityAnchor,
  confidence: z.number().min(0).max(1),
  riskWeight: z.number().min(0).max(10),
});
export type RawFinding = z.infer<typeof RawFinding>;

/** URLs that look like auth flows. Findings must never cite them and the fetcher never visits them. */
const AUTH_URL = /(log[-_]?in|sign[-_]?in|sign[-_]?up|password|passwd|reset|recover|forgot|account[-_]?lookup|oauth|\/auth\b|\/sso\b|\/session)/i;
export function isAuthLikeUrl(url: string): boolean {
  return AUTH_URL.test(url);
}

export function normalizeUrl(u: string): string {
  return canonicalUrl(u);
}

const MIN_UNCONFIRMED_CONFIDENCE = 0.35;
const MIN_CONFIDENCE = 0.2;
const CAP: Partial<Record<string, number>> = { interest: 7, other: 6 };
const SEMANTIC = new Set(["interest", "other", "school", "employer", "location", "schedule", "birthday", "pet", "relative"]);
const LOOSE = new Set(["interest", "other", "handle"]);
/** Aggregate restatements ("linked social accounts") are padding: the individual handles carry the fact. */
const AGGREGATE_LABEL = /linked (social )?(accounts|platforms|profiles)|social (media )?(accounts|presence)|online presence|hashtag/i;
const JUDGE_MODEL = () => process.env.ANTHROPIC_DEDUPE_MODEL || "claude-haiku-5-5";
const JUDGE_WAIT_MS = 8000;
const JUDGE_BATCH_MS = 120;

function clean(s: string | undefined, max: number): string | undefined {
  if (s == null) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export type AddResult = { ok: true; finding: Finding } | { ok: false; reason: string; mergedInto?: string };

const JudgeOut = z.object({ answers: z.array(z.object({ index: z.number(), duplicateOf: z.string() })) });

interface JudgeReq {
  cand: { category: string; label: string; value: string };
  options: Finding[];
  resolve: (id: string | null) => void;
}

/**
 * Batched duplicate judge (fast model) for candidates the rules can't decide.
 * Candidates wait for its answer (held, not emitted) up to JUDGE_WAIT_MS.
 */
class DuplicateJudge {
  private queue: JudgeReq[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  calls = 0;
  timeouts = 0;
  constructor(private client: Anthropic | null, private signal: AbortSignal) {}

  ask(cand: JudgeReq["cand"], options: Finding[]): Promise<string | null | "timeout"> {
    if (!this.client || options.length === 0) return Promise.resolve("timeout");
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timeouts++;
        resolve("timeout");
      }, JUDGE_WAIT_MS);
      this.queue.push({ cand, options, resolve: (id) => { clearTimeout(t); resolve(id); } });
      this.timer ??= setTimeout(() => this.flush(), JUDGE_BATCH_MS);
    });
  }

  private async flush() {
    this.timer = null;
    const batch = this.queue.splice(0);
    if (!batch.length || !this.client) return;
    this.calls++;
    const prompt = batch
      .map((r, i) => `#${i} NEW [${r.cand.category}] ${r.cand.label}: ${r.cand.value}\n` + r.options.map((o) => `   ${o.id}: ${o.label}: ${o.value}`).join("\n"))
      .join("\n\n");
    try {
      const res = await this.client.messages.parse(
        {
          model: JUDGE_MODEL(),
          max_tokens: 2000,
          output_config: { effort: "low", format: zodOutputFormat(JudgeOut) },
          system:
            'You de-duplicate facts about one person. For each NEW item, decide whether it states the SAME fact as one of the listed existing items (same school/employer/place/handle/interest, just worded, abbreviated or formatted differently, or one is a more specific version of the other). Examples of duplicates: "Hackathon: X" and "Won X hackathon"; "Project: Foo" and "Current project Foo"; "Deans List" and "Presidents/Deans List 2024"; a handle and a bio line that only repeats it. Different facts are NOT duplicates (two different schools, a city vs. a different city, two different projects or interests). Answer every index; duplicateOf is the existing id, or "" if it is new.',
          messages: [{ role: "user", content: prompt }],
        },
        { signal: AbortSignal.any([this.signal, AbortSignal.timeout(JUDGE_WAIT_MS)]) },
      );
      const answers = new Map((res.parsed_output?.answers ?? []).map((a) => [a.index, a.duplicateOf]));
      batch.forEach((r, i) => {
        const id = answers.get(i) ?? "";
        r.resolve(r.options.some((o) => o.id === id) ? id : null);
      });
    } catch {
      batch.forEach((r) => r.resolve(null));
    }
  }
}

/**
 * Shared across all source agents. Validates, filters namesakes and padding,
 * and de-duplicates BEFORE anything goes on the wire:
 *   1) exact canonical key, 2) rule-based fuzzy match within the category,
 *   3) a batched fast-model check for ambiguous pairs (candidate is held meanwhile).
 * A duplicate is never emitted; its source is merged into the kept finding
 * (richer value, stronger anchor, higher confidence), visible in snapshot().
 */
export class FindingCollector {
  private byKey = new Map<string, Finding>();
  private n = 0;
  private locks = new Map<string, Promise<unknown>>();
  private judge: DuplicateJudge;
  private catCount = new Map<string, number>();
  readonly all: Finding[] = [];
  readonly agentOf = new Map<string, string>();
  stats = { emitted: 0, mergedExact: 0, mergedRule: 0, mergedModel: 0, droppedPadding: 0 };

  constructor(private emit: Emit, opts: { client?: Anthropic; signal?: AbortSignal } = {}) {
    this.judge = new DuplicateJudge(opts.client ?? null, opts.signal ?? new AbortController().signal);
  }

  /** Final merged state (what reasoning and recordings use). */
  snapshot(): Finding[] {
    return this.all.map((f) => structuredClone(f));
  }

  /** Confirmed (anchored, reasonably confident) findings, for follow-up seeding. */
  confirmed(): Finding[] {
    return this.all.filter((f) => f.anchor !== "unconfirmed" && f.confidence >= 0.6);
  }

  judgeStats() {
    return { calls: this.judge.calls, timeouts: this.judge.timeouts };
  }

  add(input: unknown, agentId = "unknown"): Promise<AddResult> {
    const parsed = RawFinding.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve({ ok: false, reason: "invalid shape: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    }
    const raw = parsed.data;
    const pre = this.precheck(raw);
    if (pre) return Promise.resolve({ ok: false, reason: pre });
    // Serialize per category so concurrent candidates see each other's decisions.
    const prev = this.locks.get(raw.category) ?? Promise.resolve();
    const next = prev.then(() => this.decide(raw, agentId));
    this.locks.set(raw.category, next.catch(() => undefined));
    return next;
  }

  private precheck(raw: RawFinding): string | null {
    if (!/^https?:\/\//i.test(raw.sourceUrl)) return "sourceUrl must be an http(s) URL";
    if (isAuthLikeUrl(raw.sourceUrl)) return "sourceUrl is a login/reset/auth page; not allowed";
    if (raw.anchor === "face") return "face anchor is set only by the in-browser face match";
    if (raw.confidence < MIN_CONFIDENCE) return "confidence too low";
    if (raw.anchor === "unconfirmed" && raw.confidence < MIN_UNCONFIRMED_CONFIDENCE) return "unconfirmed and low confidence (likely a namesake)";
    if (raw.category === "photo" && !(raw.imageUrl && /^https?:\/\//i.test(raw.imageUrl) && !isAuthLikeUrl(raw.imageUrl))) return "photo findings need a direct imageUrl";
    if (raw.category === "video" && !(raw.mediaUrl && /^https:\/\//i.test(raw.mediaUrl))) return "video findings need a direct https mediaUrl";
    if (!tokens(raw.value).length && raw.category !== "photo") return "empty value";
    if (raw.category === "interest" && !isUsefulInterest(raw.value, raw.riskWeight)) {
      this.stats.droppedPadding++;
      return "interest too generic to matter";
    }
    if ((raw.category === "other" || raw.category === "handle") && AGGREGATE_LABEL.test(raw.label)) {
      this.stats.droppedPadding++;
      return "aggregate restatement; individual findings carry the fact";
    }
    if (raw.category === "other" && raw.riskWeight < 2) {
      this.stats.droppedPadding++;
      return "not useful to an attacker";
    }
    return null;
  }

  private async decide(raw: RawFinding, agentId: string): Promise<AddResult> {
    const key = exactKey(raw);
    const exact = this.byKey.get(key);
    if (exact) {
      this.stats.mergedExact++;
      this.merge(exact, raw);
      return { ok: false, reason: `duplicate of ${exact.id} (merged)`, mergedInto: exact.id };
    }
    const same = this.all.filter((f) => f.category === raw.category);
    const ambiguous: Finding[] = [];
    for (const f of same) {
      const v = classify(raw, f);
      if (v === "dup") {
        this.stats.mergedRule++;
        this.merge(f, raw);
        this.byKey.set(key, f);
        return { ok: false, reason: `duplicate of ${f.id} (merged)`, mergedInto: f.id };
      }
      // Free-text categories: rules can't see paraphrases ("Hackathon" vs "Hackathon win"),
      // so every same-category item goes to the judge, not just the rule-ambiguous ones.
      if (v === "ambiguous" || SEMANTIC.has(raw.category)) ambiguous.push(f);
    }
    // Loose categories also restate each other ("Linked social accounts" as other vs handle).
    if (LOOSE.has(raw.category)) {
      for (const f of this.all) if (f.category !== raw.category && LOOSE.has(f.category)) ambiguous.push(f);
    }
    if (ambiguous.length) {
      const ans = await this.judge.ask({ category: raw.category, label: raw.label, value: raw.value }, ambiguous.slice(0, 15));
      let target: Finding | undefined;
      if (ans === "timeout") {
        // No answer in time: merge into a close match rather than emit a likely duplicate.
        const t = tokens(raw.value);
        target = ambiguous.find((f) => jaccard(t, tokens(f.value)) >= 0.5);
      } else if (ans) {
        target = ambiguous.find((f) => f.id === ans);
      }
      if (target) {
        this.stats.mergedModel++;
        this.merge(target, raw);
        this.byKey.set(key, target);
        return { ok: false, reason: `duplicate of ${target.id} (merged)`, mergedInto: target.id };
      }
    }

    const cap = CAP[raw.category];
    if (cap !== undefined && (this.catCount.get(raw.category) ?? 0) >= cap && raw.riskWeight < 6) {
      this.stats.droppedPadding++;
      return { ok: false, reason: `enough ${raw.category} findings already` };
    }

    const candidate = {
      id: `f${++this.n}`,
      category: raw.category,
      label: clean(raw.label, 80)!,
      value: clean(raw.value, 300)!,
      sourceType: raw.sourceType,
      sourceUrl: raw.sourceUrl.trim(),
      sourceTitle: clean(raw.sourceTitle, 160),
      snippet: clean(raw.snippet, 400),
      imageUrl: raw.imageUrl?.trim(),
      ...(raw.category === "video"
        ? { mediaUrl: raw.mediaUrl?.trim(), durationSec: raw.durationSec, soundOriginal: raw.soundOriginal, soundTitle: clean(raw.soundTitle, 120) }
        : {}),
      sources: [{ url: raw.sourceUrl.trim(), title: clean(raw.sourceTitle, 160), sourceType: raw.sourceType }],
      anchor: raw.anchor,
      confidence: Math.round(raw.confidence * 100) / 100,
      riskWeight: Math.round(raw.riskWeight * 10) / 10,
      foundAt: new Date().toISOString(),
    };
    const finding = Finding.safeParse(candidate);
    if (!finding.success) {
      this.n--;
      return { ok: false, reason: "failed contract validation" };
    }
    this.byKey.set(key, finding.data);
    this.all.push(finding.data);
    this.catCount.set(raw.category, (this.catCount.get(raw.category) ?? 0) + 1);
    this.agentOf.set(finding.data.id, agentId);
    this.stats.emitted++;
    this.emit({ type: "finding", finding: structuredClone(finding.data) });
    return { ok: true, finding: finding.data };
  }

  private merge(kept: Finding, raw: RawFinding) {
    const sources = (kept.sources ??= []);
    const url = raw.sourceUrl.trim();
    if (!sources.some((s) => canonicalUrl(s.url) === canonicalUrl(url))) {
      sources.push({ url, title: clean(raw.sourceTitle, 160), sourceType: raw.sourceType });
    }
    if ((ANCHOR_RANK[raw.anchor] ?? 0) > (ANCHOR_RANK[kept.anchor] ?? 0)) kept.anchor = raw.anchor;
    kept.confidence = Math.max(kept.confidence, Math.round(raw.confidence * 100) / 100);
    kept.riskWeight = Math.max(kept.riskWeight, Math.round(raw.riskWeight * 10) / 10);
    if (kept.category !== "photo" && kept.category !== "email" && kept.category !== "video") {
      const v = richer(kept.value, raw.value);
      if (v !== kept.value) kept.value = clean(v, 300)!;
    }
    if (!kept.snippet && raw.snippet) kept.snippet = clean(raw.snippet, 400);
  }
}
