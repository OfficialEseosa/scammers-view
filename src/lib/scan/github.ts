import type { ScanSubject } from "@/lib/types";
import type { Emit, FindingCollector, RawFinding } from "./findings";
import type { PageData } from "./pageFetch";

/**
 * GitHub source: public REST API only (no auth required; GITHUB_TOKEN is used
 * if present just to raise the rate limit). ~10 requests per scan.
 * Direct facts are emitted here; README/repo/gist/star text is returned as a
 * document for the page reader to extract from, plus seeds for follow-ups.
 */

const API = "https://api.github.com";
const MAX_COMMIT_REPOS = 3;

class RateLimited extends Error {}

async function gh<T>(path: string, signal: AbortSignal, accept = "application/vnd.github+json"): Promise<T | null> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "scammers-view-scan",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(API + path, { headers, signal, cache: "no-store" });
  if (res.status === 404 || res.status === 409) return null; // 409 = empty repo
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0" || res.status === 429) throw new RateLimited("GitHub rate limit reached");
    return null;
  }
  if (!res.ok) return null;
  return (accept.includes("raw") ? await res.text() : await res.json()) as T;
}

interface GhUser {
  login: string; name: string | null; company: string | null; blog: string | null; location: string | null;
  email: string | null; bio: string | null; twitter_username: string | null; html_url: string; avatar_url: string;
  created_at: string;
}
interface GhRepo {
  name: string; full_name: string; fork: boolean; html_url: string; description: string | null;
  pushed_at: string | null; homepage: string | null; topics?: string[]; language: string | null; stargazers_count: number;
}
interface GhEvent {
  type: string; created_at: string; repo: { name: string };
  payload: { commits?: { sha: string; author?: { email?: string; name?: string } }[] };
}
interface GhCommit { sha: string; html_url: string; commit: { author: { name: string; email: string; date: string } } }
interface GhOrg { login: string; description: string | null }
interface GhGist { html_url: string; description: string | null; files: Record<string, { filename: string }> }
interface GhStar { full_name: string; description: string | null; topics?: string[]; language: string | null }

const isNoreply = (email: string) => /noreply|no-reply|users\.noreply\.github\.com/i.test(email);

export interface GithubResult {
  doc: PageData | null;
  leads: string[];
  projects: string[];
  orgs: string[];
}

export async function runGithubSource(
  subject: ScanSubject,
  collector: FindingCollector,
  emit: Emit,
  signal: AbortSignal,
): Promise<GithubResult> {
  const result: GithubResult = { doc: null, leads: [], projects: [], orgs: [] };
  const login = subject.githubLogin;
  if (!login) return result;
  const pending: Promise<unknown>[] = [];
  const add = (f: RawFinding) => void pending.push(collector.add(f, "github"));
  const L = encodeURIComponent(login);
  const profileUrl = `https://github.com/${L}`;

  try {
    const user = await gh<GhUser>(`/users/${L}`, signal);
    if (!user) {
      emit({ type: "status", message: "GitHub profile not found" });
      return result;
    }
    const base = { sourceType: "github" as const, sourceUrl: user.html_url || profileUrl, sourceTitle: `GitHub profile (${user.login})`, anchor: "github" as const };

    if (user.avatar_url) add({ ...base, category: "photo", label: "GitHub avatar", value: "Profile picture on GitHub", imageUrl: user.avatar_url, confidence: 0.9, riskWeight: 3 });
    if (user.email && !isNoreply(user.email)) add({ ...base, category: "email", label: "Public email on GitHub profile", value: user.email, confidence: 0.98, riskWeight: 8 });
    if (user.company) add({ ...base, category: "employer", label: "Company on GitHub profile", value: user.company.replace(/^@/, ""), confidence: 0.9, riskWeight: 6 });
    if (user.location) add({ ...base, category: "location", label: "Location on GitHub profile", value: user.location, confidence: 0.9, riskWeight: 6 });
    if (user.twitter_username) add({ ...base, category: "handle", label: "X/Twitter handle linked from GitHub", value: "@" + user.twitter_username, confidence: 0.95, riskWeight: 5 });
    if (user.blog) {
      add({ ...base, category: "handle", label: "Personal website linked from GitHub", value: user.blog, confidence: 0.9, riskWeight: 4 });
      result.leads.push(/^https?:/i.test(user.blog) ? user.blog : `https://${user.blog}`);
    }
    if (user.bio) add({ ...base, category: "other", label: "GitHub bio", value: user.bio, confidence: 0.95, riskWeight: 3 });
    if (user.name && user.name.trim().toLowerCase() !== subject.name.trim().toLowerCase()) {
      add({ ...base, category: "other", label: "Display name on GitHub", value: user.name, confidence: 0.9, riskWeight: 2 });
    }
    if (user.company) result.orgs.push(user.company.replace(/^@/, ""));

    const [repos, events, orgs, gists, starred, readme] = await Promise.all([
      gh<GhRepo[]>(`/users/${L}/repos?per_page=100&sort=pushed`, signal),
      gh<GhEvent[]>(`/users/${L}/events/public?per_page=100`, signal),
      gh<GhOrg[]>(`/users/${L}/orgs`, signal),
      gh<GhGist[]>(`/users/${L}/gists?per_page=30`, signal),
      gh<GhStar[]>(`/users/${L}/starred?per_page=50`, signal),
      gh<string>(`/repos/${L}/${L}/readme`, signal, "application/vnd.github.raw+json"),
    ]);

    for (const o of orgs ?? []) {
      add({ category: "other", label: "GitHub organization membership", value: o.login, sourceType: "github", sourceUrl: `https://github.com/${o.login}`, sourceTitle: o.description ?? undefined, anchor: "github", confidence: 0.9, riskWeight: 4 });
      result.orgs.push(o.login);
    }

    const own = (repos ?? []).filter((r) => !r.fork);
    result.projects = [...own].sort((a, b) => b.stargazers_count - a.stargazers_count || (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""))
      .map((r) => r.name).filter((n) => n.toLowerCase() !== login.toLowerCase() && !/^(dotfiles|config|test|homework|hw\d*)$/i.test(n)).slice(0, 3);

    // Commit identities (name + email) are the classic leak.
    const identities = new Map<string, { name: string; url: string }>();
    for (const ev of events ?? []) {
      if (ev.type !== "PushEvent") continue;
      for (const c of ev.payload.commits ?? []) {
        const email = c.author?.email;
        if (email && !isNoreply(email) && !identities.has(email.toLowerCase())) {
          identities.set(email.toLowerCase(), { name: c.author?.name ?? "", url: `https://github.com/${ev.repo.name}/commit/${c.sha}` });
        }
      }
    }
    const commitLists = await Promise.all(
      [...own].sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? "")).slice(0, MAX_COMMIT_REPOS).map((r) =>
        gh<GhCommit[]>(`/repos/${r.full_name}/commits?author=${L}&per_page=30`, signal).catch((e) => {
          if (e instanceof RateLimited) throw e;
          return null;
        }),
      ),
    );
    const commitDates: string[] = [];
    for (const list of commitLists) {
      for (const c of list ?? []) {
        commitDates.push(c.commit.author.date);
        const email = c.commit.author.email;
        if (email && !isNoreply(email) && !identities.has(email.toLowerCase())) identities.set(email.toLowerCase(), { name: c.commit.author.name, url: c.html_url });
      }
    }
    for (const [email, info] of identities) {
      add({ category: "email", label: "Email in public git commits", value: email, sourceType: "github", sourceUrl: info.url, sourceTitle: "Public commit metadata", snippet: info.name ? `Commit author: ${info.name} <${email}>` : undefined, anchor: "github", confidence: 0.9, riskWeight: 8 });
      const domain = email.split("@")[1] ?? "";
      if (/\.edu$|\.ac\.[a-z]{2}$/i.test(domain)) {
        add({ category: "school", label: "School implied by commit email domain", value: domain, sourceType: "github", sourceUrl: info.url, sourceTitle: "Public commit metadata", anchor: "github", confidence: 0.85, riskWeight: 6 });
      }
      const n = info.name.trim().toLowerCase();
      if (n && n !== subject.name.trim().toLowerCase() && n !== (user.name ?? "").trim().toLowerCase()) {
        add({ category: "other", label: "Name used in git commits", value: info.name, sourceType: "github", sourceUrl: info.url, sourceTitle: "Public commit metadata", anchor: "github", confidence: 0.8, riskWeight: 3 });
      }
    }

    // Repo homepages -> pages to read in full.
    for (const r of own) {
      if (r.homepage && /^https?:\/\//.test(r.homepage)) result.leads.push(r.homepage);
    }

    // Activity pattern -> schedule hint.
    const times = [...(events ?? []).map((e) => e.created_at), ...commitDates];
    if (times.length >= 15) {
      const hours = new Array(24).fill(0) as number[];
      for (const t of times) hours[new Date(t).getUTCHours()]++;
      const win = (len: number, better: (a: number, b: number) => boolean, init: number) => {
        let best = 0, bestSum = init;
        for (let h = 0; h < 24; h++) {
          let s = 0;
          for (let k = 0; k < len; k++) s += hours[(h + k) % 24];
          if (better(s, bestSum)) { bestSum = s; best = h; }
        }
        return best;
      };
      const busy = win(4, (a, b) => a > b, -1);
      const quiet = win(6, (a, b) => a < b, Infinity);
      const fmt = (h: number) => `${String(h).padStart(2, "0")}:00`;
      add({ category: "schedule", label: "Activity pattern from public GitHub timestamps", value: `Most active ${fmt(busy)}–${fmt((busy + 4) % 24)} UTC; usually inactive ${fmt(quiet)}–${fmt((quiet + 6) % 24)} UTC`, sourceType: "github", sourceUrl: profileUrl, sourceTitle: `${times.length} public events/commits`, anchor: "github", confidence: 0.7, riskWeight: 4 });
    }

    // Text for the reader: profile README, repo descriptions/topics, gists, stars.
    const parts: string[] = [];
    if (readme) parts.push(`PROFILE README (github.com/${login}/${login}):\n${readme.slice(0, 8000)}`);
    if (own.length) parts.push("OWN REPOSITORIES:\n" + own.slice(0, 40).map((r) => `- ${r.name}: ${r.description ?? ""} [${r.language ?? ""}] ${r.topics?.length ? "topics: " + r.topics.join(", ") : ""} ${r.homepage ? "homepage: " + r.homepage : ""}`).join("\n"));
    if (gists?.length) parts.push("PUBLIC GISTS:\n" + gists.slice(0, 20).map((g) => `- ${g.description ?? ""} (${Object.keys(g.files).join(", ")})`).join("\n"));
    if (starred?.length) parts.push("STARRED REPOSITORIES (interests):\n" + starred.slice(0, 50).map((s) => `- ${s.full_name}: ${(s.description ?? "").slice(0, 100)} ${s.topics?.length ? "[" + s.topics.slice(0, 5).join(", ") + "]" : ""}`).join("\n"));
    if (parts.length) {
      result.doc = {
        url: profileUrl,
        title: `GitHub: ${login} (profile README, repositories, gists, stars)`,
        description: "Public GitHub data for the subject's own account. Everything here is tied to them (anchor github). Do not list technologies or starred projects as interests unless they reveal something personal (a school course, a club, a hometown, a specific hobby); at most 2 interests from this page.",
        text: parts.join("\n\n").slice(0, 18000),
        images: [],
        links: [],
        metaOnly: false,
      };
    }
  } catch (e) {
    await Promise.allSettled(pending);
    if (e instanceof RateLimited) emit({ type: "status", message: "GitHub rate limit reached; GitHub results may be partial" });
    else if (!signal.aborted) emit({ type: "status", message: "GitHub source failed; continuing with other sources" });
    else throw e;
  }
  await Promise.allSettled(pending);
  return result;
}
