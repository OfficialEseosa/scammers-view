"use client";

import { useState } from "react";
import { PlacesMap } from "@/features/places/PlacesMap";
import type { Finding } from "@/lib/types";

// Fictional person ("Sam Example"), real public places so geocoding is exercised.
const base = { sourceType: "web", anchor: "email", confidence: 0.9, riskWeight: 6, foundAt: "2026-01-01T00:00:00Z" } as const;
const FINDINGS: Finding[] = [
  { ...base, id: "f1", category: "location", label: "Hometown", value: "Leeds, United Kingdom", sourceUrl: "https://example.com/sam-bio", sourceTitle: "Sam's bio page" },
  { ...base, id: "f2", category: "school", label: "University", value: "University of Manchester", sourceType: "linkedin", sourceUrl: "https://example.com/in/sam-example", sourceTitle: "LinkedIn profile" },
  { ...base, id: "f3", category: "employer", label: "Internship", value: "Science Museum, London", sourceType: "linkedin", sourceUrl: "https://example.com/in/sam-example" },
  { ...base, id: "f4", category: "schedule", label: "Weekly run", value: "Runs at Hyde Park every Tuesday 6pm", sourceType: "instagram", sourceUrl: "https://example.com/sam.runs/p/1", snippet: "Tuesday 6pm laps, same as always" },
  { ...base, id: "f5", category: "schedule", label: "Climbing night", value: "Climbing at Brighton Pier every Friday 7pm", sourceType: "instagram", sourceUrl: "https://example.com/sam.runs/p/2" },
  { ...base, id: "f6", category: "photo", label: "Photo taken at", value: "Photo taken at Edinburgh Castle", sourceType: "instagram", sourceUrl: "javascript:alert(1)" },
];

export default function Page() {
  const [masked, setMasked] = useState(false);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Places map lab</h1>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-5" checked={masked} onChange={(e) => setMasked(e.target.checked)} />
          Masked (projector) mode
        </label>
      </div>
      <PlacesMap findings={FINDINGS} masked={masked} />
    </main>
  );
}
