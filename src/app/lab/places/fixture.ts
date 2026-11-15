import type { Finding } from "@/lib/types";

// Fictional people; real public places so geocoding is exercised. Nothing here is a real person's data.
const base = { sourceType: "web", anchor: "email", confidence: 0.9, riskWeight: 6, foundAt: "2026-01-01T00:00:00Z" } as const;

/** "Sam Example", UK. */
export const SAM: Finding[] = [
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

/** "Jordan Sample", Atlanta: two home-area mentions and one school named two ways (dedupe cases), venue-like routine spots. */
export const JORDAN: Finding[] = [
  { ...base, id: "j1", category: "location", label: "Location", value: "Atlanta, GA", sourceType: "x", sourceUrl: "https://example.com/jordan/bio", sourceTitle: "X bio" },
  { ...base, id: "j2", category: "location", label: "Lives in", value: "Atlanta, Georgia", sourceType: "broker", confidence: 0.7, sourceUrl: "https://example.com/people/jordan" },
  { ...base, id: "j3", category: "school", label: "University", value: "Georgia Institute of Technology", sourceType: "linkedin", sourceUrl: "https://example.com/in/jordan-sample" },
  { ...base, id: "j4", category: "school", label: "Alumni", value: "Georgia Tech", sourceType: "web", confidence: 0.6, sourceUrl: "https://example.com/alumni" },
  { ...base, id: "j5", category: "school", label: "High school", value: "Grady High School, Atlanta", sourceType: "web", sourceUrl: "https://example.com/hs/2019" },
  { ...base, id: "j6", category: "employer", label: "Work", value: "Analyst at Ponce City Market", sourceType: "linkedin", sourceUrl: "https://example.com/in/jordan-sample" },
  { ...base, id: "j7", category: "schedule", label: "Morning run", value: "Runs at Piedmont Park every Saturday 8am", sourceType: "instagram", sourceUrl: "https://example.com/jordan/p/1" },
  { ...base, id: "j8", category: "schedule", label: "Gym", value: "Lifting at Midtown Gym, Atlanta on Mondays 6pm", sourceType: "instagram", sourceUrl: "https://example.com/jordan/p/2" },
  { ...base, id: "j9", category: "schedule", label: "Club night", value: "Trivia at The Earl, East Atlanta every Wednesday 8pm", sourceType: "x", sourceUrl: "https://example.com/jordan/status/3" },
  { ...base, id: "j10", category: "interest", label: "Event", value: "Peachtree Road Race at Atlantic Station", sourceType: "web", sourceUrl: "https://example.com/results/ajc" },
];

export const NOWHERE: Finding[] = [{ ...base, id: "n1", category: "pet", label: "Dog's name", value: "Biscuit", sourceUrl: "https://example.com/p/4" }];
