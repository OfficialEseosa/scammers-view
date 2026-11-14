import Anthropic from "@anthropic-ai/sdk";
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

const REASONING_MODEL = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const SEARCH_MODEL = () => process.env.ANTHROPIC_SEARCH_MODEL || "claude-sonnet-5-5";

/** Stop queueing new pages after this long; in-flight work still finishes. */
const PAGE_DEADLINE_MS = 66_000;
const MAX_PAGES = 24;
const MAX_CONCURRENT_CLAUDE = 12;

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
  const client = new Anthropic({ maxRetries: 2 });
  const collector = new FindingCollector(emit, { client, signal });
  const limiter = new Limiter(MAX_CONCURRENT_CLAUDE);
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
    client, model: SEARCH_MODEL(), signal, limiter, maxPages: MAX_PAGES, deadline: started + PAGE_DEADLINE_MS, knownAnchors,
  });
  const workerCtx = { subject, collector, reader, client, model: SEARCH_MODEL(), limiter, signal, knownAnchors };
  const usage: WorkerResult[] = [];

  const runAgent = async (plan: AgentPlan) => {
    emit({ type: "source_started", sourceType: plan.sourceType, agentId: plan.id, agentLabel: plan.label, query: plan.queries.map((x) => x.q).join(" | ") });
    const results = await Promise.all(plan.queries.map((x) => runSearchWorker(x.q, x.hint, plan.id, workerCtx)));
    usage.push(...results);
    emit({ type: "source_done", sourceType: plan.sourceType, agentId: plan.id, count: countFor(plan.id) });
  };

  emit({ type: "status", message: "Starting scan of your public footprint" });
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
  await Promise.allSettled([githubTask, photoTask, ...round1.map(runAgent)]);
  if (signal.aborted) return null;
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
  await Promise.allSettled(round2);
  if (signal.aborted) return null;

  await reader.drain();
  emit({ type: "source_done", sourceType: "web", agentId: "pages", count: countFor("pages") });
  if (signal.aborted) return null;

  // --- Reasoning
  emit({ type: "status", message: `Found ${collector.all.length} facts. Working out how a scammer would chain them together` });
  const t1 = Date.now();
  const final = collector.snapshot();
  const r = await runReasoning(final, { client, model: REASONING_MODEL(), signal });
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
      searches: sum("searches"),
      searchTokens: { input: sum("input"), cacheRead: sum("cacheRead"), output: sum("output") },
      pages: { read: reader.pagesRead, failed: reader.pagesFailed, tokens: reader.usage },
      reasoningTokens: r.usage,
    }),
  );
  return final;
}
