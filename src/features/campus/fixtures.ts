import type { Finding } from "@/lib/types";

/** Obviously fictional findings for the campus lab ("Jordan Lee", Northgate College, example.com). */
const base = {
  sourceType: "personal_site" as const,
  anchor: "email" as const,
  confidence: 0.9,
  foundAt: "2026-01-01T00:00:00.000Z",
};

export const CAMPUS_LAB_SCHOOL = "Northgate College";

export const CAMPUS_LAB_FINDINGS: Finding[] = [
  { ...base, id: "c-school", category: "school", label: "School", value: "Northgate College", sourceUrl: "https://jordan.example/about", riskWeight: 8 },
  { ...base, id: "c-email", category: "email", label: "School email", value: "jordan.lee@northgate.example.edu", sourceUrl: "https://northgate.example.edu/directory", sourceType: "school", riskWeight: 7 },
  { ...base, id: "c-post", category: "interest", label: "Post", value: "Looking for a part-time job this semester, open to work", sourceType: "x", sourceUrl: "https://x.example/jordanlee_demo", riskWeight: 5 },
  { ...base, id: "c-employer", category: "employer", label: "Internship", value: "Summer intern, Harbor Analytics", sourceType: "linkedin", sourceUrl: "https://linkedin.example/in/jordanlee-demo", riskWeight: 7 },
  { ...base, id: "c-handle", category: "handle", label: "Handle", value: "jordanlee_demo", sourceType: "x", sourceUrl: "https://x.example/jordanlee_demo", riskWeight: 4 },
  { ...base, id: "c-sale", category: "other", label: "Listing", value: "Selling my organic chemistry textbook, DM me", sourceType: "web", sourceUrl: "https://market.example/listing/1234", riskWeight: 4 },
  { ...base, id: "c-mom", category: "relative", label: "Family", value: "Priya Lee (mother)", sourceType: "instagram", sourceUrl: "https://insta.example/p/abc", riskWeight: 6 },
  { ...base, id: "c-phone", category: "phone", label: "Phone", value: "+1 555 010 0199", sourceUrl: "https://jordan.example/contact", riskWeight: 7 },
];

export const CAMPUS_LAB_SCORE = 72;
