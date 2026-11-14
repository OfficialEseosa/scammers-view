import type { Finding } from "@/lib/types";
import type { Effort, FixLink, FixTemplate } from "./types";

/**
 * Link status ("confirmed" = checked against the service's own help page or docs):
 *  confirmed:     Instagram help 448523408565555, X help 20169930, LinkedIn help answer/261 (email visibility),
 *                 Venmo help 210413717, Cash App help 6548-profile-name, GitHub Settings > Emails (docs path)
 *  NOT confirmed: TikTok, Facebook (login walls), LinkedIn public-profile page, every data-broker
 *                 opt-out URL (bot-blocked, taken from third-party guides), the 2FA deep links.
 */

type Platform = {
  key: string;
  name: string;
  effort: Effort;
  link: string;
  linkConfirmed: boolean;
  extraLinks?: FixLink[];
  steps: string[];
  title: string;
};

const PLATFORMS: Record<string, Platform> = {
  instagram: {
    key: "instagram",
    name: "Instagram",
    title: "Make your Instagram private",
    effort: "1 min",
    link: "https://help.instagram.com/448523408565555",
    linkConfirmed: true,
    steps: [
      "Open Instagram and go to your profile.",
      "Tap the menu (top right), then Settings and privacy.",
      "Tap Account privacy.",
      "Turn on Private account and confirm with Switch to private.",
      "Remove any follower you don't know: Followers list, then Remove.",
    ],
  },
  linkedin: {
    key: "linkedin",
    name: "LinkedIn",
    title: "Hide your LinkedIn email and public profile",
    effort: "5 min",
    link: "https://www.linkedin.com/help/linkedin/answer/261",
    linkConfirmed: true,
    extraLinks: [
      { label: "Public profile settings", url: "https://www.linkedin.com/public-profile/settings", confirmed: false },
    ],
    steps: [
      "Open Settings & Privacy, then Visibility.",
      "Open Email visibility (\"Who can see or download your email address\") and choose only you or 1st-degree connections.",
      "Open Edit your public profile and switch off the sections a stranger doesn't need: education, employer history, location.",
      "Turn off discovery by email address and by phone number.",
    ],
  },
  github: {
    key: "github",
    name: "GitHub",
    title: "Keep your GitHub email private",
    effort: "5 min",
    link: "https://github.com/settings/emails",
    linkConfirmed: true,
    steps: [
      "Open Settings, then Emails (github.com/settings/emails).",
      "Tick Keep my email addresses private.",
      "Tick Block command line pushes that expose my email.",
      "Copy your noreply address (ID+username@users.noreply.github.com) from that page.",
      "On each computer run: git config --global user.email \"<your noreply address>\".",
    ],
  },
  x: {
    key: "x",
    name: "X",
    title: "Protect your posts on X",
    effort: "1 min",
    link: "https://help.x.com/articles/20169930?lang=en",
    linkConfirmed: true,
    steps: [
      "Open Settings and privacy, then Privacy and safety.",
      "Open Audience and tagging.",
      "Turn on Protect your posts.",
      "Under Discoverability and contacts, turn off finding you by email and phone number.",
    ],
  },
  tiktok: {
    key: "tiktok",
    name: "TikTok",
    title: "Make your TikTok private",
    effort: "1 min",
    link: "https://support.tiktok.com/en/account-and-privacy/account-privacy-settings/making-your-account-public-or-private",
    linkConfirmed: false,
    steps: [
      "Open TikTok, tap Profile, then the menu (top right).",
      "Tap Settings and privacy, then Privacy.",
      "Turn on Private account.",
      "In the same menu, turn off Suggest your account to others.",
    ],
  },
  facebook: {
    key: "facebook",
    name: "Facebook",
    title: "Lock down your Facebook audience",
    effort: "5 min",
    link: "https://www.facebook.com/privacy/checkup",
    linkConfirmed: false,
    steps: [
      "Search \"Privacy Checkup\" in Facebook, or open the link below.",
      "Under Who can see what you share, set birthday, hometown, school, employer and phone to Only me or Friends.",
      "Set Future posts to Friends.",
      "Use Limit past posts so older public posts become Friends-only.",
      "Turn off search engines linking to your profile.",
    ],
  },
  venmo: {
    key: "venmo",
    name: "Venmo",
    title: "Make Venmo payments private",
    effort: "1 min",
    link: "https://help.venmo.com/hc/en-us/articles/210413717-Transaction-Privacy-Settings",
    linkConfirmed: true,
    steps: [
      "Open the Venmo app and go to the Me tab.",
      "Tap the settings gear, then Privacy.",
      "Select Private.",
      "Tap the option to hide all past transactions.",
    ],
  },
  cashapp: {
    key: "cashapp",
    name: "Cash App",
    title: "Limit who can find you on Cash App",
    effort: "1 min",
    link: "https://cash.app/help/6548-profile-name",
    linkConfirmed: true,
    steps: [
      "Open Cash App and tap your profile icon.",
      "Open Security & Privacy.",
      "Narrow who can find you by name, phone number and email.",
      "Turn off sharing your contacts if it is on.",
    ],
  },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function platformOf(f: Finding): string | null {
  switch (f.sourceType) {
    case "instagram":
    case "linkedin":
    case "github":
    case "x":
    case "tiktok":
      return f.sourceType;
    default:
  }
  const h = hostOf(f.sourceUrl);
  if (h.endsWith("facebook.com") || h === "fb.com") return "facebook";
  if (h.endsWith("venmo.com")) return "venmo";
  if (h === "cash.app" || h.endsWith(".cash.app")) return "cashapp";
  if (h.endsWith("instagram.com")) return "instagram";
  if (h.endsWith("linkedin.com")) return "linkedin";
  if (h.endsWith("github.com")) return "github";
  if (h === "x.com" || h.endsWith("twitter.com")) return "x";
  if (h.endsWith("tiktok.com")) return "tiktok";
  return null;
}

/* ------------------------------ security questions ------------------------------ */

type QKind = "pet" | "school" | "birthday" | "hometown" | "maiden";

const Q_COPY: Record<QKind, { title: string; answer: string }> = {
  pet: { title: "Swap the security answer \"first pet's name\"", answer: "your pet's name" },
  school: { title: "Swap the security answer \"high school\"", answer: "your school" },
  birthday: { title: "Stop using your birthday as a recovery answer", answer: "your birthday" },
  hometown: { title: "Swap the security answer \"hometown\"", answer: "your hometown" },
  maiden: { title: "Swap the security answer \"mother's maiden name\"", answer: "a family name" },
};

export function questionKind(f: Finding): QKind | null {
  const text = `${f.label} ${f.value}`.toLowerCase();
  if (f.category === "pet") return "pet";
  if (f.category === "school") return "school";
  if (f.category === "birthday") return "birthday";
  if (f.category === "relative" && /maiden|mother/.test(text)) return "maiden";
  if (f.category === "location" && /hometown|born|grew|birth/.test(text)) return "hometown";
  return null;
}

/* ------------------------------ data brokers ------------------------------ */

type Broker = { name: string; optout: string };
const BROKERS: Record<string, Broker> = {
  "spokeo.com": { name: "Spokeo", optout: "https://www.spokeo.com/optout" },
  "whitepages.com": { name: "Whitepages", optout: "https://www.whitepages.com/suppression-requests" },
  "beenverified.com": { name: "BeenVerified", optout: "https://www.beenverified.com/app/optout/search" },
  "radaris.com": { name: "Radaris", optout: "https://radaris.com/control/privacy" },
  "truepeoplesearch.com": { name: "TruePeopleSearch", optout: "https://www.truepeoplesearch.com/removal" },
  "fastpeoplesearch.com": { name: "FastPeopleSearch", optout: "https://www.fastpeoplesearch.com/removal" },
};

function brokerFor(host: string): Broker {
  for (const [d, b] of Object.entries(BROKERS)) if (host === d || host.endsWith(`.${d}`)) return b;
  return { name: host || "this data broker", optout: "" };
}

/* ------------------------------ 2FA ------------------------------ */

function twoFactorSteps(findings: Finding[]): { steps: string[]; links: FixLink[] } {
  const steps: string[] = [];
  const links: FixLink[] = [];
  const seen = new Set<string>();
  const add = (key: string, step: string, link?: FixLink) => {
    if (seen.has(key)) return;
    seen.add(key);
    steps.push(step);
    if (link) links.push(link);
  };
  for (const f of findings) {
    if (f.category !== "email") continue;
    const dom = f.value.split("@")[1]?.toLowerCase() ?? "";
    if (/gmail|google/.test(dom))
      add("google", "Email (Google): turn on 2-Step Verification with an authenticator app or passkey, not SMS.", {
        label: "Google 2-Step Verification",
        url: "https://myaccount.google.com/signinoptions/two-step-verification",
        confirmed: false,
      });
    else if (/outlook|hotmail|live|msn/.test(dom))
      add("ms", "Email (Microsoft): open Security, then Advanced security options, and add an authenticator app.", {
        label: "Microsoft security",
        url: "https://account.microsoft.com/security",
        confirmed: false,
      });
    else if (/icloud|me\.com|mac\.com/.test(dom))
      add("apple", "Apple Account: confirm two-factor authentication is on and your trusted phone number is current.");
    else add("email", "Your email account: switch on 2-step sign-in with an authenticator app. Email is the master key to every password reset.");
  }
  const named = new Set(findings.map(platformOf).filter(Boolean) as string[]);
  if (named.has("github")) add("github", "GitHub: Settings, Password and authentication, add an authenticator app or passkey.");
  if (named.has("instagram")) add("instagram", "Instagram: Settings, Accounts Center, Password and security, Two-factor authentication, choose Authentication app.");
  if (named.has("linkedin")) add("linkedin", "LinkedIn: Settings, Sign in & security, Two-step verification, choose Authenticator app.");
  if (named.has("x")) add("x", "X: Settings, Security and account access, Security, Two-factor authentication, choose Authentication app.");
  if (named.has("facebook")) add("facebook", "Facebook: Accounts Center, Password and security, Two-factor authentication, choose Authentication app.");
  if (named.has("tiktok")) add("tiktok", "TikTok: Settings and privacy, Security & permissions, 2-step verification, choose Authenticator app.");
  if (named.has("venmo") || named.has("cashapp")) add("pay", "Payment apps: turn on the app's PIN or Face ID lock, and use an authenticator app where offered.");
  if (!steps.length) add("email", "Your email account: switch on 2-step sign-in with an authenticator app.");
  const out = steps.slice(0, 6);
  out.push("Save each service's backup codes in your password manager, not in your email.");
  return { steps: out, links };
}

/* ------------------------------ candidates ------------------------------ */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function labelsOf(fs: Finding[]): string {
  const l = [...new Set(fs.map((f) => f.label))];
  return l.length > 3 ? `${l.slice(0, 3).join(", ")} and ${l.length - 3} more` : l.join(", ");
}

/** Every fix this catalog can offer for a scan, before scoring. Scoring and ranking live in plan.ts. */
export function buildCandidates(findings: Finding[]): FixTemplate[] {
  const out: FixTemplate[] = [];

  const byPlatform = new Map<string, Finding[]>();
  for (const f of findings) {
    const p = platformOf(f);
    if (!p || !PLATFORMS[p]) continue;
    byPlatform.set(p, [...(byPlatform.get(p) ?? []), f]);
  }
  for (const [key, fs] of byPlatform) {
    const p = PLATFORMS[key];
    out.push({
      id: `fix:privacy:${key}`,
      kind: "privacy",
      title: p.title,
      why: `${p.name} is showing strangers: ${labelsOf(fs)}.`,
      steps: p.steps,
      link: p.link,
      linkConfirmed: p.linkConfirmed,
      extraLinks: p.extraLinks,
      removesFindingIds: fs.map((f) => f.id),
      effort: p.effort,
    });
  }

  const byQ = new Map<QKind, Finding[]>();
  for (const f of findings) {
    const q = questionKind(f);
    if (q) byQ.set(q, [...(byQ.get(q) ?? []), f]);
  }
  for (const [q, fs] of byQ) {
    const c = Q_COPY[q];
    out.push({
      id: `fix:question:${q}`,
      kind: "security-question",
      title: c.title,
      why: `Anyone can find ${c.answer} online, so it works as a password for any account that still asks.`,
      steps: [
        "List every account that still asks a security question: bank, email recovery, phone carrier, old forums.",
        "For each, change the answer to a random phrase. It does not have to be true.",
        "Store each answer in your password manager, next to that login.",
        "If the site lets you delete the question or add an authenticator app instead, do that.",
      ],
      removesFindingIds: fs.map((f) => f.id),
      effort: "5 min",
    });
  }

  const byBroker = new Map<string, Finding[]>();
  for (const f of findings) {
    if (f.sourceType !== "broker") continue;
    const h = hostOf(f.sourceUrl) || "broker";
    byBroker.set(h, [...(byBroker.get(h) ?? []), f]);
  }
  for (const [host, fs] of byBroker) {
    const b = brokerFor(host);
    const listing = fs[0].sourceUrl;
    out.push({
      id: `fix:broker:${slug(host)}`,
      kind: "broker",
      title: `Get removed from ${b.name}`,
      why: `${b.name} lists ${labelsOf(fs)}. People-search sites are where scammers fill in the blanks.`,
      steps: [
        `Open your ${b.name} listing (the page the scan found) and copy its address.`,
        b.optout
          ? `Open ${b.name}'s opt-out page and paste the listing address.`
          : "Find the Opt out, Remove my info or Privacy link in the site's footer.",
        "Confirm through the email or phone check they send. Use an email you don't mind them keeping.",
        "Or use Draft the removal email below and send it from your own mail app.",
        "Check again in two weeks. Listings come back.",
      ],
      link: b.optout || listing,
      linkConfirmed: false,
      extraLinks: b.optout ? [{ label: "Your listing", url: listing, confirmed: true }] : undefined,
      removesFindingIds: fs.map((f) => f.id),
      effort: "15 min",
      optout: { broker: b.name, listingUrl: listing, findingIds: fs.map((f) => f.id) },
    });
  }

  const handled = new Set<string>();
  for (const f of findings) if (platformOf(f) || f.sourceType === "broker") handled.add(f.id);
  const byHost = new Map<string, Finding[]>();
  for (const f of findings) {
    if (handled.has(f.id) || f.riskWeight < 3) continue;
    const h = hostOf(f.sourceUrl);
    if (!h) continue;
    byHost.set(h, [...(byHost.get(h) ?? []), f]);
  }
  for (const [host, fs] of byHost) {
    out.push({
      id: `fix:takedown:${slug(host)}`,
      kind: "takedown",
      title: `Ask ${host} to remove or hide it`,
      why: `${host} publishes ${labelsOf(fs)} about you.`,
      steps: [
        "Open the page the scan found and look for an Edit, Hide or Remove option if it's your profile.",
        "If there isn't one, find the site's contact or Privacy link and send a short removal request with the page address.",
        "Say exactly which details to remove and that you are the person they describe.",
        "Re-check in two weeks, and search your name to see if it was copied elsewhere.",
      ],
      link: fs[0].sourceUrl,
      linkConfirmed: true,
      removesFindingIds: fs.map((f) => f.id),
      effort: "15 min",
    });
  }

  const tf = twoFactorSteps(findings);
  out.push({
    id: "fix:2fa:checklist",
    kind: "2fa",
    title: "Turn on app-based 2FA",
    why: "Doesn't change what's public or the score. It stops a guessed answer or a stolen password from being enough to get in.",
    steps: tf.steps,
    link: tf.links[0]?.url,
    linkConfirmed: tf.links[0]?.confirmed,
    extraLinks: tf.links.slice(1),
    removesFindingIds: [],
    effort: "15 min",
  });

  return out;
}
