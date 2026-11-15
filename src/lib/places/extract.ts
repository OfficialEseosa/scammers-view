import type { Finding, SourceType } from "@/lib/types";
import type { GeocodedPlace, PlaceCandidate, PlaceKind } from "./types";

/**
 * Rule-based place extraction. Nothing here invents a place: every candidate
 * is a finding whose category, label or value clearly names one.
 */

/** The geocode route takes at most 12 per request; we never ask for more than this in total. */
export const MAX_PLACES = 16;

const DAYS = "mon|tue|wed|thu|fri|sat|sun";
// Day names with their common long and short forms: "Tue", "Tues", "Tuesday(s)", "thurs".
const DAY_WORD = `(?:${DAYS})(?:s|sday|nesday|rsday|rs|urday|day|day?s)?`;
const DAY_RE = new RegExp(`\\b(${DAYS})(?:s|sday|nesday|rsday|rs|urday|day)?s?\\b`, "gi");
const TIME_RE = /\b(\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}:\d{2})\b/i;
const PLACE_WORDS =
  /\b(gym|fitness|cafe|café|coffee|park|trail|church|mosque|temple|synagogue|club|pub|bar|restaurant|library|campus|office|studio|stadium|arena|pool|track|market|station|airport|venue|hall|centre|center|museum|beach|pier|castle|cathedral|square|bridge|tower|garden|gardens|zoo|theatre|theater|cinema|mall|school|college|university|academy|hospital|lake|harbour|harbor|bay|hill)\b/i;
const EVENT_WORDS = /\b(event|race|marathon|parkrun|meet|meetup|conference|concert|festival|match|game|tournament|gig|show|fair|expo|hackathon)\b/i;
const VISIT_WORDS = /\b(visit(?:ed|ing)?|trip|travel(?:led|ed|ling)?|holiday|vacation|went to|been to)\b/i;
/** A label that says "this is a place" on a non-location finding (Gemini photo facts use these). */
const PLACE_LABEL = /\b(place|landmark|location|venue|spot|taken at|checked in|check-in|tagged at|where|street|neighbou?rhood|city|town|corner|sign)\b/i;
/** Facts from a photo or video that point at home: snapped to the city, never pinned. */
const HOME_HINT = /\b(home|house|front door|doorstep|driveway|garden gate|bedroom|my street|our street|flat|apartment)\b/i;
/** Looks like a street address with a house number: always treated as a home area. */
const ADDRESS_RE =
  /\b\d{1,5}[a-z]?,?\s+(?:[A-Z][\w'.-]*\s+){1,3}(street|st|road|rd|avenue|ave|lane|ln|drive|dr|close|way|court|ct|place|pl|crescent|terrace|boulevard|blvd|grove|gardens)\b/i;

/** Clothing and badges reveal a school or team but do not name a findable place. */
const NOT_A_PLACE = /\b(shirt|t-shirt|jersey|hoodie|uniform|badge|lanyard|kit|team)\b/i;

const FULL_DAYS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};
const DAY_KEYS = Object.keys(FULL_DAYS);

export interface ScheduleHint {
  /** First day named, e.g. "Tuesday". */
  day?: string;
  /** Every day named, in week order. */
  days: string[];
  time?: string;
  /** Sort key: day-of-week * 24 + hour (Monday first). */
  order: number;
}

export function parseSchedule(text: string): ScheduleHint | null {
  const days = [...new Set([...text.matchAll(DAY_RE)].map((m) => m[1].slice(0, 3).toLowerCase()))]
    .filter((k) => k in FULL_DAYS)
    .sort((a, b) => DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b));
  const t = text.match(TIME_RE);
  if (!days.length && !t) return null;
  const dayIdx = days.length ? DAY_KEYS.indexOf(days[0]) : 7;
  let hour = 0;
  let time = t?.[1].replace(/\s/g, "").toLowerCase();
  if (time) {
    const m = time.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
    if (m) {
      hour = Number(m[1]);
      const ap = m[3];
      if (ap) hour = (hour % 12) + (ap === "pm" ? 12 : 0);
      if (hour > 23) time = undefined;
    }
  }
  return { day: days[0] ? FULL_DAYS[days[0]] : undefined, days: days.map((d) => FULL_DAYS[d]), time, order: dayIdx * 24 + hour };
}

/** "Tuesdays and Thursdays, 7am" / "Fridays" / "7pm". Null when the text has no day or time. */
export function scheduleLabel(h: ScheduleHint | null): string | null {
  if (!h) return null;
  const days = h.days.map((d) => `${d}s`);
  const dayPart = days.length > 2 ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}` : days.join(" and ");
  return [dayPart, h.time].filter(Boolean).join(", ") || null;
}

/** Text after "at", "@", "in"... : "Software intern at Acme, London" -> "Acme, London". */
function afterAt(value: string): string {
  const m = value.match(/\b(?:at|@|in|near|outside)\s+([A-Z0-9].+)/);
  return m ? m[1] : value;
}

/** Pull the place out of a free-text value like "Runs at Riverside Park every Tuesday 6pm". */
function cleanQuery(value: string): string {
  let q = afterAt(value.trim());
  q = q.replace(/^(?:photo|picture|selfie|post)\s+(?:taken|posted)?\s*(?:at|in)?\s*/i, "");
  q = q.replace(/\b(?:every|each|on|from|until)\b.*$/i, "");
  q = q.replace(new RegExp(`(?:,|\\b)\\s*${DAY_WORD}\\b.*$`, "i"), "");
  q = q.replace(TIME_RE, "").replace(/#\d+/g, "").replace(/\([^)]*\)/g, "");
  return q.replace(/\s{2,}/g, " ").replace(/[\s,;:.+&-]+$/, "").trim().slice(0, 160);
}

/** True for facts Gemini read from the user's own photo or video. */
export function fromMedia(f: Finding): "photo" | "video" | null {
  if (f.id.startsWith("gphoto-") || /^Seen in your photo/i.test(f.snippet ?? "")) return "photo";
  if (f.id.startsWith("gvideo-") || /in your video:/i.test(f.snippet ?? "")) return "video";
  return null;
}

function kindFor(f: Finding): PlaceKind | null {
  const text = `${f.label} ${f.value}`;
  const media = fromMedia(f);
  if (ADDRESS_RE.test(f.value) && !/\band\b|&/i.test(f.value)) return "home_area";
  switch (f.category) {
    case "school":
      return media && NOT_A_PLACE.test(f.label) ? null : "school";
    case "employer":
      return media && NOT_A_PLACE.test(f.label) ? null : "work";
    case "location":
      if (media) return HOME_HINT.test(text) ? "home_area" : "photo";
      if (VISIT_WORDS.test(text)) return "other";
      if (EVENT_WORDS.test(text)) return "event";
      return PLACE_WORDS.test(f.value) ? "hangout" : "home_area";
    case "schedule":
      if (EVENT_WORDS.test(text)) return "event";
      if (VISIT_WORDS.test(text) && !parseSchedule(text)) return "other";
      return "hangout";
    case "photo":
    case "interest":
    case "other":
    case "handle":
    case "video":
      if (media && HOME_HINT.test(text) && PLACE_LABEL.test(f.label)) return "home_area";
      if (PLACE_LABEL.test(f.label) || /\b(taken at|checked in|tagged at)\b/i.test(f.value) || PLACE_WORDS.test(f.value)) {
        if (EVENT_WORDS.test(text)) return "event";
        return media || f.category === "photo" ? "photo" : "other";
      }
      return null;
    default:
      return null;
  }
}

function queryFor(f: Finding, kind: PlaceKind): string {
  if (kind === "home_area") return f.value.trim().slice(0, 160);
  if (kind === "school" || kind === "work") return afterAt(f.value.trim()).replace(/#\d+/g, "").trim().slice(0, 160);
  return cleanQuery(f.value);
}

/**
 * Generic phrases are not worth a geocode ("the gym", "Birthday celebration").
 * A venue query needs a proper name: a place word, a later capitalised word, or a comma-separated area.
 */
function specific(q: string, kind: PlaceKind): boolean {
  if (q.length < 3 || !/[A-Za-z]{3}/.test(q)) return false;
  if (kind === "home_area" || kind === "school" || kind === "work") return true;
  if (!/^[A-Z0-9]/.test(q)) return false;
  return PLACE_WORDS.test(q) || / [A-Z0-9]/.test(q) || q.includes(",");
}


const RANK: Record<PlaceKind, number> = { home_area: 0, school: 1, work: 2, hangout: 3, event: 4, photo: 5, other: 6 };

const US_STATES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming";
const US_ABBR = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const COUNTRY_HINTS: [string, RegExp][] = [
  ["us", new RegExp(`\\b(united states|usa|u\\.s\\.a?\\.?|${US_STATES})\\b`, "i")],
  // State abbreviations only in capitals after a comma ("Atlanta, GA"), so ", or" / ", in" never count.
  ["us", new RegExp(`,\\s*(${US_ABBR})\\b`)],
  ["gb", /\b(united kingdom|uk|england|scotland|wales|northern ireland|great britain)\b/i],
  ["ca", /\b(canada|ontario|quebec|british columbia|alberta)\b/i],
  ["au", /\b(australia|new south wales|queensland)\b/i],
  ["ie", /\b(ireland|dublin)\b/i],
  ["in", /\b(india)\b/i],
  ["ng", /\b(nigeria|lagos)\b/i],
  ["nz", /\b(new zealand)\b/i],
  ["de", /\b(germany|deutschland)\b/i],
  ["fr", /\b(france)\b/i],
];

/**
 * The country the findings point at (ISO alpha-2, lower case), from location-ish
 * findings only. Undefined when nothing clear: the server then biases to "us".
 */
export function regionHint(findings: Finding[]): string | undefined {
  const votes = new Map<string, number>();
  for (const f of findings) {
    if (f.category !== "location" && f.category !== "school" && f.category !== "employer" && f.category !== "schedule") continue;
    const text = f.value;
    for (const [cc, re] of COUNTRY_HINTS) if (re.test(text)) votes.set(cc, (votes.get(cc) ?? 0) + (f.category === "location" ? 2 : 1));
  }
  let best: string | undefined;
  let n = 0;
  for (const [cc, v] of votes) if (v > n) [best, n] = [cc, v];
  return best;
}

export function extractPlaces(findings: Finding[]): PlaceCandidate[] {
  const region = regionHint(findings);
  const raw: (PlaceCandidate & { risk: number; timed: boolean })[] = [];
  for (const f of findings) {
    const kind = kindFor(f);
    if (!kind) continue;
    const query = queryFor(f, kind);
    if (!specific(query, kind)) continue;
    raw.push({ findingId: f.id, query, kind, risk: f.riskWeight, timed: !!parseSchedule(`${f.value} ${f.snippet ?? ""}`) });
  }
  // Best first: by kind, then the one with a time (it says more), then risk.
  raw.sort((a, b) => RANK[a.kind] - RANK[b.kind] || Number(b.timed) - Number(a.timed) || b.risk - a.risk);
  const out: PlaceCandidate[] = [];
  const seen = new Set<string>();
  let homes = 0;
  for (const c of raw) {
    const key = c.query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    // One home area is the point; several just repeat the same city.
    if (c.kind === "home_area" && homes++ >= 2) continue;
    seen.add(key);
    out.push({ findingId: c.findingId, query: c.query, kind: c.kind, ...(region ? { region } : {}) });
    if (out.length >= MAX_PLACES) break;
  }
  return out;
}

export const KIND_LABEL: Record<PlaceKind, string> = {
  home_area: "Home area",
  school: "School",
  work: "Workplace",
  hangout: "Regular spot",
  event: "Event",
  photo: "Photo spot",
  other: "Place",
};

const SOURCE_NAME: Record<SourceType, string> = {
  web: "the web", github: "GitHub", linkedin: "LinkedIn", instagram: "Instagram", x: "X", tiktok: "TikTok",
  bluesky: "Bluesky", school: "a school site", broker: "a people-search site", personal_site: "your site",
  news: "a news site", other: "the web",
};

/** Short "where it came from" label. */
export function sourceName(f: Finding): string {
  const media = fromMedia(f);
  const base = SOURCE_NAME[f.sourceType] ?? "the web";
  if (media) return f.sourceType === "web" || f.sourceType === "other" ? `Your ${media}` : `Your ${media} on ${base}`;
  return base;
}

/** One plain sentence on why this pin helps a scammer. */
export function whyItMatters(f: Finding, kind: PlaceKind): string {
  const hint = parseSchedule(`${f.value} ${f.snippet ?? ""}`);
  if (hint && kind !== "home_area") {
    const days = scheduleLabel({ ...hint, time: undefined });
    const when = [days ? `on ${days}` : "", hint.time ? `at ${hint.time}` : ""].filter(Boolean).join(" ");
    return `A stranger knows where you'll be ${when}. Easy to time a call or a visit.`;
  }
  switch (kind) {
    case "home_area":
      return "Lets a caller sound local and narrows the search for your address.";
    case "school":
      return "Makes a fake campus IT or student-loan message believable.";
    case "work":
      return "Gives a believable boss or HR pretext and a target for fake invoices.";
    case "hangout":
      return "Reveals a habit. A stranger can guess when you're out.";
    case "event":
      return "A dated, public plan. Easy to pose as the organiser or a ticket seller.";
    case "photo":
      return "Your photo shows where you were. Pair it with the post date and they have a when.";
    default:
      return "A real place tied to you makes a fake story feel personal.";
  }
}

/** The one fix this data supports, or null. Short imperative, sentence case. */
export function fixFor(f: Finding, kind: PlaceKind): string | null {
  const media = fromMedia(f);
  const social = f.sourceType === "instagram" || f.sourceType === "x" || f.sourceType === "tiktok" || f.sourceType === "bluesky";
  if (f.sourceType === "broker") return "Opt out of the people-search site";
  if (media === "video") return "Trim or delete the video";
  if (media === "photo") return /\bsign|street|corner\b/i.test(`${f.label} ${f.value}`) ? "Crop street signs out of photos" : "Remove location from the photo";
  if (f.category === "photo") return /tagged/i.test(`${f.label} ${f.value}`) ? "Hide tagged photos" : "Remove location from the photo";
  if (parseSchedule(`${f.value} ${f.snippet ?? ""}`) && social) return "Post after you leave, not before";
  if (kind === "event" && social) return "Make event posts friends-only";
  if (kind === "home_area" && (social || f.sourceType === "personal_site" || /\bbio\b/i.test(`${f.label} ${f.sourceTitle ?? ""}`)))
    return "Remove location from bio";
  if ((kind === "school" || kind === "work") && f.sourceType === "linkedin") return "Limit who sees your LinkedIn";
  if ((kind === "school" || kind === "work") && social) return `Remove ${kind === "school" ? "school" : "workplace"} from bio`;
  return null;
}

/* ---------------- the tour ---------------- */

export type StopStatus = "pending" | "found" | "missing";

export interface TourStop {
  id: string;
  kind: PlaceKind;
  finding: Finding;
  /** The place as named in the finding (the geocode query), e.g. "Hyde Park". */
  name: string;
  status: StopStatus;
  place?: GeocodedPlace;
  /** Rendered coordinates (jittered in masked mode). */
  lat?: number;
  lng?: number;
  schedule: ScheduleHint | null;
  when: string | null;
  why: string;
  fix: string | null;
  source: string;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const DUPLICATE_RADIUS_M = 1000;
const PRECISION_SCORE = { venue: 2, area: 1, city: 0 } as const;

/** Higher is better-sourced: a confident finding, an exact venue, a known time, then risk. */
function sourceScore(s: TourStop): number {
  return (
    s.finding.confidence * 100 +
    (s.place ? PRECISION_SCORE[s.place.precision] * 10 : 0) +
    (s.schedule ? 5 : 0) +
    s.finding.riskWeight * 0.1
  );
}

function sameSpot(a: TourStop, b: TourStop): boolean {
  if (!a.place || !b.place) return false;
  // Identical Google place: one stop, unless both are only a whole town reached from different kinds
  // (a workplace found only as "Atlanta" is still a separate fact from the home area).
  if (a.place.placeId && a.place.placeId === b.place.placeId && (a.kind === b.kind || a.place.precision !== "city")) return true;
  // Real coordinates, not the masked jitter.
  return a.kind === b.kind && distanceM(a.place, b.place) <= DUPLICATE_RADIUS_M;
}

/**
 * One stop per real place: same kind within ~1 km, or the same Google place,
 * keeps only the better-sourced one. At most one home area. Stops still
 * geocoding are kept (they may yet resolve to somewhere new), except extra
 * home areas once one is found. Input order is preserved for the survivors.
 */
export function dedupeStops(stops: TourStop[]): TourStop[] {
  const drop = new Set<string>();
  const found = stops.filter((s) => s.status === "found");
  for (let i = 0; i < found.length; i++) {
    const a = found[i];
    if (drop.has(a.id)) continue;
    for (let j = i + 1; j < found.length; j++) {
      const b = found[j];
      if (drop.has(b.id) || !sameSpot(a, b)) continue;
      const loser = sourceScore(b) > sourceScore(a) ? a : b;
      drop.add(loser.id);
      if (loser === a) break;
    }
  }
  const homes = stops.filter((s) => s.kind === "home_area" && !drop.has(s.id));
  const foundHomes = homes.filter((s) => s.status === "found");
  const keepHome = foundHomes.length
    ? foundHomes.reduce((best, s) => (sourceScore(s) > sourceScore(best) ? s : best))
    : homes.find((s) => s.status === "pending") ?? homes[0];
  for (const h of homes) if (h !== keepHome) drop.add(h.id);
  return stops.filter((s) => !drop.has(s.id));
}

/** Home area, school, work, then the week's routine in day/time order, then everything else. */
export function buildTour(
  candidates: PlaceCandidate[],
  byId: Map<string, Finding>,
  places: Record<string, GeocodedPlace>,
  missing: Record<string, true>,
  masked: boolean,
): TourStop[] {
  const stops: TourStop[] = [];
  for (const c of candidates) {
    const f = byId.get(c.findingId);
    if (!f) continue;
    const p = places[c.findingId];
    const schedule = parseSchedule(`${f.value} ${f.snippet ?? ""}`);
    // Masked mode moves pins ~1-2 km in a stable direction so a projector shows no real spot.
    const j = masked ? { lat: (hash(c.findingId + "a") - 0.5) * 0.035, lng: (hash(c.findingId + "b") - 0.5) * 0.05 } : { lat: 0, lng: 0 };
    stops.push({
      id: c.findingId,
      kind: c.kind,
      finding: f,
      name: c.query,
      status: p ? "found" : missing[c.findingId] ? "missing" : "pending",
      place: p,
      lat: p ? p.lat + j.lat : undefined,
      lng: p ? p.lng + j.lng : undefined,
      schedule: c.kind === "home_area" ? null : schedule,
      when: c.kind === "home_area" ? null : scheduleLabel(schedule),
      why: whyItMatters(f, c.kind),
      fix: fixFor(f, c.kind),
      source: sourceName(f),
    });
  }
  const group = (s: TourStop) => (s.kind === "home_area" ? 0 : s.kind === "school" ? 1 : s.kind === "work" ? 2 : s.schedule ? 3 : 4);
  return dedupeStops(stops)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => group(a.s) - group(b.s) || (a.s.schedule?.order ?? 0) - (b.s.schedule?.order ?? 0) || RANK[a.s.kind] - RANK[b.s.kind] || a.i - b.i)
    .map(({ s }) => s);
}

export interface TourSummary {
  total: number;
  pinned: number;
  timed: number;
  venues: number;
  homeExposed: boolean;
  fixes: { text: string; stopIds: string[] }[];
}

export function summarise(stops: TourStop[]): TourSummary {
  const fixes = new Map<string, string[]>();
  for (const s of stops) if (s.fix && s.status !== "missing") fixes.set(s.fix, [...(fixes.get(s.fix) ?? []), s.id]);
  return {
    total: stops.length,
    pinned: stops.filter((s) => s.status === "found").length,
    timed: stops.filter((s) => s.when).length,
    venues: stops.filter((s) => s.place?.precision === "venue").length,
    homeExposed: stops.some((s) => s.kind === "home_area" && s.status !== "missing"),
    fixes: [...fixes].map(([text, stopIds]) => ({ text, stopIds })),
  };
}
