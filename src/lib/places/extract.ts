import type { Finding } from "@/lib/types";
import type { PlaceCandidate, PlaceKind } from "./types";

const DAYS = "mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun";
const DAY_RE = new RegExp(`\b(${DAYS})(?:day|sday|nesday|rsday|urday)?s?\b`, "i");
const TIME_RE = /\b(\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}:\d{2})\b/i;
const PLACE_WORDS =
  /\b(gym|fitness|cafe|café|coffee|park|trail|church|mosque|temple|club|pub|bar|restaurant|library|campus|office|studio|stadium|pool|track|market|station|airport|venue|hall|centre|center|museum|beach)\b/i;
const FULL_DAYS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

export interface ScheduleHint {
  day?: string;
  time?: string;
  /** Sort key: day-of-week * 24 + hour. */
  order: number;
}

export function parseSchedule(text: string): ScheduleHint | null {
  const d = text.match(DAY_RE);
  const t = text.match(TIME_RE);
  if (!d && !t) return null;
  let day: string | undefined;
  let dayIdx = 0;
  if (d) {
    const key = d[1].slice(0, 3).toLowerCase();
    day = FULL_DAYS[key];
    dayIdx = Object.keys(FULL_DAYS).indexOf(key);
  }
  let hour = 0;
  const time = t?.[1].replace(/\s/g, "");
  if (time) {
    const m = time.match(/^(\d{1,2})(?::\d{2})?(am|pm)?$/i);
    if (m) {
      hour = Number(m[1]);
      const ap = m[2]?.toLowerCase();
      if (ap) hour = (hour % 12) + (ap === "pm" ? 12 : 0);
    }
  }
  return { day, time, order: dayIdx * 24 + hour };
}

/** Pull the place part out of a free-text value like "Runs at Riverside Park every Tuesday 6pm". */
function cleanQuery(value: string): string {
  let q = value.trim();
  const at = q.match(/\b(?:at|@|in|near|outside)\s+(.+)/i);
  if (at) q = at[1];
  q = q.replace(/\b(?:every|each|on)\b.*$/i, "");
  q = q.replace(new RegExp(`\b(?:${DAYS})\w*\b.*$`, "i"), "");
  q = q.replace(TIME_RE, "").replace(/\s{2,}/g, " ").replace(/[\s,;:.-]+$/, "").trim();
  return q.slice(0, 160);
}

function kindFor(f: Finding): PlaceKind | null {
  const text = `${f.label} ${f.value}`;
  switch (f.category) {
    case "school": return "school";
    case "employer": return "work";
    case "location":
      return PLACE_WORDS.test(text) ? "hangout" : "home_area";
    case "schedule":
      return /event|race|meet|conference|concert|match|game|tournament/i.test(text) ? "event" : "hangout";
    case "photo":
    case "interest":
    case "other":
    case "handle":
      return PLACE_WORDS.test(text) || /taken at|checked in|tagged/i.test(text) ? "other" : null;
    default:
      return null;
  }
}

export function extractPlaces(findings: Finding[]): PlaceCandidate[] {
  const out: PlaceCandidate[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const kind = kindFor(f);
    if (!kind) continue;
    const query = f.category === "schedule" || kind === "other" ? cleanQuery(f.value) : f.value.trim().slice(0, 160);
    if (query.length < 3) continue;
    const key = `${kind}:${query.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ findingId: f.id, query, kind });
  }
  return out;
}

export const KIND_LABEL: Record<PlaceKind, string> = {
  home_area: "Home area",
  school: "School",
  work: "Workplace",
  hangout: "Regular spot",
  event: "Event",
  other: "Place",
};

/** One plain sentence on why this pin helps a scammer. */
export function whyItMatters(f: Finding, kind: PlaceKind): string {
  const hint = parseSchedule(`${f.value} ${f.snippet ?? ""}`);
  if (hint && (hint.day || hint.time)) {
    const when = [hint.day ? `${hint.day}s` : "", hint.time ?? ""].filter(Boolean).join(" ");
    return `Knows where you'll be ${when}. Easy to time a call, a "delivery", or a visit.`;
  }
  switch (kind) {
    case "home_area":
      return "Lets a scammer sound local: \"I'm calling from your area\". Narrows the search for your address.";
    case "school":
      return "Pairs with your school email format to fake a campus IT or student-loan message.";
    case "work":
      return "Gives a believable boss or HR pretext, and a target for fake invoices.";
    case "hangout":
      return "Reveals a habit. A stranger can guess when you're out and unreachable.";
    case "event":
      return "A dated, public plan. Scammers use it to pose as organisers or ticket sellers.";
    default:
      return "A real place tied to you makes a fake story feel personal.";
  }
}
