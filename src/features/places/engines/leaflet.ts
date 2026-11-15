import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { pinElement, updatePin } from "./pin";
import { cssVar, easeInOut, HOME_RADIUS_M, type EngineFactory, type EngineStop, type MapEngine } from "./types";

/**
 * Fallback when WebGL or the vector style is unavailable: raster OSM tiles
 * greyscaled by CSS, the same pins, path, dot and tour. Flat, no buildings.
 */
export const createLeafletEngine: EngineFactory = async (o) => {
  const map = L.map(o.container, { zoomControl: true, scrollWheelZoom: false, worldCopyJump: true, keyboard: false }).setView([52.5, -1.5], 5);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  o.container.classList.add("sv-leaflet");

  const pins = new Map<string, L.Marker>();
  const homeLayer = L.layerGroup().addTo(map);
  const pathLine = L.polyline([], { color: cssVar("--muted", "#888"), weight: 2, opacity: 0.8, dashArray: "2 7", lineCap: "round", interactive: false }).addTo(map);
  const trailLine = L.polyline([], { color: cssVar("--text", "#fff"), weight: 3, opacity: 0.95, interactive: false }).addTo(map);
  const dotIcon = L.divIcon({ className: "", html: '<span class="sv-gdot"></span>', iconSize: [14, 14], iconAnchor: [7, 7] });
  const dot = L.marker([0, 0], { icon: dotIcon, interactive: false, keyboard: false });
  let dotOn = false;
  let stops: EngineStop[] = [];
  let raf = 0;
  let active = true;

  map.on("dragstart zoomstart", (e: L.LeafletEvent & { originalEvent?: unknown }) => {
    if ((e as { originalEvent?: unknown }).originalEvent) o.onUserInteract();
  });
  map.getContainer().addEventListener("pointerdown", () => o.onUserInteract(), { once: true });

  const ll = (s: EngineStop) => L.latLng(s.lat, s.lng);
  const showDot = (p: L.LatLng | null) => {
    if (!p) {
      if (dotOn) dot.remove();
      dotOn = false;
      return;
    }
    dot.setLatLng(p);
    if (!dotOn) dot.addTo(map);
    dotOn = true;
  };
  const pad = () => {
    const p = o.padding();
    return { paddingTopLeft: L.point(p.left + 40, p.top + 40), paddingBottomRight: L.point(p.right + 40, p.bottom + 40) };
  };

  o.onReady();

  return {
    setStops(next) {
      const ids = new Set(next.map((s) => s.id));
      for (const [id, m] of pins) {
        if (ids.has(id)) continue;
        m.remove();
        pins.delete(id);
      }
      for (const s of next) {
        const m = pins.get(s.id);
        if (m) {
          m.setLatLng(ll(s));
          const el = m.getElement()?.firstElementChild as HTMLElement | null;
          if (el) updatePin(el, s);
          continue;
        }
        const icon = L.divIcon({ className: "sv-lpin", html: "", iconSize: [0, 0] });
        const mk = L.marker(ll(s), { icon, keyboard: false }).addTo(map);
        mk.getElement()?.append(pinElement(s, o.onSelect));
        pins.set(s.id, mk);
      }
      homeLayer.clearLayers();
      for (const s of next.filter((x) => x.kind === "home_area")) {
        L.circle(ll(s), { radius: HOME_RADIUS_M, color: cssVar("--danger", "#ff5f52"), weight: 1.5, dashArray: "4 5", fillOpacity: 0.12, interactive: false }).addTo(homeLayer);
      }
      pathLine.setLatLngs(next.map(ll));
      stops = next;
    },
    select(id) {
      o.container.classList.toggle("has-selection", !!id);
      for (const [mid, m] of pins) {
        m.getElement()?.firstElementChild?.classList.toggle("is-selected", mid === id);
        m.setZIndexOffset(mid === id ? 1000 : 0);
      }
    },
    goTo(id, { duration, from }) {
      const idx = stops.findIndex((s) => s.id === id);
      const s = stops[idx];
      if (!s) return;
      const zoom = s.kind === "home_area" || s.precision === "city" ? 11 : s.precision === "area" ? 14 : 16;
      const p = o.padding();
      // Offset the centre so the caption card does not cover the place.
      const target = map.unproject(map.project(ll(s), zoom).add(L.point((p.left - p.right) / -2, (p.top - p.bottom) / -2)), zoom);
      if (o.reduced) map.setView(target, zoom, { animate: false });
      else map.flyTo(target, zoom, { duration: duration / 1000 });
      cancelAnimationFrame(raf);
      const fromIdx = from ? stops.findIndex((x) => x.id === from) : -1;
      const done = stops.slice(0, idx + 1).map(ll);
      if (o.reduced || fromIdx !== idx - 1 || fromIdx < 0) {
        trailLine.setLatLngs(done);
        showDot(o.reduced ? null : ll(s));
        return;
      }
      const a = ll(stops[fromIdx]);
      const b = ll(s);
      const t0 = performance.now();
      const tick = (now: number) => {
        if (!active) return;
        const t = Math.min(1, (now - t0) / duration);
        const k = easeInOut(t);
        const pt = L.latLng(a.lat + (b.lat - a.lat) * k, a.lng + (b.lng - a.lng) * k);
        showDot(pt);
        trailLine.setLatLngs([...done.slice(0, idx), pt]);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    fitAll(animate) {
      if (!stops.length) return;
      const b = L.latLngBounds(stops.map(ll));
      for (const s of stops) if (s.kind === "home_area") b.extend(L.latLng(s.lat, s.lng).toBounds(HOME_RADIUS_M * 2));
      map.flyToBounds(b, { ...pad(), maxZoom: 13, animate: animate && !o.reduced, duration: 1.2 });
    },
    setTheme() {
      // Tiles are themed by CSS filters on the container.
    },
    setIdle(v) {
      if (v) {
        cancelAnimationFrame(raf);
        trailLine.setLatLngs([]);
        showDot(null);
      }
    },
    setActive(v) {
      active = v;
    },
    destroy() {
      cancelAnimationFrame(raf);
      map.remove();
      o.container.classList.remove("sv-leaflet");
    },
  } satisfies MapEngine;
};
