import { z } from "zod";

export const PlaceKind = z.enum(["home_area", "school", "work", "hangout", "event", "photo", "other"]);
export type PlaceKind = z.infer<typeof PlaceKind>;

export const PlaceCandidate = z.object({
  findingId: z.string().max(200),
  query: z.string().min(2).max(160),
  kind: PlaceKind,
  /** ISO 3166-1 alpha-2 country hint from the rest of the findings (e.g. "gb"); the server biases "us" without one. */
  region: z.string().regex(/^[a-z]{2}$/).optional(),
});
export type PlaceCandidate = z.infer<typeof PlaceCandidate>;

export const GeocodeRequest = z.object({
  candidates: z.array(PlaceCandidate).max(12),
});

export type Precision = "city" | "area" | "venue";

export interface GeocodedPlace {
  findingId: string;
  lat: number;
  lng: number;
  displayName: string;
  precision: Precision;
  /** True when the pin was deliberately snapped (home areas never get an address). */
  approximate: boolean;
  /** Google place_id when Google resolved it (used to merge duplicates). Never set for home areas. */
  placeId?: string;
}
