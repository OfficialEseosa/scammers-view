import type { PlaceKind, Precision } from "@/lib/places/types";

export type Theme = "dark" | "light";

export interface EngineStop {
  id: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  precision: Precision;
  approximate: boolean;
  /** Visible name on the map (the kind label in masked mode). */
  label: string;
}

export interface EngineOptions {
  container: HTMLElement;
  theme: Theme;
  reduced: boolean;
  coarse: boolean;
  /** Camera padding so the caption card never covers the focused place. */
  padding: () => { top: number; right: number; bottom: number; left: number };
  onSelect: (id: string) => void;
  /** First drag, pinch, wheel or rotate by the person: drift stops for good. */
  onUserInteract: () => void;
  /** The map cannot render (no WebGL, style or tiles failed). */
  onFail: (reason: string) => void;
  onReady: () => void;
}

export interface MapEngine {
  /** Stops in tour order. New ones drop in; the path follows this order. */
  setStops(stops: EngineStop[]): void;
  select(id: string | null): void;
  /** Fly to a stop; when `from` is set, a dot travels the path from that stop. */
  goTo(id: string, opts: { duration: number; from?: string | null }): void;
  fitAll(animate: boolean): void;
  setTheme(theme: Theme): void;
  /** Idle: slow bearing drift and the dot looping the path. Off while the tour plays. */
  setIdle(idle: boolean): void;
  /** False when off-screen or the tab is hidden: every animation pauses. */
  setActive(active: boolean): void;
  destroy(): void;
}

export type EngineFactory = (opts: EngineOptions) => Promise<MapEngine>;

/** Kind glyphs as tiny inline SVGs (static strings, never user data). */
export const GLYPH: Record<PlaceKind, string> = {
  home_area:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z" fill="currentColor"/></svg>',
  school:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 1.5 9 12 14l8.5-4.05V16H22V9z" fill="currentColor"/><path d="M5.5 12.2V16c0 1.7 2.9 3.5 6.5 3.5s6.5-1.8 6.5-3.5v-3.8L12 15.3z" fill="currentColor"/></svg>',
  work:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6a1.5 1.5 0 0 1 1.5 1.5V7H20a1.5 1.5 0 0 1 1.5 1.5V12h-19V8.5A1.5 1.5 0 0 1 4 7h3.5V5.5A1.5 1.5 0 0 1 9 4m.5 3h5V6h-5zM2.5 13.5h8V15h3v-1.5h8v5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5z" fill="currentColor"/></svg>',
  hangout:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
  event:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v2H5.5A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 18.5 5H17V3h-2v2H9V3zm-1 6h12v9H6z" fill="currentColor"/><rect x="8" y="11" width="4" height="4" rx="0.5" fill="currentColor"/></svg>',
  photo:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 4h7l1.6 2.5H20A1.5 1.5 0 0 1 21.5 8v10.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 4 6.5h2.9z" fill="currentColor"/><circle cx="12" cy="13" r="3.6" fill="var(--pin-ink, #000)"/></svg>',
  other:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a7 7 0 0 0-7 7c0 5.2 7 12 7 12s7-6.8 7-12a7 7 0 0 0-7-7m0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5" fill="currentColor"/></svg>',
};

/** Rough metres-per-degree circle for the approximate home area (64 points). */
export function circlePolygon(lng: number, lat: number, radiusM: number): [number, number][] {
  const pts: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return pts;
}

export const HOME_RADIUS_M = 3500;

export function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
