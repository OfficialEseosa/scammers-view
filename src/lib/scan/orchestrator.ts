import { estimateCostUsd, getGemini, LlmBillingError, LlmNotConfiguredError, MODELS, modelLabel, type LlmUsage } from "@/lib/llm/gemini";
import type { Finding, ScanSubject } from "@/lib/types";
import { FindingCollector, type Emit } from "./findings";
import { runGithubSource } from "./github";
import { addGravatarPhotos } from "./gravatar";
import { Limiter } from "./limit";
import { PageReader } from "./pageReader";
import { runReasoning } from "./reasoning";
import { followUpPlans, roundOnePlans, type AgentPlan } from "./roster";
import { runSearchWorker, type WorkerResult } from "./searchWorker";
import { runSocialSources } from "./social";


/** Stop queueing new pages after this long; in-flight work still finishes. */
const PAGE_DEADLINE_MS = 50_000;
const MAX_PAGES = 24;
/** Concurrent Gemini calls per scan; lower it (SCAN_CONCURRENCY) on low-RPM tiers. */
const MAX_CONCURRENT = () => Math.max(1, Number(process.env.SCAN_CONCURRENCY) || 12);

/** Billing / missing-key errors end the scan with a clear message instead of an empty result. */
function throwIfFatal(results: PromiseSettledResult<unknown>[]) {
  for (const r of results) {
    if (r.status === "rejected" && (r.reason instanceof LlmBillingError || r.reason instanceof LlmNotConfiguredError)) throw r.reason;
  }
}

/**
 * Runs a full scan of `subject` (which must come from getScanSubject(), never
 * from request input). Emits ScanEvents as they happen; the caller emits done/error.
 *
 * Round 1 (parallel): GitHub API + fixed search plans + page reader.
 * Round 2: follow-up searches seeded with confirmed anchors from round 1.
 * Then one reasoning call for score + attack chains.
 */
export async function runScan(subject: ScanSubject, emit: Emit, signal: AbortSignal): Promise<Finding[] | null> {
  const started = Date.now();
  getGemini(); // fail fast (LlmNotConfiguredError) before any agent starts
  const searchModel = MODELS.fast;
  const reasoningModel = MODELS.reasoning;
  // Per-scan usage meter (tokens + executed Google Search queries) for the cost log.
  const calls: LlmUsage[] = [];
  const onUsage = (u: LlmUsage) => calls.push(u);
  const collector = new FindingCollector(emit, { judge: true, signal, onUsage });
  const limiter = new Limiter(MAX_CONCURRENT());
  const only = process.env.SCAN_SOURCES?.split(",").map((s) => s.trim()).filter(Boolean);
  const enabled = (id: string) => !only || only.includes(id);
  const countFor = (agentId: string) => [...collector.agentOf.values()].filter((a) => a === agentId).length;

  const knownAnchors = () =>
    collector
      .confirmed()
      .filter((f) => ["handle", "email", "school", "employer"].includes(f.category))
      .slice(0, 12)
      .map((f) => `${f.label}: ${f.value}`)
      .join("; ");

  const reader = new PageReader(subject, collector, {
    model: searchModel, onUsage, signal, limiter, maxPages: MAX_PAGES, deadline: started + PAGE_DEADLINE_MS, knownAnchors,
  });
  const liveQueries: string[] = [];
  const workerCtx = {
    subject, collector, reader, model: searchModel, limiter, signal, knownAnchors, onUsage,
    onQueries: (_agentId: string, qs: string[]) => { liveQueries.push(...qs); },
  };
  const usage: WorkerResult[] = [];

  const runAgent = async (plan: AgentPlan) => {
    emit({ type: "source_started", sourceType: plan.sourceType, agentId: plan.id, agentLabel: plan.label, query: plan.queries.map((x) => x.q).join(" | ") });
    const results = await Promise.all(plan.queries.map((x) => runSearchWorker(x.q, x.hint, plan.id, workerCtx)));
    usage.push(...results);
    emit({ type: "source_done", sourceType: plan.sourceType, agentId: plan.id, count: countFor(plan.id) });
  };

  emit({ type: "status", message: "Starting scan of your public footprint" });
  emit({ type: "status", stage: "search", model: searchModel, message: `Search agents: ${modelLabel(searchModel)} with Google Search, in parallel` });
  emit({ type: "status", stage: "pages", model: searchModel, message: `Page reader: ${modelLabel(searchModel)} structured extraction, URL context as fallback` });
  emit({ type: "status", stage: "dedupe", model: MODELS.lite, message: `Duplicate check: ${modelLabel(MODELS.lite)}` });
  emit({ type: "source_started", sourceType: "web", agentId: "pages", agentLabel: "Reading pages in full", query: "pages found by the searches" });

  // --- Round 1
  let projects: string[] = [];
  let orgs: string[] = [];
  const githubTask = subject.githubLogin && enabled("github")
    ? (async () => {
        emit({ type: "source_started", sourceType: "github", agentId: "github", agentLabel: "GitHub: profile, repos, commits, gists, stars", query: "GitHub public API" });
        const gh = await runGithubSource(subject, collector, emit, signal);
        projects = gh.projects;
        orgs = gh.orgs;
        for (const u of gh.leads.slice(0, 4)) reader.enqueue({ url: u, why: "linked from GitHub", depth: 0 });
        // Common same-username homes; the reader only keeps facts if the page is really theirs.
        const L = subject.githubLogin!.toLowerCase();
        reader.enqueue({ url: `https://${L}.github.io/`, why: "GitHub Pages site for the login", depth: 0 });
        reader.enqueue({ url: `https://devpost.com/${L}`, why: "Devpost profile under the same username", depth: 0 });
        if (gh.doc) await reader.readDocument(gh.doc, "github");
        emit({ type: "source_done", sourceType: "github", agentId: "github", count: countFor("github") });
      })()
    : Promise.resolve();

  const photosOn = enabled("photos");
  if (photosOn) emit({ type: "source_started", sourceType: "other", agentId: "photos", agentLabel: "Profile pictures tied to your emails", query: "Gravatar" });
  const photoTask = photosOn ? addGravatarPhotos([subject.email], collector, signal) : Promise.resolve(0);

  const round1 = roundOnePlans(subject).filter((p) => enabled(p.id));
  const settled1 = await Promise.allSettled([githubTask, photoTask, ...round1.map(runAgent)]);
  if (signal.aborted) return null;
  throwIfFatal(settled1);
  if (photosOn) {
    await addGravatarPhotos(collector.confirmed().filter((f) => f.category === "email").map((f) => f.value), collector, signal);
    emit({ type: "source_done", sourceType: "other", agentId: "photos", count: countFor("photos") });
  }

  // --- Round 2: follow-ups seeded with confirmed anchors, and social profiles
  // (Apify) for handles already tied to the subject. Both run in parallel.
  const round2: Promise<unknown>[] = [];
  if (enabled("follow")) {
    const plans = followUpPlans(subject, collector.confirmed(), { projects, orgs });
    if (plans.length) {
      emit({ type: "status", message: `Following up on ${plans.reduce((n, p) => n + p.queries.length, 0)} leads (usernames, projects, organizations)` });
      round2.push(...plans.map(runAgent));
    }
  }
  if (enabled("social")) round2.push(runSocialSources([...collector.all], { collector, reader, emit, signal }));
  throwIfFatal(await Promise.allSettled(round2));
  if (signal.aborted) return null;

  await reader.drain();
  emit({ type: "source_done", sourceType: "web", agentId: "pages", count: countFor("pages") });
  if (signal.aborted) return null;

  // --- Reasoning
  emit({ type: "status", stage: "reasoning", model: reasoningModel, message: `Found ${collector.all.length} facts. ${modelLabel(reasoningModel)} is thinking through how a scammer would chain them together` });
  const t1 = Date.now();
  const final = collector.snapshot();
  const thinking = (["low", "medium", "high"] as const).find((x) => x === process.env.SCAN_REASONING_THINKING) ?? "low";
  const r = await runReasoning(final, { model: reasoningModel, signal, thinking, onUsage });
  emit({ type: "score", score: r.score });
  for (const chain of r.chains) emit({ type: "chain", chain });

  // Server-side telemetry only (counts and tokens, no personal data).
  const sum = (k: keyof WorkerResult) => usage.reduce((n, u) => n + u[k], 0);
  console.log(
    "[scan] done",
    JSON.stringify({
      totalMs: Date.now() - started,
      reasoningMs: Date.now() - t1,
      findings: collector.all.length,
      photos: collector.all.filter((f) => f.category === "photo").length,
      chains: r.chains.length,
      nearDuplicatesJudgedByReasoning: r.merged,
      dedupe: { ...collector.stats, judge: collector.judgeStats() },
      workers: usage.length,
      models: { search: searchModel, reasoning: reasoningModel, dedupe: MODELS.lite },
      searches: sum("searches"),
      liveQueries: liveQueries.length,
      citations: { pinned: sum("pinned"), droppedUncited: sum("uncited"), workersWithoutCitations: sum("noCitations") },
      searchTokens: { input: sum("input"), output: sum("output"), thought: sum("thought") },
      pages: { read: reader.pagesRead, viaUrlContext: reader.urlContextReads, failed: reader.pagesFailed, tokens: reader.usage },
      reasoningTokens: r.usage,
      llmCalls: calls.length,
      costUsd: {
        tokens: Math.round(calls.reduce((n, u) => n + estimateCostUsd(u, { countSearch: false }), 0) * 10000) / 10000,
        searchQueries: calls.reduce((n, u) => n + u.searchQueries, 0),
        // Google Search grounding: first 5,000 queries/month free, then $14 / 1,000.
        withPaidSearch: Math.round(calls.reduce((n, u) => n + estimateCostUsd(u), 0) * 10000) / 10000,
      },
    }),
  );
  return final;
}
