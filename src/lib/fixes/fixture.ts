import type { AttackChain, ExposureScore, Finding } from "@/lib/types";

/** Fictional scan for tests and the lab page. Alex Rivera does not exist. */
const T = "2026-11-13T12:00:00.000Z";
const base = { anchor: "email" as const, foundAt: T };

export const FIXTURE_FINDINGS: Finding[] = [
  { ...base, id: "f-dog", category: "pet", label: "Dog's name", value: "Biscuit", sourceType: "instagram", sourceUrl: "https://www.instagram.com/alexrivera.example/", confidence: 0.9, riskWeight: 7 },
  { ...base, id: "f-bday", category: "birthday", label: "Birthday", value: "March 14, 1999", sourceType: "instagram", sourceUrl: "https://www.instagram.com/alexrivera.example/", confidence: 0.85, riskWeight: 8 },
  { ...base, id: "f-photo", category: "photo", label: "Photo outside apartment", value: "Geotagged story highlight", sourceType: "instagram", sourceUrl: "https://www.instagram.com/alexrivera.example/", confidence: 0.7, riskWeight: 4 },
  { ...base, id: "f-school", category: "school", label: "High school", value: "Lakeview High School", sourceType: "linkedin", sourceUrl: "https://www.linkedin.com/in/alex-rivera-example", confidence: 0.9, riskWeight: 7 },
  { ...base, id: "f-employer", category: "employer", label: "Employer", value: "Northwind Labs", sourceType: "linkedin", sourceUrl: "https://www.linkedin.com/in/alex-rivera-example", confidence: 0.9, riskWeight: 4 },
  { ...base, id: "f-email", category: "email", label: "Personal email", value: "alex.rivera@example.com", sourceType: "github", sourceUrl: "https://github.com/alexrivera-example", anchor: "github", confidence: 0.95, riskWeight: 8 },
  { ...base, id: "f-hometown", category: "location", label: "Hometown", value: "Maple Grove, MN", sourceType: "web", sourceUrl: "https://www.facebook.com/alex.rivera.example", confidence: 0.8, riskWeight: 6 },
  { ...base, id: "f-handle", category: "handle", label: "Handle", value: "@alexr_designs", sourceType: "x", sourceUrl: "https://x.com/alexr_designs", confidence: 0.9, riskWeight: 5 },
  { ...base, id: "f-phone", category: "phone", label: "Phone number", value: "(555) 010-4417", sourceType: "broker", sourceUrl: "https://www.spokeo.com/Alex-Rivera/example", confidence: 0.8, riskWeight: 9 },
  { ...base, id: "f-addr", category: "location", label: "Home address", value: "412 Elm Street, Maple Grove", sourceType: "broker", sourceUrl: "https://www.spokeo.com/Alex-Rivera/example", confidence: 0.7, riskWeight: 8 },
  { ...base, id: "f-maiden", category: "relative", label: "Mother's maiden name", value: "Hale", sourceType: "broker", sourceUrl: "https://www.whitepages.com/name/Alex-Rivera/example", confidence: 0.6, riskWeight: 7 },
  { ...base, id: "f-venmo", category: "other", label: "Venmo payment feed", value: "Public payments with names", sourceType: "web", sourceUrl: "https://venmo.com/u/alex-rivera-example", confidence: 0.8, riskWeight: 5 },
];

export const FIXTURE_CHAINS: AttackChain[] = [
  {
    id: "c-email",
    target: "Personal email takeover",
    severity: 9,
    steps: [
      { id: "c-email-1", title: "Find the login email", description: "The email sits in public GitHub commits.", findingIds: ["f-email"], enables: "Start the reset flow" },
      { id: "c-email-2", title: "Answer the security questions", description: "Pet, school and hometown are all public.", findingIds: ["f-dog", "f-school", "f-hometown"], enables: "Pass the recovery check" },
      { id: "c-email-3", title: "Reset the password", description: "Birthday and phone confirm identity with support.", findingIds: ["f-bday", "f-phone"], enables: "Full account access" },
    ],
  },
  {
    id: "c-sim",
    target: "Phone number hijack",
    severity: 8,
    steps: [
      { id: "c-sim-1", title: "Collect identity details", description: "Phone and address are listed on people-search sites.", findingIds: ["f-phone", "f-addr"] },
      { id: "c-sim-2", title: "Pass carrier verification", description: "Birthday and maiden name answer the carrier's checks.", findingIds: ["f-bday", "f-maiden"], enables: "Port the number" },
    ],
  },
  {
    id: "c-work",
    target: "Coworker impersonation",
    severity: 5,
    steps: [
      { id: "c-work-1", title: "Name the employer", description: "LinkedIn and X show where and who.", findingIds: ["f-employer", "f-handle"] },
      { id: "c-work-2", title: "Borrow a face and a payment trail", description: "Photos and Venmo make a convincing request for money.", findingIds: ["f-photo", "f-venmo"], enables: "Message colleagues as Alex" },
    ],
  },
];

export const FIXTURE_SCORE: ExposureScore = {
  score: 78,
  topFindingIds: ["f-phone", "f-email", "f-bday"],
  summary: "Your recovery answers and phone number are public, and they line up into an email takeover.",
};
