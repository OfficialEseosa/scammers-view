import type { CleanupTask } from "./types";

/*
 * Sites the cleanup agent knows. Brokers: how each takes removal requests. Settings: the
 * privacy switch the co-pilot flips in the student's own, already signed-in account.
 * Every site page can change; the agent reads the live page each step instead of relying
 * on fixed buttons, and hands over to the student when it is unsure.
 */

export interface BrokerSite {
  id: string;
  name: string;
  domain: string;
  /** "form": a removal page the agent fills in. "email": requests go to a privacy address. */
  method: "form" | "email";
  optoutUrl?: string;
  email?: string;
  /** What the site usually asks for, so the student knows before starting. */
  expects: ("listing link" | "email check" | "robot check" | "phone call")[];
}

export const BROKER_SITES: BrokerSite[] = [
  { id: "spokeo", name: "Spokeo", domain: "spokeo.com", method: "form", optoutUrl: "https://www.spokeo.com/optout", expects: ["listing link", "email check", "robot check"] },
  { id: "whitepages", name: "Whitepages", domain: "whitepages.com", method: "form", optoutUrl: "https://www.whitepages.com/suppression-requests", expects: ["listing link", "phone call"] },
  { id: "beenverified", name: "BeenVerified", domain: "beenverified.com", method: "form", optoutUrl: "https://www.beenverified.com/app/optout/search", expects: ["email check"] },
  { id: "radaris", name: "Radaris", domain: "radaris.com", method: "form", optoutUrl: "https://radaris.com/control/privacy", expects: ["listing link", "email check"] },
  { id: "truepeoplesearch", name: "TruePeopleSearch", domain: "truepeoplesearch.com", method: "form", optoutUrl: "https://www.truepeoplesearch.com/removal", expects: ["robot check", "email check"] },
  { id: "fastpeoplesearch", name: "FastPeopleSearch", domain: "fastpeoplesearch.com", method: "form", optoutUrl: "https://www.fastpeoplesearch.com/removal", expects: ["robot check", "email check"] },
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function brokerForUrl(url: string): BrokerSite | undefined {
  const h = hostOf(url);
  return BROKER_SITES.find((b) => h === b.domain || h.endsWith(`.${b.domain}`));
}

export function brokerTask(b: BrokerSite, listingUrl?: string): CleanupTask {
  return {
    id: `broker:${b.id}`,
    kind: "broker",
    site: b.name,
    startUrl: b.optoutUrl ?? `https://www.${b.domain}/`,
    hosts: [b.domain],
    goal:
      `Submit ${b.name}'s removal (opt-out) request for the student's own listing` +
      (listingUrl ? ` (their listing: ${listingUrl})` : "") +
      ". If the form asks for the listing link, paste it. If it asks to search, search by name and city/state, then pick the listing that matches the student's name and location. Done when the site says the request was received or a confirmation email was sent.",
  };
}

export interface SettingsSite {
  id: string;
  name: string;
  /** Platform key as used by the fix catalog. */
  platform: string;
  startUrl: string;
  hosts: string[];
  goal: string;
  /** Can be done in one click through the service's own API instead of the browser. */
  api?: "github";
}

export const SETTINGS_SITES: SettingsSite[] = [
  {
    id: "instagram-private",
    name: "Instagram",
    platform: "instagram",
    startUrl: "https://www.instagram.com/accounts/who_can_see_your_content/",
    hosts: ["instagram.com"],
    goal: "Turn on 'Private account' and confirm 'Switch to private'.",
  },
  {
    id: "linkedin-email",
    name: "LinkedIn",
    platform: "linkedin",
    startUrl: "https://www.linkedin.com/mypreferences/d/profile-email-visibility",
    hosts: ["linkedin.com"],
    goal: "Set who can see or download the email address to 'Only you' (or the most private option) and save.",
  },
  {
    id: "x-protect",
    name: "X",
    platform: "x",
    startUrl: "https://x.com/settings/audience_and_tagging",
    hosts: ["x.com", "twitter.com"],
    goal: "Turn on 'Protect your posts' and confirm.",
  },
  {
    id: "tiktok-private",
    name: "TikTok",
    platform: "tiktok",
    startUrl: "https://www.tiktok.com/setting/privacy",
    hosts: ["tiktok.com"],
    goal: "Turn on 'Private account' and confirm.",
  },
  {
    id: "github-email",
    name: "GitHub",
    platform: "github",
    startUrl: "https://github.com/settings/emails",
    hosts: ["github.com"],
    goal:
      "On github.com/settings/emails, turn ON both checkboxes: 'Keep my email addresses private' and 'Block command line pushes that expose my email'. If either is already on, leave it on. When both are on, you are done (the student will copy the noreply address themselves).",
    /** Optional PAT fallback in the UI; the extension agent is the primary path. */
    api: "github",
  },
];

export function settingsTask(s: SettingsSite): CleanupTask {
  return { id: `settings:${s.id}`, kind: "settings", site: s.name, startUrl: s.startUrl, hosts: s.hosts, goal: s.goal };
}

/**
 * Own-profile pages the scan found (job boards, project sites, …). The agent opens the
 * listing URL in the student's signed-in Chrome and helps edit or hide the public details.
 */
export interface ProfileSite {
  id: string;
  name: string;
  domain: string;
  goal: string;
}

export const PROFILE_SITES: ProfileSite[] = [
  {
    id: "wayup",
    name: "WayUp",
    domain: "wayup.com",
    goal:
      "On the student's WayUp profile page (they are already signed in), edit or hide public personal details such as employer, role, profile photo, and location. Use Edit profile / Privacy / Remove where available. Do not delete the whole account. Done when those details are no longer shown publicly on this page.",
  },
  {
    id: "devpost",
    name: "Devpost",
    domain: "devpost.com",
    goal:
      "On the student's Devpost project or profile page (they are already signed in), edit or unpublish so hackathon teammates / collaborators and other personal details are no longer public. Prefer Edit project, Manage team, or make private/unpublished. Do not delete the whole account. Done when the exposed teammate names and details are gone from public view on this page.",
  },
];

export function profileForUrl(url: string): ProfileSite | undefined {
  const h = hostOf(url);
  return PROFILE_SITES.find((p) => h === p.domain || h.endsWith(`.${p.domain}`));
}

/** Starts on the scan's listing URL; only that site's hosts are allowed. */
export function profileTask(s: ProfileSite, listingUrl: string): CleanupTask {
  return {
    id: `profile:${s.id}`,
    kind: "settings",
    site: s.name,
    startUrl: listingUrl,
    hosts: [s.domain],
    goal: s.goal,
  };
}

export function allowedUrl(url: string, hosts: string[]): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return hosts.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
