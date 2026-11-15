"use client";

import { useState } from "react";
import { PlacesMap } from "@/features/places/PlacesMap";
import type { Finding } from "@/lib/types";

// Fictional person ("Sam Example"); real public places so geocoding is exercised.
const base = { sourceType: "web", anchor: "email", confidence: 0.9, riskWeight: 6, foundAt: "2026-01-01T00:00:00Z" } as const;
const SAM: Finding[] = [
  { ...base, id: "f1", category: "location", label: "Hometown", value: "Leeds, United Kingdom", sourceType: "instagram", sourceUrl: "https://example.com/sam-bio", sourceTitle: "Sam's Instagram bio" },
  { ...base, id: "f2", category: "school", label: "University", value: "University of Manchester", sourceType: "linkedin", sourceUrl: "https://example.com/in/sam-example", sourceTitle: "LinkedIn profile" },
  { ...base, id: "f3", category: "employer", label: "Internship", value: "Summer intern at Science Museum, London", sourceType: "linkedin", sourceUrl: "https://example.com/in/sam-example" },
  { ...base, id: "f4", category: "schedule", label: "Weekly run", value: "Runs at Hyde Park every Tuesday 6pm", sourceType: "instagram", sourceUrl: "https://example.com/sam.runs/p/1", snippet: "Tuesday 6pm laps, same as always" },
  { ...base, id: "f5", category: "schedule", label: "Climbing night", value: "Climbing at Brighton Pier every Friday 7pm", sourceType: "instagram", sourceUrl: "https://example.com/sam.runs/p/2" },
  { ...base, id: "f6", category: "schedule", label: "Sunday market", value: "Kirkgate Market, Leeds on Sundays 10am", sourceType: "x", sourceUrl: "https://example.com/sam/status/3" },
  { ...base, id: "f7", category: "interest", label: "Race", value: "Leeds Half Marathon at Roundhay Park", sourceType: "web", sourceUrl: "https://example.com/results/2026", sourceTitle: "Race results page" },
  { ...base, id: "f8", category: "photo", label: "Photo taken at", value: "Photo taken at Edinburgh Castle", sourceType: "instagram", sourceUrl: "javascript:alert(1)" },
  // Shaped like Gemini photo-context facts (category location, place/landmark labels).
  { ...base, id: "gphoto-a1", category: "location", label: "Landmark", value: "Angel of the North", sourceUrl: "https://example.com/p/9", snippet: "Seen in your photo: the steel sculpture behind you." },
  { ...base, id: "gphoto-a2", category: "location", label: "Place", value: "Sky Garden, London", sourceUrl: "https://example.com/p/10", snippet: "Seen in your photo: the glass dome and city view." },
  // Not places: must be ignored.
  { ...base, id: "n1", category: "pet", label: "Dog's name", value: "Biscuit", sourceUrl: "https://example.com/p/4" },
  { ...base, id: "n2", category: "schedule", label: "Party", value: "Birthday celebration", sourceUrl: "https://example.com/p/5" },
];

const NOWHERE: Finding[] = [{ ...base, id: "n1", category: "pet", label: "Dog's name", value: "Biscuit", sourceUrl: "https://example.com/p/4" }];

const SETS = { sam: SAM, empty: NOWHERE } as const;

export default function Page() {
  const [masked, setMasked] = useState(false);
  const [set, setSet] = useState<keyof typeof SETS>("sam");
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="sv-display text-[clamp(2rem,4vw,2.75rem)] leading-[1]">Where you can be found</h1>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex min-h-11 items-center gap-2">
            <select className="min-h-11 rounded-control border border-edge-strong bg-canvas px-3" value={set} onChange={(e) => setSet(e.target.value as keyof typeof SETS)}>
              <option value="sam">Sam (12 findings)</option>
              <option value="empty">No places</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="size-5" checked={masked} onChange={(e) => setMasked(e.target.checked)} />
            Masked
          </label>
        </div>
      </div>
      <PlacesMap findings={SETS[set]} masked={masked} />
    </main>
  );
}
