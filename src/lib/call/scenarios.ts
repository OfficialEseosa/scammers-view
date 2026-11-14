import type { Finding, FindingCategory } from "../types";
import { PATTERN_BY_ID, type PatternId } from "../campus/patterns";
import { pick } from "../voice/script";
import type { CallScenarioId } from "./schema";

export interface ScenarioDetail {
  findingId: string;
  label: string;
  value: string;
}

export interface CallScenario {
  id: CallScenarioId;
  patternId: PatternId;
  name: string;
  /** Who the scammer pretends to be, in the scammer's own words. */
  persona: string;
  /** Who the user plays on the call. */
  userRole: string;
  /** What the scammer is trying to get. Kept generic: never real payment details. */
  goal: string;
  /** A different story to switch to when the user pushes back. */
  pivot: string;
  redFlags: string[];
  action: string;
  details: ScenarioDetail[];
  /** True when the user is meant to ask for a family safe word. */
  safeWordExpected: boolean;
}

const MAX_DETAILS = 4;

/** Findings that fuel this pattern first (by weight), then the voicemail picker's usual favourites. */
function detailsFor(patternId: PatternId, findings: Finding[]): ScenarioDetail[] {
  const weight = new Map<FindingCategory, number>(PATTERN_BY_ID[patternId].fuel.map((f) => [f.category, f.weight]));
  const usable = findings.filter((f) => f.value.trim().length > 0 && f.value.length < 80 && f.category !== "photo" && f.category !== "video");
  const fuelled = usable
    .filter((f) => weight.has(f.category))
    .sort((a, b) => (weight.get(b.category) ?? 0) - (weight.get(a.category) ?? 0) || b.riskWeight - a.riskWeight);
  const seen = new Set<string>();
  const out: ScenarioDetail[] = [];
  for (const f of [...fuelled, ...pick(usable)]) {
    if (seen.has(f.id) || seen.has(f.category)) continue;
    seen.add(f.id);
    seen.add(f.category);
    out.push({ findingId: f.id, label: f.label, value: f.value.trim() });
    if (out.length >= MAX_DETAILS) break;
  }
  return out;
}

const valueOf = (details: ScenarioDetail[], findings: Finding[], cat: FindingCategory) => {
  const ids = new Set(details.map((d) => d.findingId));
  return findings.find((f) => f.category === cat && ids.has(f.id))?.value.trim();
};

export function buildScenario(id: CallScenarioId, findings: Finding[], subjectName: string): CallScenario {
  const first = subjectName.split(" ")[0] || "there";
  const base = (patternId: PatternId) => {
    const p = PATTERN_BY_ID[patternId];
    const details = detailsFor(patternId, findings);
    return { patternId, name: p.name, redFlags: p.redFlags, action: p.action, details };
  };

  if (id === "fake-recruiter") {
    const b = base("fake-recruiter");
    const school = valueOf(b.details, findings, "school");
    return {
      id,
      ...b,
      persona: `Jordan, a campus recruiter for a large firm, calling ${first} about an internship${school ? ` for ${school} students` : ""}`,
      userRole: `${first}, the student being recruited`,
      goal: "Get them to read out their Social Security number 'for the background check' today, before the offer expires.",
      pivot: "Say a professor recommended them and the hiring manager is waiting on the line, so it has to happen now.",
      safeWordExpected: false,
    };
  }

  if (id === "professor-gift-cards") {
    const b = base("professor-gift-cards");
    const employer = valueOf(b.details, findings, "employer");
    const school = valueOf(b.details, findings, "school");
    return {
      id,
      ...b,
      persona: `${first}'s ${employer ? `supervisor at ${employer}` : school ? `professor at ${school}` : "supervisor"}, calling from a new number`,
      userRole: `${first}, who works for or studies under this person`,
      goal: "Get them to buy gift cards for a 'surprise for the team' and read the card numbers back, promising to pay them back tonight.",
      pivot: "Say they are stuck in a meeting and cannot talk long, and that it is embarrassing to ask anyone else.",
      safeWordExpected: false,
    };
  }

  const b = base("family-voice-clone");
  const where = valueOf(b.details, findings, "location") ?? valueOf(b.details, findings, "school");
  return {
    id,
    ...b,
    persona: `${first}, calling their parent in a panic${where ? ` from near ${where}` : ""}, on a borrowed phone`,
    userRole: `${first}'s parent or close relative, getting a call that sounds like ${first}`,
    goal: "Get them to send money right away and keep it secret from the rest of the family.",
    pivot: "Hand the phone to a 'lawyer' who says it must be paid within the hour.",
    safeWordExpected: true,
  };
}

export const SCENARIO_LABEL: Record<CallScenarioId, string> = {
  "fake-recruiter": "Internship recruiter",
  "professor-gift-cards": "Boss needs gift cards",
  "family-voice-clone": "Family emergency (your voice)",
};
