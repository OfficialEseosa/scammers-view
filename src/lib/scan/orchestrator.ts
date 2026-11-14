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
const MAX_CONCURRENT = () => Math.max(1, Number(process.env.SCAN_CONCURRENCY) || 16);
/** First follow-up planning pass (round 1 keeps running). */
const FOLLOW_EARLY_MS = 10_000;
/** No new follow-up searches after this. */
const FOLLOW_CUTOFF_MS = 30_000;
/** Score + chains on a provisional set if agents are still running at this point. */
const PROVISIONAL_AT_MS = () => (Number(process.env.SCAN_PROVISIONAL_MS) > 0 ? Number(process.env.SCAN_PROVISIONAL_MS) : 36_000);

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
 * Round 2 is streamed: follow-ups are planned from anchors confirmed SO FAR
 * (after GitHub, at ~10s, and when round 1 settles), launching only new queries.
 * Reasoning runs on a provisional set at ~40s if agents are still busy, and once
 * more at the end only if a late anchored finding could change the top 3.
 */
export async function runScan(subject: ScanSubject, emit: Emit, signal: AbortSignal): Promise<Finding[] | null> {
  const started = Date.now();
  getGemini(); // fail fast (LlmNotConfiguredError) before any agent starts
  const searchModel = MODELS.fast;
  const reasoningModel = MODELS.reasoning;
  // Per-scan usage meter (tokens + executed Google Search queries) for the cost log.
  const calls: LlmUsage[] = [];
  const onUsage = (u: LlmUsage) => calls.push(u);
  let firstFindingMs: number | undefined;
  const findingEmit: Emit = (e) => {
    if (e.type === "finding") firstFindingMs ??= Date.now() - started;
    emit(e);
  };
  const collector = new FindingCollector(findingEmit, { judge: true, signal, onUsage });
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

  // Every agent task is tracked so the scan can wait for work launched later (streamed follow-ups).
  const tasks: Promise<unknown>[] = [];
  const settled: PromiseSettledResult<unknown>[] = [];
  const track = <T,>(p: Promise<T>): Promise<T> => {
    tasks.push(p);
    return p;
  };
  const settleAll = async () => {
    let n = 0;
    while (n < tasks.length) {
      const batch = tasks.slice(n);
      n = tasks.length;
      settled.push(...(await Promise.allSettled(batch)));
    }
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (ms <= 0 || signal.aborted) return resolve();
      const t = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });

  // --- Round 1
  let projects: string[] = [];
  let orgs: string[] = [];
  const launched = new Set<string>();
  /** Round 2, streamed: plan follow-ups from the anchors confirmed so far and launch only new queries. */
  const launchFollowUps = () => {
    if (!enabled("follow") || signal.aborted || Date.now() - started > FOLLOW_CUTOFF_MS) return;
    for (const plan of followUpPlans(subject, collector.confirmed(), { projects, orgs })) {
      const fresh = plan.queries.filter((x) => !launched.has(x.q));
      if (!fresh.length) continue;
      fresh.forEach((x) => launched.add(x.q));
      track(runAgent({ ...plan, queries: fresh }));
    }
  };
  let socialStarted = false;
  /** Apify social profiles need anchored handles; start once, as soon as round 1 has produced them. */
  const startSocial = () => {
    if (socialStarted || !enabled("social") || signal.aborted) return;
    socialStarted = true;
    track(runSocialSources([...collector.all], { collector, reader, emit, signal, subject }));
  };

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
        launchFollowUps(); // projects and orgs are known now
        if (gh.doc) await reader.readDocument(gh.doc, "github");
        emit({ type: "source_done", sourceType: "github", agentId: "github", count: countFor("github") });
      })()
    : Promise.resolve();
  track(githubTask);

  const photosOn = enabled("photos");
  if (photosOn) {
    emit({ type: "source_started", sourceType: "other", agentId: "photos", agentLabel: "Profile pictures tied to your emails", query: "Gravatar" });
    track(addGravatarPhotos([subject.email], collector, signal));
  }

  const round1 = roundOnePlans(subject).filter((p) => enabled(p.id));
  for (const plan of round1) plan.queries.forEach((x) => launched.add(x.q));
  const round1Done = Promise.allSettled([githubTask, ...round1.map((p) => track(runAgent(p)))]);

  // Re-plan follow-ups early with whatever is confirmed, then again when round 1 settles.
  track(Promise.race([sleep(FOLLOW_EARLY_MS), round1Done]).then(() => { launchFollowUps(); startSocial(); }));
  track(
    round1Done.then(async () => {
      launchFollowUps();
      startSocial();
      if (photosOn) {
        await addGravatarPhotos(collector.confirmed().filter((f) => f.category === "email").map((f) => f.value), collector, signal);
        emit({ type: "source_done", sourceType: "other", agentId: "photos", count: countFor("photos") });
      }
    }),
  );

  const workDone = (async () => {
    await settleAll();
    await reader.drain();
    await settleAll();
  })();
  workDone.catch(() => undefined);

  // --- Reasoning: provisional at ~40s if agents are still running; refreshed once if late findings matter.
  const which = await Promise.race([
    workDone.then(() => "done" as const),
    sleep(started + PROVISIONAL_AT_MS() - Date.now()).then(() => "provisional" as const),
  ]);
  if (signal.aborted) return null;
  throwIfFatal(settled);
  if (which === "done") emit({ type: "source_done", sourceType: "web", agentId: "pages", count: countFor("pages") });

  const thinking = (["low", "medium", "high"] as const).find((x) => x === process.env.SCAN_REASONING_THINKING) ?? "low";
  const reason = async (label: string) => {
    const snap = collector.snapshot();
    emit({ type: "status", stage: "reasoning", model: reasoningModel, message: `${label}: ${snap.length} facts. ${modelLabel(reasoningModel)} is thinking through how a scammer would chain them together` });
    const res = await runReasoning(snap, { model: reasoningModel, signal, thinking, onUsage });
    emit({ type: "score", score: res.score });
    for (const chain of res.chains) emit({ type: "chain", chain });
    return { res, ids: new Set(snap.map((f) => f.id)) };
  };
  const t1 = Date.now();
  let { res: r, ids: reasoned } = await reason(which === "done" ? "Found" : "First pass");
  const scoreAtMs = Date.now() - started;
  let refreshed = false;
  let lateFindings = 0;
  if (which === "provisional") {
    await workDone;
    if (signal.aborted) return null;
    throwIfFatal(settled);
    emit({ type: "source_done", sourceType: "web", agentId: "pages", count: countFor("pages") });
    const byId = new Map(collector.all.map((f) => [f.id, f]));
    const topMin = Math.min(10, ...r.score.topFindingIds.map((id) => byId.get(id)?.riskWeight ?? 0));
    const late = collector.all.filter((f) => !reasoned.has(f.id));
    lateFindings = late.length;
    // Refresh only if a late, anchored finding could enter the top 3.
    if (late.some((f) => f.anchor !== "unconfirmed" && f.riskWeight >= Math.max(topMin, 6))) {
      refreshed = true;
      ({ res: r, ids: reasoned } = await reason("Updated with late findings"));
    }
  }
  const final = collector.snapshot();

  // Server-side telemetry only (counts and tokens, no personal data).
  const sum = (k: keyof WorkerResult) => usage.reduce((n, u) => n + u[k], 0);
  console.log(
    "[scan] done",
    JSON.stringify({
      totalMs: Date.now() - started,
      firstFindingMs,
      scoreAtMs,
      provisional: which === "provisional",
      lateFindings,
      refreshed,
      reasoningMs: Date.now() - t1,
      findings: collector.all.length,
      photos: collector.all.filter((f) => f.category === "photo").length,
      chains: r.chains.length,
      nearDuplicatesJudgedByReasoning: r.merged,
      dedupe: { ...collector.stats, judge: collector.judgeStats() },
      workers: usage.length,
      followUpQueries: launched.size,
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
