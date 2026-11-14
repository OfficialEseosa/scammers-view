import type { Finding } from "../types";

/** Two fictional scans of the same fictional person (Alex Rivera does not exist). */
const T1 = "2026-11-07T12:00:00.000Z";
const T2 = "2026-11-14T12:00:00.000Z";
const base = { anchor: "email" as const };

const f = (id: string, category: Finding["category"], label: string, value: string, sourceType: Finding["sourceType"], riskWeight: number, foundAt: string): Finding => ({
  ...base,
  id,
  category,
  label,
  value,
  sourceType,
  sourceUrl: "https://example.com/alex-rivera",
  confidence: 0.85,
  riskWeight,
  foundAt,
});

export const WATCH_SCAN_A: { score: number; findings: Finding[] } = {
  score: 78,
  findings: [
    f("a-dog", "pet", "Dog's name", "Biscuit", "instagram", 7, T1),
    f("a-bday", "birthday", "Birthday", "March 14, 1999", "instagram", 8, T1),
    f("a-school", "school", "High school", "Lakeview High School", "linkedin", 7, T1),
    f("a-email", "email", "Personal email", "alex.rivera@example.com", "github", 8, T1),
    f("a-phone", "phone", "Phone number", "(555) 010-4417", "broker", 9, T1),
    f("a-addr", "location", "Home address", "412 Elm Street, Maple Grove", "broker", 8, T1),
    f("a-handle", "handle", "Handle", "@alexr_designs", "x", 5, T1),
  ],
};

/** A week later: the phone listing and address are gone, a new employer and a new handle appeared. */
export const WATCH_SCAN_B: { score: number; findings: Finding[] } = {
  score: 61,
  findings: [
    f("b-dog", "pet", "Dog's name", "biscuit", "instagram", 7, T2),
    f("b-bday", "birthday", "Birthday", "March 14, 1999", "instagram", 8, T2),
    f("b-school", "school", "High school", "Lakeview High School", "linkedin", 7, T2),
    f("b-email", "email", "Personal email", "Alex.Rivera@example.com", "github", 8, T2),
    f("b-handle", "handle", "Handle", "alexr_designs", "x", 5, T2),
    f("b-employer", "employer", "Employer", "Northwind Labs", "linkedin", 4, T2),
    f("b-tiktok", "handle", "TikTok handle", "@alex.makes.things", "tiktok", 3, T2),
  ],
};
