import type { GeocodedPlace, PlaceCandidate, Precision } from "./types";

/**
 * Google geocoding, server side only, with GOOGLE_MAPS_SERVER_KEY (never the
 * browser key's env name: that one is shipped to clients). Geocoding API
 * first; Places Text Search (New) when the query names a venue and geocoding
 * only found the town around it.
 *
 * Home areas never leave here at better than city precision: they are snapped
 * to the locality's own centroid (or coarsened to a ~5 km grid), flagged
 * `approximate`, and carry no place_id.
 */

const GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";
const TEXT_SEARCH = "https://places.googleapis.com/v1/places:searchText";

export interface GComponent {
  long_name: string;
  short_name: string;
  types: string[];
}
export interface GGeocodeResult {
  formatted_address: string;
  place_id: string;
  types: string[];
  address_components: GComponent[];
  geometry: { location: { lat: number; lng: number }; location_type: "ROOFTOP" | "RANGE_INTERPOLATED" | "GEOMETRIC_CENTER" | "APPROXIMATE" };
}
interface GGeocodeResponse {
  status: string;
  results: GGeocodeResult[];
  error_message?: string;
}
export interface GPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
}

/** Thrown for anything but OK / ZERO_RESULTS, so the caller can fall back and not cache. */
export class GoogleError extends Error {}

const CITY_TYPES = ["locality", "postal_town", "administrative_area_level_1", "administrative_area_level_2", "administrative_area_level_3", "country", "colloquial_area"];
const AREA_TYPES = ["sublocality", "sublocality_level_1", "sublocality_level_2", "neighborhood", "postal_code", "route", "intersection", "political"];
const VENUE_TYPES = ["establishment", "point_of_interest", "premise", "subpremise", "street_address", "park", "natural_feature", "airport", "university", "school", "tourist_attraction", "transit_station"];

const has = (types: string[] | undefined, list: string[]) => !!types?.some((t) => list.includes(t));

/** Google `types` / `location_type` to our precision. */
export function precisionFromGoogle(types: string[] | undefined, locationType?: GGeocodeResult["geometry"]["location_type"]): Precision {
  if (has(types, VENUE_TYPES)) return "venue";
  if (has(types, CITY_TYPES)) return "city";
  if (has(types, AREA_TYPES)) return "area";
  if (locationType === "ROOFTOP" || locationType === "RANGE_INTERPOLATED") return "venue";
  return "area";
}

export function isCityResult(r: Pick<GGeocodeResult, "types">): boolean {
  return has(r.types, CITY_TYPES) && !has(r.types, VENUE_TYPES);
}

const comp = (r: GGeocodeResult, type: string) => r.address_components.find((c) => c.types.includes(type));

/** "Atlanta, Georgia, United States" from the components: never a street, number or postcode. */
export function cityLabel(r: GGeocodeResult): { city: string | null; label: string } {
  const city =
    comp(r, "locality") ?? comp(r, "postal_town") ?? comp(r, "sublocality") ?? comp(r, "administrative_area_level_3") ?? comp(r, "administrative_area_level_2");
  const admin = comp(r, "administrative_area_level_1");
  const country = comp(r, "country");
  const parts = [city?.long_name, admin?.long_name, country?.long_name].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  return { city: city?.long_name ?? null, label: parts.join(", ") || "Unknown area" };
}

/** ~5 km grid: used only when no locality centroid is available. */
export const coarsen = (v: number) => Math.round(v * 20) / 20;

/** The home-area rule applied to a geocode hit. `centroid` is the locality's own result when we looked it up. */
export function homeFromGeocode(findingId: string, first: GGeocodeResult, centroid: GGeocodeResult | null): GeocodedPlace {
  const base = isCityResult(first) ? first : centroid && isCityResult(centroid) ? centroid : null;
  const { label } = cityLabel(base ?? first);
  const loc = (base ?? first).geometry.location;
  return {
    findingId,
    lat: base ? loc.lat : coarsen(loc.lat),
    lng: base ? loc.lng : coarsen(loc.lng),
    displayName: label,
    precision: "city",
    approximate: true,
  };
}

function shortAddress(name: string | undefined, address: string | undefined): string {
  const parts = (address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (name && parts[0]?.toLowerCase() !== name.toLowerCase()) parts.unshift(name);
  return parts.slice(0, 3).join(", ") || name || "";
}

export function venueFromGeocode(findingId: string, r: GGeocodeResult): GeocodedPlace {
  return {
    findingId,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    displayName: shortAddress(undefined, r.formatted_address),
    precision: precisionFromGoogle(r.types, r.geometry.location_type),
    approximate: false,
    placeId: r.place_id,
  };
}

export function venueFromPlace(findingId: string, p: GPlace): GeocodedPlace | null {
  if (!p.location) return null;
  return {
    findingId,
    lat: p.location.latitude,
    lng: p.location.longitude,
    displayName: shortAddress(p.displayName?.text, p.formattedAddress),
    precision: precisionFromGoogle(p.types),
    approximate: false,
    placeId: p.id,
  };
}

async function geocodeRaw(key: string, address: string, region: string | undefined): Promise<GGeocodeResult[]> {
  const q = new URLSearchParams({ address, key, language: "en" });
  if (region) q.set("region", region);
  const res = await fetch(`${GEOCODE}?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new GoogleError(`geocode http ${res.status}`);
  const data = (await res.json()) as GGeocodeResponse;
  if (data.status === "ZERO_RESULTS") return [];
  if (data.status !== "OK") throw new GoogleError(`geocode ${data.status}`);
  return data.results;
}

async function textSearch(key: string, textQuery: string, region: string | undefined): Promise<GPlace | null> {
  const res = await fetch(TEXT_SEARCH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types",
    },
    body: JSON.stringify({ textQuery, languageCode: "en", pageSize: 1, ...(region ? { regionCode: region } : {}) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new GoogleError(`places http ${res.status}`);
  const data = (await res.json()) as { places?: GPlace[] };
  return data.places?.[0] ?? null;
}

/** Null on ZERO_RESULTS (the caller may try Nominatim); throws GoogleError on quota/auth/network trouble. */
export async function geocodeGoogle(c: PlaceCandidate, key: string): Promise<GeocodedPlace | null> {
  // Bias to the country the findings point at; "us" only when nothing better is known.
  const region = c.region ?? "us";

  if (c.kind === "home_area") {
    const hits = await geocodeRaw(key, c.query, region);
    const first = hits[0];
    if (!first) return null;
    if (isCityResult(first)) return homeFromGeocode(c.findingId, first, null);
    // A street or venue came back: look up its town on its own and use that centroid.
    const { label, city } = cityLabel(first);
    const centroid = city ? ((await geocodeRaw(key, label, region))[0] ?? null) : null;
    return homeFromGeocode(c.findingId, first, centroid);
  }

  const hits = await geocodeRaw(key, c.query, region);
  const best = hits[0] ? venueFromGeocode(c.findingId, hits[0]) : null;
  if (best?.precision === "venue") return best;
  // Geocoding found only the town (or nothing) for something that names a venue: ask Places.
  try {
    const p = await textSearch(key, c.query, region);
    const v = p ? venueFromPlace(c.findingId, p) : null;
    if (v && (!best || v.precision === "venue" || (best.precision === "city" && v.precision === "area"))) return v;
  } catch (e) {
    if (!best) throw e;
  }
  return best;
}
