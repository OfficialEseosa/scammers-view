import type { StyleSpecification } from "maplibre-gl";
import type { Theme } from "./types";

/** OpenFreeMap vector styles (no key). Attribution comes from the tiles' TileJSON. */
export const STYLE_URL: Record<Theme, string> = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

function parse(c: string): [number, number, number, number] | null {
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x));
    const [h, sat, l] = [p[0], p[1] / 100, p[2] / 100];
    const k = (n: number) => (n + h / 30) % 12;
    const a = sat * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255, p[3] ?? 1];
  }
  return null;
}

/** Any colour to a neutral grey of the same lightness. */
export function toGrey(c: string): string {
  const p = parse(c);
  if (!p) return c;
  const y = Math.round(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]);
  return p[3] >= 1 ? `rgb(${y},${y},${y})` : `rgba(${y},${y},${y},${+p[3].toFixed(3)})`;
}

function walk(v: unknown): unknown {
  if (typeof v === "string") return /^(#|rgb|hsl)/i.test(v.trim()) ? toGrey(v) : v;
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  return v;
}

const DARK_LABEL = { "text-color": "rgb(225,225,225)", "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.4 };
const DARK_ROAD_LABEL = { "text-color": "rgb(185,185,185)", "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.2 };

/**
 * Dark theme, lifted so the fallback map is never a black rectangle: water is the darkest thing,
 * land a clear mid-dark grey, roads visibly lighter than land, labels near-white with a halo.
 */
const OVERRIDES: Record<Theme, Record<string, Record<string, unknown>>> = {
  dark: {
    background: { "background-color": "rgb(40,40,40)" },
    water: { "fill-color": "rgb(9,9,9)" },
    waterway: { "line-color": "rgb(9,9,9)" },
    landuse_residential: { "fill-color": "rgb(46,46,46)" },
    landcover_wood: { "fill-color": "rgb(50,50,50)" },
    landuse_park: { "fill-color": "rgb(52,52,52)" },
    landcover_ice_shelf: { "fill-color": "rgb(60,60,60)" },
    landcover_glacier: { "fill-color": "rgb(60,60,60)" },
    building: { "fill-color": "rgb(60,60,60)", "fill-outline-color": "rgb(74,74,74)" },
    "aeroway-area": { "fill-color": "rgb(52,52,52)" },
    "aeroway-runway": { "line-color": "rgb(90,90,90)" },
    "aeroway-taxiway": { "line-color": "rgb(76,76,76)" },
    road_area_pier: { "fill-color": "rgb(70,70,70)" },
    road_pier: { "line-color": "rgb(70,70,70)" },
    highway_path: { "line-color": "rgb(72,72,72)" },
    highway_minor: { "line-color": "rgb(84,84,84)" },
    highway_major_casing: { "line-color": "rgba(24,24,24,0.9)" },
    highway_major_inner: { "line-color": "rgb(112,112,112)" },
    highway_major_subtle: { "line-color": "rgb(100,100,100)" },
    highway_motorway_casing: { "line-color": "rgba(20,20,20,0.9)" },
    highway_motorway_inner: { "line-color": "rgb(140,140,140)" },
    highway_motorway_subtle: { "line-color": "rgb(118,118,118)" },
    railway: { "line-color": "rgb(78,78,78)" },
    railway_minor: { "line-color": "rgb(72,72,72)" },
    railway_transit: { "line-color": "rgb(72,72,72)" },
    railway_dashline: { "line-color": "rgb(40,40,40)" },
    railway_minor_dashline: { "line-color": "rgb(40,40,40)" },
    railway_transit_dashline: { "line-color": "rgb(40,40,40)" },
    boundary_state: { "line-color": "rgb(96,96,96)" },
    "boundary_country_z0-4": { "line-color": "rgb(120,120,120)" },
    "boundary_country_z5-": { "line-color": "rgb(120,120,120)" },
    water_name: { "text-color": "rgb(150,150,150)", "text-halo-color": "rgba(0,0,0,0.8)", "text-halo-width": 1.2 },
    highway_name_other: DARK_ROAD_LABEL,
    highway_name_motorway: DARK_ROAD_LABEL,
  },
  light: {
    background: { "background-color": "rgb(246,246,246)" },
    water: { "fill-color": "rgb(214,214,214)" },
    park: { "fill-color": "rgb(236,236,236)" },
  },
};

function overrideFor(theme: Theme, id: string): Record<string, unknown> | undefined {
  const exact = OVERRIDES[theme][id];
  if (exact) return exact;
  // Every place label (city, town, suburb, country...) gets the legible label treatment.
  if (theme === "dark" && id.startsWith("place_")) return DARK_LABEL;
  return undefined;
}

/** Make the stock style strictly monochrome: every paint colour to grey, a few fills tuned to our black and white. */
export function monochrome(theme: Theme) {
  return (_prev: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification => ({
    ...next,
    layers: next.layers.map((l) => {
      const paint = "paint" in l && l.paint ? (walk(l.paint) as Record<string, unknown>) : undefined;
      const over = overrideFor(theme, l.id);
      if (!paint && !over) return l;
      return { ...l, paint: { ...(paint ?? {}), ...(over ?? {}) } } as typeof l;
    }),
  });
}
