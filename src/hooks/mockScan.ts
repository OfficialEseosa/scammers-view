import type { Finding, ScanEvent, SourceType } from "@/lib/types";

/** Fictional demo data only. "Alex Rivera" is not a real person; all domains are example.com. */

export interface MockStep {
  at: number; // ms from start
  event: ScanEvent;
}

const T = "2026-01-01T12:00:00.000Z";

function f(
  id: string,
  category: Finding["category"],
  label: string,
  value: string,
  sourceType: SourceType,
  path: string,
  anchor: Finding["anchor"],
  confidence: number,
  riskWeight: number,
  snippet?: string,
): Finding {
  return {
    id,
    category,
    label,
    value,
    sourceType,
    sourceUrl: `https://example.com/${path}`,
    sourceTitle: `example.com/${path}`,
    snippet,
    anchor,
    confidence,
    riskWeight,
    foundAt: T,
  };
}

/** Hand-drawn SVG stand-ins for photos, so the demo never ships a real person's image. */
const svg = (body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">${body}</svg>`)}`;

const DOG_PHOTO = svg(
  `<rect width="160" height="120" fill="#86b6cc"/><rect y="82" width="160" height="38" fill="#e8d6a8"/>` +
    `<ellipse cx="88" cy="84" rx="34" ry="19" fill="#c98a4b"/><circle cx="58" cy="62" r="19" fill="#c98a4b"/>` +
    `<ellipse cx="46" cy="52" rx="7" ry="13" fill="#8a5a2b"/><circle cx="54" cy="59" r="2.8" fill="#1b1b1b"/>` +
    `<circle cx="42" cy="68" r="3.2" fill="#1b1b1b"/><rect x="64" y="96" width="8" height="16" fill="#c98a4b"/>` +
    `<rect x="102" y="96" width="8" height="16" fill="#c98a4b"/>`,
);
const PROFILE_PHOTO = svg(
  `<rect width="160" height="120" fill="#3d4a66"/><circle cx="80" cy="50" r="22" fill="#d9a77c"/>` +
    `<path d="M58 44q22-26 44 0v-8q-22-18-44 0z" fill="#3a2a1e"/><path d="M38 120q4-38 42-38t42 38z" fill="#6fd1c0"/>`,
);
const TEAM_PHOTO = svg(
  `<rect width="160" height="120" fill="#2b3a67"/><rect y="88" width="160" height="32" fill="#4c7a45"/>` +
    [24, 56, 88, 120].map((x, i) => `<circle cx="${x + 8}" cy="${52 + (i % 2) * 4}" r="11" fill="#d9a77c"/><rect x="${x - 4}" y="${64 + (i % 2) * 4}" width="24" height="30" rx="6" fill="#f1f1f1"/>`).join(""),
);

const findings: Finding[] = [
  f("f1", "email", "Personal email", "alex.rivera@example.com", "web", "contact", "email", 0.97, 6, "Contact: alex.rivera@example.com"),
  f("f2", "handle", "Username", "alexr_codes", "github", "alexr_codes", "github", 0.95, 4),
  f("f11", "photo", "Profile picture", "Profile photo on GitHub", "github", "alexr_codes.png", "github", 0.9, 3),
  f("f3", "school", "High school", "Lakeview High School", "linkedin", "in/alex-rivera", "email", 0.9, 7, "Lakeview High School, Class of 2021"),
  f("f4", "pet", "Dog's name", "Biscuit", "instagram", "p/biscuit-day", "email", 0.88, 9, "Biscuit's first day at the beach!"),
  f("f5", "birthday", "Birthday", "March 14", "x", "alexr/status/1", "unconfirmed", 0.62, 8, "Thanks for the birthday wishes on March 14!"),
  f("f6", "location", "Home area", "Riverside, California", "broker", "people/alex-rivera", "email", 0.8, 8),
  f("f7", "employer", "Employer", "Northwind Coffee Roasters", "linkedin", "in/alex-rivera#work", "email", 0.93, 5),
  f("f8", "relative", "Mother", "Sam Rivera", "broker", "people/alex-rivera/relatives", "unconfirmed", 0.55, 7),
  f("f12", "photo", "Team photo", "Tagged in a team photo", "instagram", "p/team-day", "email", 0.8, 4, "Saturday crew, same time next week"),
  f("f9", "schedule", "Weekly routine", "Runs at Fairmount Park, Riverside every Saturday 8am", "tiktok", "@alexr/video/2", "email", 0.7, 5),
  f("f10", "phone", "Phone number", "+1 555 010 0199", "broker", "people/alex-rivera/phone", "unconfirmed", 0.6, 9),
];
const photos: Record<string, string> = { f4: DOG_PHOTO, f11: PROFILE_PHOTO, f12: TEAM_PHOTO };
for (const fi of findings) if (photos[fi.id]) fi.imageUrl = photos[fi.id];

const chain: ScanEvent = {
  type: "chain",
  chain: {
    id: "c1",
    target: "Your email account",
    severity: 8.5,
    steps: [
      { id: "s1", title: "Learn your recovery answers", description: "Your dog's name and school are public, and both are common security questions.", findingIds: ["f3", "f4"], enables: "Answers to security questions" },
      { id: "s2", title: "Impersonate you to support", description: "With your birthday, area and email they can sound convincing on a support call.", findingIds: ["f1", "f5", "f6"], enables: "A password reset request" },
      { id: "s3", title: "Take over the account", description: "Reset the password, then reach every service that sends codes to that inbox.", findingIds: ["f1"], enables: "Access to your other accounts" },
    ],
  },
};

const chain2: ScanEvent = {
  type: "chain",
  chain: {
    id: "c2",
    target: "A message to your family",
    severity: 6,
    steps: [
      { id: "s1", title: "Find who you are close to", description: "Broker sites list a relative and your home area.", findingIds: ["f6", "f8"], enables: "A believable target" },
      { id: "s2", title: "Pretend to be you in trouble", description: "Using your routine and phone number, a scammer texts from a spoofed number asking for urgent help.", findingIds: ["f9", "f10"], enables: "A rushed payment" },
    ],
  },
};

const sources: SourceType[] = ["web", "github", "linkedin", "instagram", "x", "tiktok", "school", "broker", "personal_site", "news"];

export function buildMockTimeline(): MockStep[] {
  const steps: MockStep[] = [];
  const add = (at: number, event: ScanEvent) => steps.push({ at, event });

  add(200, { type: "status", message: "Preparing a search for you" });
  sources.forEach((s, i) => add(500 + i * 260, { type: "source_started", sourceType: s }));
  add(3200, { type: "status", message: "Reading public pages" });

  const findingTimes = findings.map((_, i) => 3600 + i * 1000); // ~1s apart so the map can settle between facts
  const counts: Partial<Record<SourceType, number>> = {};
  findings.forEach((fi, i) => {
    add(findingTimes[i], { type: "finding", finding: fi });
    counts[fi.sourceType] = (counts[fi.sourceType] ?? 0) + 1;
  });

  const doneAt = sources.map((_, i) => 4400 + i * 1150);
  sources.forEach((s, i) => add(doneAt[i], { type: "source_done", sourceType: s, count: counts[s] ?? 0 }));

  add(15000, { type: "status", message: "Working out how this could be used against you" });
  add(15800, {
    type: "score",
    score: {
      score: 74,
      topFindingIds: ["f4", "f10", "f5"],
      summary: "A scammer could answer your security questions and pose as you with what is already public.",
    },
  });
  add(16800, chain);
  add(18000, chain2);
  add(18800, { type: "done" });

  return steps.sort((a, b) => a.at - b.at);
}
