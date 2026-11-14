import type { AttackChain, ExposureScore, Finding } from "@/lib/types";

/** Entirely fictional scan used by the lab page. No real person, places or domains. */

const svg = (body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${body}</svg>`,
  )}`;

const DOG = svg(
  `<rect width="120" height="120" fill="#7fb4c9"/><rect y="78" width="120" height="42" fill="#6a9a5b"/>` +
    `<ellipse cx="62" cy="80" rx="30" ry="18" fill="#c98a4b"/><circle cx="40" cy="58" r="17" fill="#c98a4b"/>` +
    `<ellipse cx="29" cy="50" rx="6" ry="12" fill="#8a5a2b"/><circle cx="36" cy="56" r="2.6" fill="#1b1b1b"/>` +
    `<circle cx="26" cy="63" r="3" fill="#1b1b1b"/><rect x="40" y="92" width="7" height="16" fill="#c98a4b"/>` +
    `<rect x="74" y="92" width="7" height="16" fill="#c98a4b"/>`,
);
const JERSEY = svg(
  `<rect width="120" height="120" fill="#2b3a67"/><path d="M30 30l18-10h24l18 10 14 22-16 8v44H32V60l-16-8z" fill="#f1f1f1"/>` +
    `<text x="60" y="84" font-family="Arial" font-weight="700" font-size="34" text-anchor="middle" fill="#2b3a67">23</text>`,
);
const CAKE = svg(
  `<rect width="120" height="120" fill="#f3d6e0"/><rect x="26" y="62" width="68" height="34" rx="6" fill="#fff"/>` +
    `<rect x="26" y="74" width="68" height="8" fill="#e6799d"/><rect x="57" y="40" width="6" height="22" fill="#7a9cf0"/>` +
    `<ellipse cx="60" cy="36" rx="4" ry="7" fill="#f2b441"/>`,
);

const at = (m: number) => new Date(Date.UTC(2026, 10, 13, 10, m)).toISOString();

export const MOCK_SUBJECT = "Alex Rivera";

export const MOCK_FINDINGS: Finding[] = [
  {
    id: "g1", category: "email", label: "Personal email", value: "alex.rivera.dev@example.com",
    sourceType: "github", sourceUrl: "https://github.example.com/arivera-codes", sourceTitle: "GitHub profile",
    snippet: "Public commit author email on 41 commits.", anchor: "github", confidence: 0.98, riskWeight: 8, foundAt: at(0),
  },
  {
    id: "g2", category: "handle", label: "Username used everywhere", value: "arivera-codes",
    sourceType: "github", sourceUrl: "https://github.example.com/arivera-codes", sourceTitle: "GitHub profile",
    anchor: "github", confidence: 0.97, riskWeight: 5, foundAt: at(1),
  },
  {
    id: "s1", category: "school", label: "School", value: "Lincoln Ridge High",
    sourceType: "school", sourceUrl: "https://lincolnridge.example.edu/news/robotics", sourceTitle: "Robotics team roster",
    snippet: "Congratulations to Alex Rivera and the robotics team on placing second.", anchor: "school", confidence: 0.92, riskWeight: 5, foundAt: at(2),
  },
  {
    id: "i1", category: "pet", label: "Dog’s name", value: "Biscuit", imageUrl: DOG,
    sourceType: "instagram", sourceUrl: "https://instagram.example.com/p/biscuit-day", sourceTitle: "Instagram post",
    snippet: "Happy 5th gotcha day to Biscuit, best boy in Maple Hollow", anchor: "face", confidence: 0.9, riskWeight: 9, foundAt: at(3),
  },
  {
    id: "s2", category: "email", label: "School email pattern", value: "first.last@lincolnridge.example.edu",
    sourceType: "school", sourceUrl: "https://lincolnridge.example.edu/staff-directory", sourceTitle: "Staff directory",
    anchor: "school", confidence: 0.85, riskWeight: 7, foundAt: at(4),
  },
  {
    id: "i2", category: "birthday", label: "Birthday", value: "March 14", imageUrl: CAKE,
    sourceType: "instagram", sourceUrl: "https://instagram.example.com/p/sweet-16", sourceTitle: "Instagram post",
    snippet: "16 candles on March 14!", anchor: "face", confidence: 0.88, riskWeight: 8, foundAt: at(5),
  },
  {
    id: "b1", category: "phone", label: "Mobile number", value: "(555) 014-2387",
    sourceType: "broker", sourceUrl: "https://peoplefinder.example.org/alex-rivera", sourceTitle: "People-search listing",
    anchor: "email", confidence: 0.81, riskWeight: 9, foundAt: at(6),
  },
  {
    id: "i3", category: "photo", label: "Team jersey", value: "Maple Hollow Otters #23", imageUrl: JERSEY,
    sourceType: "instagram", sourceUrl: "https://instagram.example.com/p/meet-day", sourceTitle: "Instagram post",
    anchor: "face", confidence: 0.86, riskWeight: 4, foundAt: at(7),
  },
  {
    id: "b2", category: "relative", label: "Mother", value: "Maria Rivera",
    sourceType: "broker", sourceUrl: "https://peoplefinder.example.org/alex-rivera", sourceTitle: "People-search listing",
    anchor: "email", confidence: 0.74, riskWeight: 8, foundAt: at(8),
  },
  {
    id: "l1", category: "employer", label: "Summer job", value: "Intern, Brightpath Labs",
    sourceType: "linkedin", sourceUrl: "https://linkedin.example.com/in/alex-rivera-dev", sourceTitle: "LinkedIn profile",
    anchor: "email", confidence: 0.9, riskWeight: 3, foundAt: at(9),
  },
  {
    id: "i4", category: "schedule", label: "Routine", value: "Swim practice Tue & Thu, 6pm",
    sourceType: "instagram", sourceUrl: "https://instagram.example.com/stories/highlights", sourceTitle: "Story highlight",
    anchor: "face", confidence: 0.77, riskWeight: 6, foundAt: at(10),
  },
  {
    id: "b3", category: "location", label: "Street", value: "Oak Terrace, Maple Hollow",
    sourceType: "broker", sourceUrl: "https://peoplefinder.example.org/alex-rivera", sourceTitle: "People-search listing",
    anchor: "email", confidence: 0.7, riskWeight: 7, foundAt: at(11),
  },
  {
    id: "w1", category: "interest", label: "Favourite band", value: "The Paper Lanterns",
    sourceType: "web", sourceUrl: "https://forum.example.net/u/arivera-codes", sourceTitle: "Music forum profile",
    anchor: "unconfirmed", confidence: 0.55, riskWeight: 3, foundAt: at(12),
  },
  {
    id: "s3", category: "other", label: "Graduating", value: "Class of 2027",
    sourceType: "school", sourceUrl: "https://lincolnridge.example.edu/news/honor-roll", sourceTitle: "Honor roll",
    anchor: "school", confidence: 0.83, riskWeight: 2, foundAt: at(13),
  },
];

export const MOCK_SCORE: ExposureScore = {
  score: 78,
  topFindingIds: ["b1", "i1", "i2"],
  summary: "Your phone number, dog’s name and birthday are enough to get into two of your accounts.",
};

export const MOCK_CHAINS: AttackChain[] = [
  {
    id: "c-school",
    target: "School email account",
    severity: 8,
    steps: [
      {
        id: "c-school-1", title: "Work out the address", findingIds: ["s1", "s2"],
        description: "The staff directory shows the first.last pattern, and the robotics roster confirms Alex goes there.",
        enables: "a login name to attack",
      },
      {
        id: "c-school-2", title: "Answer the security questions", findingIds: ["i1", "i2"],
        description: "“Name of your first pet?” Biscuit. “Date of birth?” March 14. Both are on Instagram.",
        enables: "a password reset",
      },
      {
        id: "c-school-3", title: "Reset the password", findingIds: ["g1"],
        description: "The reset link can also go to the personal address found on GitHub, so a fake “verify your account” email finishes the job.",
      },
    ],
  },
  {
    id: "c-bank",
    target: "Bank account",
    severity: 9,
    steps: [
      {
        id: "c-bank-1", title: "Call the carrier as Alex", findingIds: ["b1", "b2"],
        description: "With the mobile number and Mom’s name from a people-search site, a caller sounds like family.",
        enables: "a convincing phone story",
      },
      {
        id: "c-bank-2", title: "Pass identity checks", findingIds: ["i2", "b3"],
        description: "Birthday and street are the two questions carriers ask most often.",
        enables: "a SIM swap to the attacker’s phone",
      },
      {
        id: "c-bank-3", title: "Catch the one-time codes", findingIds: ["b1"],
        description: "Now texts for (555) 014-2387 land on the attacker’s phone, including the bank’s login codes.",
      },
    ],
  },
  {
    id: "c-insta",
    target: "Instagram account",
    severity: 6,
    steps: [
      {
        id: "c-insta-1", title: "Find the username", findingIds: ["g2"],
        description: "The same handle is used on GitHub, the forum and Instagram.",
      },
      {
        id: "c-insta-2", title: "Send a believable DM", findingIds: ["i4", "i3"],
        description: "A message at 6pm on Tuesday: “Otters team photos are up, log in to tag yourself.”",
        enables: "a login on a look-alike page",
      },
      {
        id: "c-insta-3", title: "Lock Alex out", findingIds: ["g1"],
        description: "With the password, the attacker changes the recovery email.",
      },
    ],
  },
];

/** The two facts whose removal breaks the most chains. */
export const MOCK_KEY_FACTS = ["i2", "b1"];
