import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { monochrome, STYLE_URL } from "./mono";
import { pinElement, updatePin } from "./pin";
import { circlePolygon, cssVar, easeInOut, HOME_RADIUS_M, type EngineFactory, type EngineStop, type MapEngine, type Theme } from "./types";

// MapLibre runs its tile parsing in a module worker. Bundlers move the main
// file, so point it at the worker explicitly (emitted as a static asset).
let workerSet = false;
function ensureWorker() {
  if (workerSet) return;
  workerSet = true;
  try {
    maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
  } catch {
    /* keep the library default */
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    // Release the probe context at once: browsers cap live contexts per page.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

type LineFC = GeoJSON.FeatureCollection<GeoJSON.LineString>;
const lineFC = (coords: [number, number][]): LineFC => ({
  type: "FeatureCollection",
  features: coords.length >= 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [],
});

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function cameraFor(s: EngineStop) {
  if (s.kind === "home_area" || s.precision === "city") return { zoom: 11.3, pitch: 42 };
  if (s.precision === "area") return { zoom: 14, pitch: 52 };
  return { zoom: 16.4, pitch: 58 };
}

export const createGlEngine: EngineFactory = async (o) => {
  if (!webglAvailable()) throw new Error("webgl");
  ensureWorker();

  const map: MLMap = new maplibregl.Map({
    container: o.container,
    style: STYLE_URL[o.theme],
    transformStyle: monochrome(o.theme),
    center: [-1.5, 52.5],
    zoom: 4.2,
    pitch: 30,
    bearing: -8,
    maxPitch: 70,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    attributionControl: { compact: false },
    maplibreLogo: false,
    keyboard: false,
    // Desktop: ctrl + scroll zooms so the page still scrolls past the map. Touch: one finger pans.
    cooperativeGestures: !o.coarse,
    fadeDuration: 180,
    reduceMotion: o.reduced,
    canvasContextAttributes: { antialias: (window.devicePixelRatio || 1) < 2 },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

  let theme: Theme = o.theme;
  let stops: EngineStop[] = [];
  const markers = new Map<string, Marker>();
  let selected: string | null = null;
  let idle = true;
  let active = true;
  let touched = false;
  let failed = false;
  let loadedOnce = false;
  let earlyReject: ((e: Error) => void) | null = null;
  let destroyed = false;
  let travelledTo = -1; // index in stops of the last tour stop reached
  let raf = 0;
  let inFrame = false;
  let travel: { from: [number, number]; to: [number, number]; t0: number; dur: number; toIdx: number } | null = null;
  let loopT = 0;
  let lastFrame = 0;

  const dotEl = document.createElement("span");
  dotEl.className = "sv-gdot";
  dotEl.setAttribute("aria-hidden", "true");
  const dot = new maplibregl.Marker({ element: dotEl, anchor: "center" });
  let dotOn = false;

  const fail = (reason: string) => {
    if (failed || destroyed) return;
    failed = true;
    console.warn(`[places] 3D map unavailable (${reason}); using the flat map`);
    o.onFail(reason);
    earlyReject?.(new Error(reason));
  };
  // Give the style 15 visible seconds: a background tab does not render, so it must not count as a failure.
  let timeout = 0;
  const arm = () => {
    timeout = window.setTimeout(() => (document.hidden ? arm() : fail("timeout")), 15000);
  };
  arm();
  map.on("error", (e) => {
    // Only fatal before the first render: a missing tile later is not worth abandoning the map.
    if (!loadedOnce && !map.isStyleLoaded()) fail(String(e.error?.message ?? "error"));
  });
  // A lost context is usually restored (MapLibre rebuilds on webglcontextrestored); give up only if it is not.
  let lostTimer = 0;
  map.on("webglcontextlost", () => {
    lostTimer = window.setTimeout(() => fail("context lost"), 4000);
  });
  map.on("webglcontextrestored", () => window.clearTimeout(lostTimer));

  const userStart = (e: { originalEvent?: unknown }) => {
    if (!e.originalEvent || touched) return;
    touched = true;
    o.onUserInteract();
  };
  map.on("dragstart", userStart);
  map.on("zoomstart", userStart);
  map.on("rotatestart", userStart);
  map.on("pitchstart", userStart);

  const pathCoords = () => stops.map((s) => [s.lng, s.lat] as [number, number]);

  function ensureLayers() {
    if (!map.isStyleLoaded() && !map.getStyle()) return;
    const text = cssVar("--text", theme === "dark" ? "#fff" : "#000");
    const muted = cssVar("--muted", "#a3a3a3");
    const danger = cssVar("--danger", "#ff5f52");
    const layers = map.getStyle().layers ?? [];
    const firstSymbol = layers.find((l) => l.type === "symbol")?.id;

    if (!map.getLayer("sv-buildings") && map.getSource("openmaptiles")) {
      const dark = theme === "dark";
      map.addLayer(
        {
          id: "sv-buildings",
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 14,
          filter: ["!=", ["get", "hide_3d"], true],
          paint: {
            "fill-extrusion-color": [
              "interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8],
              0, dark ? "#3c3c3c" : "#e4e4e4",
              40, dark ? "#4a4a4a" : "#d2d2d2",
              120, dark ? "#5a5a5a" : "#c0c0c0",
            ],
            "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.2, ["coalesce", ["get", "render_height"], 8]],
            "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.2, ["coalesce", ["get", "render_min_height"], 0]],
            "fill-extrusion-opacity": 0.92,
            "fill-extrusion-vertical-gradient": true,
          },
        },
        firstSymbol,
      );
    }
    if (!map.getSource("sv-home")) map.addSource("sv-home", { type: "geojson", data: homeFC() });
    if (!map.getLayer("sv-home-fill"))
      map.addLayer({ id: "sv-home-fill", type: "fill", source: "sv-home", paint: { "fill-color": danger, "fill-opacity": 0.13 } });
    if (!map.getLayer("sv-home-line"))
      map.addLayer({
        id: "sv-home-line",
        type: "line",
        source: "sv-home",
        paint: { "line-color": danger, "line-width": 1.5, "line-opacity": 0.85, "line-dasharray": [2, 2] },
      });
    if (!map.getSource("sv-path")) map.addSource("sv-path", { type: "geojson", data: lineFC(pathCoords()) });
    if (!map.getLayer("sv-path-base"))
      map.addLayer({
        id: "sv-path-base",
        type: "line",
        source: "sv-path",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": muted, "line-width": 2, "line-opacity": 0.75, "line-dasharray": [0.6, 2.2] },
      });
    if (!map.getSource("sv-trail")) map.addSource("sv-trail", { type: "geojson", data: lineFC([]) });
    if (!map.getLayer("sv-trail"))
      map.addLayer({
        id: "sv-trail",
        type: "line",
        source: "sv-trail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": text, "line-width": 3, "line-opacity": 0.95 },
      });
  }

  function homeFC(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
    return {
      type: "FeatureCollection",
      features: stops
        .filter((s) => s.kind === "home_area")
        .map((s) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circlePolygon(s.lng, s.lat, HOME_RADIUS_M)] } })),
    };
  }

  const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;
  function setTrail(coords: [number, number][]) {
    src("sv-trail")?.setData(lineFC(coords));
  }

  function showDot(at: [number, number] | null) {
    if (!at) {
      if (dotOn) dot.remove();
      dotOn = false;
      return;
    }
    dot.setLngLat(at);
    if (!dotOn) dot.addTo(map);
    dotOn = true;
  }

  // One rAF loop for drift, the travelling dot and the idle path loop. Stops itself when nothing moves.
  function frame(now: number) {
    raf = 0;
    if (destroyed || !active) return;
    inFrame = true;
    try {
      step(now);
    } finally {
      inFrame = false;
    }
  }
  function step(now: number) {
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    let keep = false;
    const coords = pathCoords();

    if (travel) {
      const t = Math.min(1, (now - travel.t0) / travel.dur);
      const k = easeInOut(t);
      const p: [number, number] = [travel.from[0] + (travel.to[0] - travel.from[0]) * k, travel.from[1] + (travel.to[1] - travel.from[1]) * k];
      showDot(p);
      setTrail([...coords.slice(0, travel.toIdx), p]);
      if (t >= 1) {
        travelledTo = travel.toIdx;
        travel = null;
      }
      keep = true;
    } else if (idle && !o.reduced && coords.length >= 2) {
      // The dot walks the whole route, 2.6s a leg, then rests a beat.
      const legs = coords.length - 1;
      const cycle = legs * 2600 + 1200;
      loopT = (loopT + dt) % cycle;
      const leg = Math.min(legs - 1, Math.floor(loopT / 2600));
      const t = Math.min(1, (loopT - leg * 2600) / 2600);
      const k = easeInOut(t);
      const a = coords[leg];
      const b = coords[leg + 1];
      showDot([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
      keep = true;
    }

    if (idle && !touched && !o.reduced && !map.isMoving()) {
      map.setBearing(map.getBearing() + dt * 0.0016);
      keep = true;
    }
    if (keep) raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && !inFrame && active && !destroyed) {
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  map.on("moveend", kick);

  await new Promise<void>((resolve, reject) => {
    earlyReject = reject;
    const onFailEarly = () => reject(new Error("style"));
    // Ready once the style is parsed: tiles stream in afterwards (and never do in a hidden tab).
    map.once("style.load", () => {
      loadedOnce = true;
      resolve();
    });
    map.once("error", () => {
      if (!loadedOnce && !map.isStyleLoaded()) onFailEarly();
    });
  }).catch((e) => {
    window.clearTimeout(timeout);
    map.remove();
    throw e;
  });
  window.clearTimeout(timeout);
  if (failed) {
    map.remove();
    throw new Error("failed");
  }
  ensureLayers();
  map.on("style.load", () => {
    ensureLayers();
    syncData();
  });
  o.onReady();

  function syncData() {
    src("sv-home")?.setData(homeFC());
    src("sv-path")?.setData(lineFC(pathCoords()));
    if (o.reduced || !idle) {
      if (!travel) setTrail(pathCoords().slice(0, travelledTo + 1));
    } else setTrail([]);
    if (o.reduced) showDot(null);
  }

  function padding() {
    return o.padding();
  }

  const engine: MapEngine = {
    setStops(next) {
      const ids = new Set(next.map((s) => s.id));
      for (const [id, m] of markers) {
        if (!ids.has(id)) {
          m.remove();
          markers.delete(id);
        }
      }
      next.forEach((s, i) => {
        const m = markers.get(s.id);
        if (m) {
          m.setLngLat([s.lng, s.lat]);
          updatePin(m.getElement(), s);
        } else {
          const el = pinElement(s, o.onSelect);
          el.style.setProperty("--i", String(i % 6));
          const mk = new maplibregl.Marker({ element: el, anchor: "center", subpixelPositioning: true }).setLngLat([s.lng, s.lat]).addTo(map);
          markers.set(s.id, mk);
        }
      });
      stops = next;
      syncData();
      engine.select(selected);
      kick();
    },
    select(id) {
      selected = id;
      o.container.classList.toggle("has-selection", !!id);
      for (const [mid, m] of markers) m.getElement().classList.toggle("is-selected", mid === id);
      // Keep the focused pin above its neighbours.
      for (const [mid, m] of markers) m.getElement().style.zIndex = mid === id ? "3" : "";
    },
    goTo(id, { duration, from }) {
      const idx = stops.findIndex((s) => s.id === id);
      const s = stops[idx];
      if (!s) return;
      const cam = cameraFor(s);
      const bearing = -35 + hash(s.id) * 70;
      const pad = padding();
      if (o.reduced) {
        map.jumpTo({ center: [s.lng, s.lat], zoom: cam.zoom, pitch: cam.pitch, bearing, padding: pad });
        travelledTo = Math.max(travelledTo, idx);
        setTrail(pathCoords().slice(0, idx + 1));
        return;
      }
      map.flyTo({ center: [s.lng, s.lat], zoom: cam.zoom, pitch: cam.pitch, bearing, padding: pad, duration, curve: 1.5, essential: true });
      const fromIdx = from ? stops.findIndex((x) => x.id === from) : -1;
      if (fromIdx >= 0 && fromIdx === idx - 1) {
        travel = { from: [stops[fromIdx].lng, stops[fromIdx].lat], to: [s.lng, s.lat], t0: performance.now(), dur: duration, toIdx: idx };
      } else {
        travel = null;
        travelledTo = idx;
        setTrail(pathCoords().slice(0, idx + 1));
        showDot([s.lng, s.lat]);
      }
      kick();
    },
    fitAll(animate) {
      if (!stops.length) return;
      const b = new maplibregl.LngLatBounds();
      for (const s of stops) {
        if (s.kind === "home_area") for (const p of circlePolygon(s.lng, s.lat, HOME_RADIUS_M)) b.extend(p);
        else b.extend([s.lng, s.lat]);
      }
      const pad = padding();
      const p = { top: pad.top + 60, right: pad.right + 60, bottom: pad.bottom + 60, left: pad.left + 60 };
      map.fitBounds(b, { padding: p, pitch: 32, bearing: map.getBearing(), maxZoom: 14.5, duration: animate && !o.reduced ? 1600 : 0 });
    },
    setTheme(t) {
      if (t === theme) return;
      theme = t;
      map.setStyle(STYLE_URL[t], { transformStyle: monochrome(t) });
    },
    setIdle(v) {
      idle = v;
      if (v) {
        travel = null;
        travelledTo = -1;
        setTrail([]);
        if (o.reduced) showDot(null);
      }
      kick();
    },
    setActive(v) {
      active = v;
      if (!v && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      kick();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
      markers.clear();
      map.remove();
    },
  };
  return engine;
};
