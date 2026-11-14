import type { Finding } from "@/lib/types";

/** Obviously fictional findings for the quiz lab page ("Alex Rivera", example.com). */
const base = {
  sourceType: "personal_site" as const,
  anchor: "email" as const,
  confidence: 0.9,
  foundAt: "2026-01-01T00:00:00.000Z",
};

export const QUIZ_LAB_FINDINGS: Finding[] = [
  { ...base, id: "lab-school", category: "school", label: "School", value: "Northgate College", sourceUrl: "https://alex.example/about", riskWeight: 8 },
  { ...base, id: "lab-pet", category: "pet", label: "Dog's name", value: "Biscuit", sourceUrl: "https://alex.example/photos", riskWeight: 6 },
  { ...base, id: "lab-employer", category: "employer", label: "Employer", value: "Harbor Coffee Roasters", sourceUrl: "https://alex.example/work", riskWeight: 7 },
  { ...base, id: "lab-handle", category: "handle", label: "Handle", value: "alexrivera_demo", sourceType: "x" as const, sourceUrl: "https://x.example/alexrivera_demo", riskWeight: 4 },
  { ...base, id: "lab-interest", category: "interest", label: "Interest", value: "Trail Running Club", sourceUrl: "https://alex.example/clubs", riskWeight: 3 },
];

export const QUIZ_LAB_SUBJECT_NAME = "Alex Rivera";
