import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTour, dedupeStops, extractPlaces, regionHint } from "./extract";
import { homeFromGeocode, precisionFromGoogle, venueFromGeocode, venueFromPlace, type GGeocodeResult } from "./google";
import { mapLimit } from "./geocode";
import type { Finding } from "@/lib/types";
import type { GeocodedPlace } from "./types";

// Fictional findings only.
const base = { sourceType: "web", anchor: "email", confidence: 0.9, riskWeight: 6, foundAt: "2026-01-01T00:00:00Z", sourceUrl: "https://example.com/x" } as const;
const f = (o: Partial<Finding> & Pick<Finding, "id" | "category" | "label" | "value">): Finding => ({ ...base, ...o }) as Finding;

const geo = (o: Partial<GGeocodeResult> & { lat: number; lng: number }): GGeocodeResult => ({
  formatted_address: o.formatted_address ?? "10 Example St, Springfield, IL 62701, USA",
  place_id: o.place_id ?? "pid-x",
  types: o.types ?? ["street_address"],
  address_components: o.address_components ?? [
    { long_name: "10", short_name: "10", types: ["street_number"] },
    { long_name: "Example Street", short_name: "Example St", types: ["route"] },
    { long_name: "Springfield", short_name: "Springfield", types: ["locality", "political"] },
    { long_name: "Illinois", short_name: "IL", types: ["administrative_area_level_1", "political"] },
    { long_name: "United States", short_name: "US", types: ["country", "political"] },
  ],
  geometry: o.geometry ?? { location: { lat: o.lat, lng: o.lng }, location_type: "ROOFTOP" },
});

test("precision mapping from Google types and location_type", () => {
  assert.equal(precisionFromGoogle(["locality", "political"], "APPROXIMATE"), "city");
  assert.equal(precisionFromGoogle(["postal_town", "political"]), "city");
  assert.equal(precisionFromGoogle(["administrative_area_level_1", "political"]), "city");
  assert.equal(precisionFromGoogle(["neighborhood", "political"], "APPROXIMATE"), "area");
  assert.equal(precisionFromGoogle(["sublocality_level_1", "sublocality", "political"]), "area");
  assert.equal(precisionFromGoogle(["establishment", "point_of_interest", "gym"]), "venue");
  assert.equal(precisionFromGoogle(["park", "establishment"], "GEOMETRIC_CENTER"), "venue");
  assert.equal(precisionFromGoogle(["street_address"], "ROOFTOP"), "venue");
  assert.equal(precisionFromGoogle([], "ROOFTOP"), "venue");
  assert.equal(precisionFromGoogle([], "APPROXIMATE"), "area");
});

test("home area from a rooftop hit snaps to the locality centroid, never the address", () => {
  const rooftop = geo({ lat: 39.80123, lng: -89.64456 });
  const centroid = geo({ lat: 39.7817, lng: -89.6501, types: ["locality", "political"], formatted_address: "Springfield, IL, USA", geometry: { location: { lat: 39.7817, lng: -89.6501 }, location_type: "APPROXIMATE" } });
  const h = homeFromGeocode("f1", rooftop, centroid);
  assert.equal(h.precision, "city");
  assert.equal(h.approximate, true);
  assert.equal(h.lat, 39.7817);
  assert.equal(h.lng, -89.6501);
  assert.equal(h.displayName, "Springfield, Illinois, United States");
  assert.equal(h.placeId, undefined);
  assert.ok(!/Example|10/.test(h.displayName));
});

test("home area without a locality centroid is coarsened to a ~5 km grid", () => {
  const h = homeFromGeocode("f1", geo({ lat: 39.80123, lng: -89.64456 }), null);
  assert.equal(h.precision, "city");
  assert.equal(h.lat, 39.8);
  assert.equal(h.lng, -89.65);
  assert.equal(h.approximate, true);
});

test("home area that already is a city keeps its centroid", () => {
  const city = geo({ lat: 33.749, lng: -84.388, types: ["locality", "political"], geometry: { location: { lat: 33.749, lng: -84.388 }, location_type: "APPROXIMATE" } });
  const h = homeFromGeocode("f1", city, null);
  assert.equal(h.lat, 33.749);
  assert.equal(h.precision, "city");
});

test("venue mapping keeps place ids and names", () => {
  const v = venueFromGeocode("f2", geo({ lat: 1, lng: 2, types: ["establishment", "point_of_interest"], place_id: "abc" }));
  assert.equal(v.precision, "venue");
  assert.equal(v.placeId, "abc");
  const p = venueFromPlace("f3", { id: "pid-gym", displayName: { text: "Example Gym" }, formattedAddress: "1 Main St, Springfield, IL", location: { latitude: 3, longitude: 4 }, types: ["gym", "establishment"] });
  assert.equal(p?.displayName, "Example Gym, 1 Main St, Springfield");
  assert.equal(p?.precision, "venue");
  assert.equal(venueFromPlace("f4", { id: "x" }), null);
});

test("region hint reads the country from location findings", () => {
  assert.equal(regionHint([f({ id: "a", category: "location", label: "Home", value: "Leeds, United Kingdom" })]), "gb");
  assert.equal(regionHint([f({ id: "a", category: "location", label: "Home", value: "Atlanta, GA" })]), "us");
  assert.equal(regionHint([f({ id: "a", category: "location", label: "Spot", value: "Hyde Park, or nearby" })]), undefined);
  assert.equal(regionHint([f({ id: "a", category: "pet", label: "Dog", value: "England" })]), undefined);
});

const place = (findingId: string, lat: number, lng: number, extra: Partial<GeocodedPlace> = {}): GeocodedPlace => ({
  findingId, lat, lng, displayName: "x", precision: "venue", approximate: false, ...extra,
});

test("tour keeps one home area and merges the same school named twice", () => {
  const findings = [
    f({ id: "h1", category: "location", label: "Location", value: "Atlanta, GA", sourceType: "x" }),
    f({ id: "h2", category: "location", label: "Lives in", value: "Atlanta, Georgia", confidence: 0.6 }),
    f({ id: "s1", category: "school", label: "University", value: "Georgia Institute of Technology", sourceType: "linkedin" }),
    f({ id: "s2", category: "school", label: "Alumni", value: "Georgia Tech", confidence: 0.5 }),
    f({ id: "s3", category: "school", label: "High school", value: "Example High School, Atlanta" }),
    f({ id: "w1", category: "employer", label: "Work", value: "Analyst at Example Market" }),
  ];
  const cands = extractPlaces(findings);
  const places: Record<string, GeocodedPlace> = {
    h1: place("h1", 33.749, -84.388, { precision: "city", approximate: true }),
    h2: place("h2", 33.749, -84.388, { precision: "city", approximate: true }),
    s1: place("s1", 33.778, -84.398, { placeId: "gt" }),
    s2: place("s2", 33.7785, -84.3982, { placeId: "gt-other" }), // same campus, within 1 km
    s3: place("s3", 33.7806, -84.3722, { placeId: "grady" }), // different school ~2.4 km away
    w1: place("w1", 33.772, -84.3657, { placeId: "market" }),
  };
  const tour = buildTour(cands, new Map(findings.map((x) => [x.id, x])), places, {}, false);
  assert.deepEqual(tour.map((s) => s.id), ["h1", "s1", "s3", "w1"]);
  assert.equal(tour.filter((s) => s.kind === "home_area").length, 1);
});

test("identical place_id merges across kinds, but a city-only workplace stays beside the home area", () => {
  const findings = [
    f({ id: "h", category: "location", label: "Location", value: "Atlanta, GA" }),
    f({ id: "w", category: "employer", label: "Work", value: "Works in Atlanta" }),
    f({ id: "a", category: "schedule", label: "Run", value: "Runs at Example Park every Tuesday 6pm" }),
    f({ id: "b", category: "location", label: "Spot", value: "Example Park Trail", confidence: 0.4 }),
  ];
  const cands = extractPlaces(findings);
  const places: Record<string, GeocodedPlace> = {
    h: place("h", 33.749, -84.388, { precision: "city", approximate: true }),
    w: place("w", 33.749, -84.388, { precision: "city", placeId: "atl" }),
    a: place("a", 33.78, -84.37, { placeId: "park" }),
    b: place("b", 33.79, -84.37, { placeId: "park" }),
  };
  const ids = buildTour(cands, new Map(findings.map((x) => [x.id, x])), places, {}, false).map((s) => s.id);
  assert.ok(ids.includes("h") && ids.includes("w"));
  assert.ok(ids.includes("a"));
  assert.ok(!ids.includes("b"));
});

test("pending stops are not merged, but a second home is dropped once one is found", () => {
  const findings = [
    f({ id: "h1", category: "location", label: "Location", value: "Springfield, IL" }),
    f({ id: "h2", category: "location", label: "Lives in", value: "Springfield, Illinois" }),
    f({ id: "x", category: "school", label: "School", value: "Example College" }),
  ];
  const cands = extractPlaces(findings);
  const byId = new Map(findings.map((x) => [x.id, x]));
  const pending = buildTour(cands, byId, {}, {}, false);
  assert.deepEqual(pending.map((s) => s.id), ["h1", "x"]);
  const one = buildTour(cands, byId, { h2: place("h2", 39.78, -89.65, { precision: "city", approximate: true }) }, {}, false);
  assert.deepEqual(one.map((s) => s.id), ["h2", "x"]);
  assert.equal(dedupeStops([]).length, 0);
});

test("mapLimit keeps order and caps concurrency", async () => {
  let live = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, n * 3));
    live--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
});
