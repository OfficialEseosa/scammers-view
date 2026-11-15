import { geocodeGoogle } from "./google";
import { geocodeNominatim } from "./nominatim";
import type { GeocodedPlace, PlaceCandidate } from "./types";

/**
 * Google first (server key), Nominatim when there is no key, Google has no
 * match, or Google errors. Results (including real misses) are cached in
 * memory for the life of the server instance; transient failures are not.
 */

const g = globalThis as unknown as { __svGeoCache2?: Map<string, GeocodedPlace | null> };
const cache = (g.__svGeoCache2 ??= new Map());

export const cacheKey = (c: PlaceCandidate) => `${c.kind === "home_area" ? "home" : "pin"}:${c.region ?? "-"}:${c.query.toLowerCase()}`;

async function resolve(c: PlaceCandidate): Promise<{ place: GeocodedPlace | null; cacheable: boolean }> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (key) {
    try {
      const hit = await geocodeGoogle(c, key);
      if (hit) return { place: hit, cacheable: true };
    } catch (e) {
      console.warn(`[places] google geocode failed (${e instanceof Error ? e.message : "error"}); trying Nominatim`);
    }
  }
  try {
    return { place: await geocodeNominatim(c), cacheable: true };
  } catch {
    return { place: null, cacheable: false };
  }
}

export async function geocode(c: PlaceCandidate): Promise<GeocodedPlace | null> {
  const k = cacheKey(c);
  if (cache.has(k)) {
    const hit = cache.get(k);
    return hit ? { ...hit, findingId: c.findingId } : null;
  }
  const { place, cacheable } = await resolve(c);
  if (cacheable) cache.set(k, place);
  return place ? { ...place, findingId: c.findingId } : null;
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const GEOCODE_CONCURRENCY = 4;

export function geocodeAll(cands: PlaceCandidate[]): Promise<(GeocodedPlace | null)[]> {
  return mapLimit(cands, GEOCODE_CONCURRENCY, geocode);
}
