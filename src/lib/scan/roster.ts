import type { Finding, ScanSubject, SourceType } from "@/lib/types";

/**
 * Fixed agent roster and query plans (deterministic, so runs are comparable).
 * Each agent is a set of searches run in parallel; each search is one worker.
 */

export interface AgentPlan {
  id: string;
  label: string;
  sourceType: SourceType;
  queries: { q: string; hint: string }[];
}

const q = (s: string) => `"${s}"`;

export function roundOnePlans(s: ScanSubject): AgentPlan[] {
  const name = q(s.name);
  const school = s.school ? ` ${q(s.school)}` : "";
  const user = s.email.split("@")[0];
  const login = s.githubLogin;
  const plans: AgentPlan[] = [
    {
      id: "general",
      label: "Web search: name, school, email",
      sourceType: "web",
      queries: [
        { q: `${name}${school}`, hint: "anything about them: personal site, resume, awards, hometown, employer" },
        { q: q(s.email), hint: "pages exposing this email address" },
        { q: `${name} ${q(user)}`, hint: "pages tying the name to the email username (handle reuse)" },
      ],
    },
    {
      id: "personal_site",
      label: "Personal sites, portfolios, Devpost",
      sourceType: "personal_site",
      queries: [
        { q: `${name} portfolio OR "about me" OR resume`, hint: "their own website, portfolio or CV" },
        { q: `${name} devpost OR hackathon`, hint: "Devpost profile, hackathon projects, team pages" },
      ],
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      sourceType: "linkedin",
      queries: [{ q: `${name}${school} site:linkedin.com`, hint: "their LinkedIn: employer, school, location, graduation year" }],
    },
    {
      id: "instagram",
      label: "Instagram",
      sourceType: "instagram",
      queries: [{ q: `${name}${school} instagram`, hint: "their Instagram handle and bio; pet names, hometown, teams in bio/captions" }],
    },
    {
      id: "tiktok",
      label: "TikTok",
      sourceType: "tiktok",
      queries: [{ q: `${name} tiktok`, hint: "their TikTok handle and bio" }],
    },
    {
      id: "x",
      label: "X / Twitter, Reddit",
      sourceType: "x",
      queries: [{ q: `${name} (site:x.com OR site:twitter.com OR site:reddit.com)`, hint: "their X/Twitter or Reddit handle and bio" }],
    },
    {
      id: "school",
      label: "School and club pages",
      sourceType: "school",
      queries: [
        { q: `${name}${school} club OR team OR roster`, hint: "club/team rosters, officer lists, sports positions, schedules" },
        { q: `${name} "dean's list" OR "honor roll" OR scholarship OR graduate`, hint: "honor rolls, scholarships, graduation programs (hometown, high school, year)" },
      ],
    },
    {
      id: "news",
      label: "News and articles",
      sourceType: "news",
      queries: [{ q: `${name}${school} news OR article OR interview`, hint: "news/student-newspaper articles naming them (hometown, family, achievements)" }],
    },
    {
      id: "personal",
      label: "Personal details: birthday, hometown, pets",
      sourceType: "web",
      // One folded query (live runs 2026-11-14: the three separate ones came back empty in every run).
      queries: [
        {
          q: `${name} (birthday OR "born in" OR "years old" OR hometown OR "grew up in" OR "high school" OR "class of" OR dog OR cat OR pet)`,
          hint: "birthday or age hints, hometown, high school and graduation year, pets' names (classic security-question answers)",
        },
      ],
    },
    {
      id: "payments",
      label: "Payment apps (search results only)",
      sourceType: "other",
      queries: [{ q: `${name} venmo OR "cash app" OR cashapp`, hint: "public Venmo / Cash App handles visible in result titles or snippets (never open those pages)" }],
    },
    {
      id: "broker",
      label: "People-search listings (snippets only)",
      sourceType: "broker",
      queries: [
        { q: `${name} age phone address`, hint: "people-search listings: age, city, phone fragments, listed relatives — only if the snippet fits the subject" },
      ],
    },
  ];
  if (login) {
    plans[0].queries.push({ q: `${q(login)} -site:github.com`, hint: "the GitHub login reused as a username on other sites" });
  }
  return plans;
}

const URLISH = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/** Follow-up searches seeded with confirmed anchors from round one. */
export function followUpPlans(s: ScanSubject, confirmed: Finding[], extra: { projects: string[]; orgs: string[] }): AgentPlan[] {
  const name = q(s.name);
  const handles = new Set<string>();
  const emails = new Set<string>();
  const orgs = new Set<string>(extra.orgs);
  for (const f of confirmed) {
    // (confirmed = anchored and confidence >= 0.6)
    if (f.category === "handle" && !URLISH.test(f.value)) {
      const h = f.value.replace(/^@/, "").trim();
      if (h && h.toLowerCase() !== (s.githubLogin ?? "").toLowerCase() && h.length >= 3) handles.add(h);
    }
    if (f.category === "email" && f.value.toLowerCase() !== s.email.toLowerCase()) emails.add(f.value.toLowerCase());
    if (f.category === "employer") orgs.add(f.value);
  }
  const plans: AgentPlan[] = [];
  // Folded into one OR query (separate per-handle searches were empty in every live run).
  const hl = [...handles].slice(0, 3);
  const hq = hl.length ? [{ q: hl.map(q).join(" OR "), hint: `other sites where the username(s) ${hl.join(", ")} are used by the subject` }] : [];
  if (hq.length) plans.push({ id: "follow_handles", label: "Follow-up: username reuse", sourceType: "other", queries: hq });
  const eq = [...emails].slice(0, 2).map((e) => ({ q: q(e), hint: "pages exposing this address" }));
  if (eq.length) plans.push({ id: "follow_emails", label: "Follow-up: other email addresses", sourceType: "web", queries: eq });
  const pl = extra.projects.slice(0, 3);
  const pq = pl.length ? [{ q: `(${pl.map(q).join(" OR ")}) ${s.githubLogin ? q(s.githubLogin) : name}`, hint: `where the projects ${pl.join(", ")} appear: Devpost, hackathon winner lists, demos, package registries (npm/PyPI)` }] : [];
  if (pq.length) plans.push({ id: "follow_projects", label: "Follow-up: projects and hackathons", sourceType: "personal_site", queries: pq });
  const oq = [...orgs].slice(0, 2).map((o) => ({ q: `${name} ${q(o)}`, hint: `team, roster or news pages at ${o} naming the subject: their role/title, team, manager's or teammates' names, schedule, photos` }));
  if (oq.length) plans.push({ id: "follow_orgs", label: "Follow-up: employers and organizations", sourceType: "school", queries: oq });
  const ident = s.githubLogin ? q(s.githubLogin) : name;
  plans.push({
    id: "follow_registries",
    label: "Follow-up: Devpost, package registries, Kaggle",
    sourceType: "web",
    queries: [
      { q: `${ident} (site:devpost.com OR site:npmjs.com OR site:pypi.org OR site:kaggle.com OR site:huggingface.co)`, hint: "profiles and projects under the same username on developer sites (Devpost team members, schools, photos)" },
    ],
  });
  plans.push({
    id: "follow_photos",
    label: "Follow-up: team, event and award photos",
    sourceType: "news",
    queries: [
      { q: `${name}${s.school ? " " + q(s.school) : ""} hackathon OR winners OR team OR award`, hint: "pages with team/event/award photos that name the subject; list them as pages to read" },
    ],
  });
  return plans;
}
