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

const OVERRIDES: Record<Theme, Record<string, Record<string, unknown>>> = {
  dark: {
    background: { "background-color": "rgb(8,8,8)" },
    water: { "fill-color": "rgb(22,22,22)" },
    building: { "fill-color": "rgb(18,18,18)", "fill-outline-color": "rgb(30,30,30)" },
  },
  light: {
    background: { "background-color": "rgb(246,246,246)" },
    water: { "fill-color": "rgb(214,214,214)" },
    park: { "fill-color": "rgb(236,236,236)" },
  },
};

/** Make the stock style strictly monochrome: every paint colour to grey, a few fills tuned to our black and white. */
export function monochrome(theme: Theme) {
  return (_prev: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification => ({
    ...next,
    layers: next.layers.map((l) => {
      const paint = "paint" in l && l.paint ? (walk(l.paint) as Record<string, unknown>) : undefined;
      const over = OVERRIDES[theme][l.id];
      if (!paint && !over) return l;
      return { ...l, paint: { ...(paint ?? {}), ...(over ?? {}) } } as typeof l;
    }),
  });
}
