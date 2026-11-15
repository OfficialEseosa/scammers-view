import type { GeocodedPlace, PlaceCandidate, Precision } from "./types";

// Fallback geocoder (no key). Nominatim usage policy: max 1 req/s, identifying User-Agent, cache results.
// Caching lives in ./geocode.ts; this module only throttles and maps.
const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "ScammersViewHackathon/0.1 (privacy awareness demo)";
const MIN_GAP_MS = 1100;

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
}

const g = globalThis as unknown as {
  __svGeoChain?: Promise<unknown>;
  __svGeoLast?: number;
};

/** Serialises all upstream calls and spaces them >= 1.1s apart. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = (g.__svGeoLast ?? 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      g.__svGeoLast = Date.now();
    }
  };
  const next = (g.__svGeoChain ?? Promise.resolve()).then(run, run);
  g.__svGeoChain = next.catch(() => undefined);
  return next;
}

async function search(q: string, extra = ""): Promise<NominatimHit | null> {
  const url = `${ENDPOINT}?format=jsonv2&limit=1&addressdetails=1&accept-language=en&q=${encodeURIComponent(q)}${extra}`;
  const res = await throttled(() =>
    fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(8000) }),
  );
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const hits = (await res.json()) as NominatimHit[];
  return hits[0] ?? null;
}

const CITY_TYPES = new Set(["city", "town", "village", "municipality", "county", "state", "country", "administrative", "hamlet", "island", "region"]);
const AREA_TYPES = new Set(["suburb", "neighbourhood", "quarter", "city_district", "borough", "district", "residential"]);

function precisionOf(h: NominatimHit): Precision {
  const t = h.addresstype ?? h.type ?? "";
  if (CITY_TYPES.has(t)) return "city";
  if (AREA_TYPES.has(t)) return "area";
  return "venue";
}

function cityName(h: NominatimHit): string | null {
  const a = h.address;
  if (!a) return null;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  if (!city) return null;
  return [city, a.state, a.country].filter(Boolean).join(", ");
}

/** Uncached. Throws on upstream errors (so they are not cached as misses); null on a real "no match". */
export async function geocodeNominatim(c: PlaceCandidate): Promise<GeocodedPlace | null> {
  if (c.kind === "home_area") {
    // Never pin a home address: resolve to a city centroid only.
    const parts = c.query.split(",").map((s) => s.trim()).filter(Boolean);
    const tail = parts.slice(-2).join(", ");
    let hit = await search(tail || c.query, "&featureType=city");
    if (!hit && parts.length > 1) hit = await search(parts[parts.length - 1], "&featureType=city");
    if (!hit) {
      const loose = await search(c.query);
      const name = loose && cityName(loose);
      hit = name ? await search(name, "&featureType=city") : loose;
    }
    if (!hit) return null;
    const exact = precisionOf(hit) === "city";
    const name = cityName(hit);
    return {
      findingId: c.findingId,
      // Not a city centroid: coarsen to a ~5 km grid so no street is implied.
      lat: exact ? Number(hit.lat) : Math.round(Number(hit.lat) * 20) / 20,
      lng: exact ? Number(hit.lon) : Math.round(Number(hit.lon) * 20) / 20,
      displayName: name ?? hit.display_name.split(",").slice(-3).join(",").trim(),
      precision: "city",
      approximate: true,
    };
  }
  const hit = await search(c.query);
  if (!hit) return null;
  return {
    findingId: c.findingId,
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    displayName: hit.display_name.split(",").slice(0, 3).join(",").trim(),
    precision: precisionOf(hit),
    approximate: false,
  };
}
