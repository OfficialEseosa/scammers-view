import { circlePolygon, easeInOut, GLYPH, HOME_RADIUS_M, type EngineFactory, type EngineStop, type MapEngine } from "./types";

/**
 * Google Photorealistic 3D (Maps JavaScript API, `maps3d` library).
 *
 * SECURITY: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is shipped to every browser by
 * design. It MUST be restricted in Google Cloud: HTTP referrers limited to the
 * app's own origins, and API restrictions limited to Maps JavaScript API and
 * Map Tiles API. The server-side geocoder uses GOOGLE_MAPS_SERVER_KEY instead
 * (ideally a separate, IP/API-restricted key).
 *
 * Privacy: the home area is only ever a translucent ~3.5 km circle and a pin at
 * the city centroid, and the camera stays several kilometres out over it.
 */

export const GOOGLE_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/* ---------------- the small slice of the API we use (no @types dependency) ---------------- */

type LatLngAlt = { lat: number; lng: number; altitude?: number };
interface Camera {
  center: LatLngAlt;
  range: number;
  tilt: number;
  heading: number;
}
interface Map3D extends HTMLElement, Partial<Camera> {
  flyCameraTo(o: { endCamera: Partial<Camera> & { altitudeMode?: string }; durationMillis: number }): void;
  flyCameraAround(o: { camera: Partial<Camera>; durationMillis: number; repeatCount: number }): void;
  stopCameraAnimation(): void;
}
interface Marker3D extends HTMLElement {
  position: LatLngAlt;
  label: string | null;
  title: string;
  zIndex: number | null;
}
interface Shape3D extends HTMLElement {
  path: LatLngAlt[];
}
type Ctor<T> = new (opts?: Record<string, unknown>) => T;
interface Maps3dLib {
  Map3DElement: Ctor<Map3D>;
  Marker3DElement: Ctor<Marker3D>;
  Marker3DInteractiveElement: Ctor<Marker3D>;
  Polyline3DElement: Ctor<Shape3D>;
  Polygon3DElement: Ctor<Shape3D>;
}
interface PinLike {
  element?: HTMLElement;
}
interface MarkerLib {
  PinElement: Ctor<PinLike>;
}
type GoogleNS = { maps?: { importLibrary?: (name: string) => Promise<unknown> } };
type Win = Window & { google?: GoogleNS; gm_authFailure?: () => void; __svGmapsBoot?: () => void };

/* ---------------- loader: once per page, lazily, only when the tour mounts ---------------- */

let loading: Promise<{ m3: Maps3dLib; mk: MarkerLib }> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

function loadGoogle(key: string): Promise<{ m3: Maps3dLib; mk: MarkerLib }> {
  if (loading) return loading;
  const w = window as Win;
  // Google calls this global on an invalid, unauthorised or referrer-blocked key.
  w.gm_authFailure = () => {
    authFailed = true;
    for (const f of authListeners) f();
  };
  loading = new Promise<void>((resolve, reject) => {
    if (w.google?.maps?.importLibrary) return resolve();
    w.__svGmapsBoot = () => resolve();
    const q = new URLSearchParams({ key, v: "weekly", loading: "async", callback: "__svGmapsBoot", libraries: "maps3d,marker" });
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?${q}`;
    s.async = true;
    s.onerror = () => reject(new Error("maps js failed to load"));
    document.head.append(s);
    window.setTimeout(() => reject(new Error("maps js timeout")), 20000);
  })
    .then(async () => {
      const imp = w.google!.maps!.importLibrary!;
      const [m3, mk] = await Promise.all([imp("maps3d"), imp("marker")]);
      return { m3: m3 as Maps3dLib, mk: mk as MarkerLib };
    })
    .catch((e) => {
      loading = null; // allow a later retry (e.g. after a network blip)
      throw e;
    });
  return loading;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/* ---------------- helpers ---------------- */

const DANGER = "#ff5f52";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** The kind glyph as a standalone SVG data URL in a fixed colour (pins are rasterised). */
function glyphUrl(kind: EngineStop["kind"], color: string, ink: string): string {
  const svg = GLYPH[kind]
    .replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" `)
    .replace(/currentColor/g, color)
    .replace(/var\(--pin-ink, #000\)/g, ink);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Street-to-neighbourhood for venues; several km for towns, and always wide over a home area. */
function cameraFor(s: EngineStop): { range: number; tilt: number } {
  if (s.kind === "home_area") return { range: 16000, tilt: 45 };
  if (s.precision === "city") return { range: 9000, tilt: 50 };
  if (s.precision === "area") return { range: 2600, tilt: 58 };
  return { range: 950, tilt: 62 };
}

const metresBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6_371_000;
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/* ---------------- the engine ---------------- */

export const createGoogle3dEngine: EngineFactory = async (o) => {
  if (!GOOGLE_BROWSER_KEY) throw new Error("no key");
  if (!webglAvailable()) throw new Error("webgl");
  if (authFailed) throw new Error("auth");
  const { m3, mk } = await loadGoogle(GOOGLE_BROWSER_KEY);
  const { Map3DElement, Marker3DElement, Marker3DInteractiveElement, Polyline3DElement, Polygon3DElement } = m3;
  const { PinElement } = mk;

  const map = new Map3DElement({
    center: { lat: 30, lng: -40, altitude: 0 },
    range: 9_000_000,
    tilt: 0,
    heading: 0,
    mode: "HYBRID",
    // Desktop: ctrl + scroll zooms so the page still scrolls past the map. Touch: one finger moves the map.
    gestureHandling: o.coarse ? "GREEDY" : "COOPERATIVE",
    description: "Photorealistic 3D map of the places found about you",
  });
  map.classList.add("sv-g3d");
  map.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  o.container.classList.add("sv-google");

  let stops: EngineStop[] = [];
  const markers = new Map<string, { el: Marker3D; stop: EngineStop; selected: boolean | null }>();
  let selected: string | null = null;
  let idle = true;
  let active = true;
  let touched = false;
  let destroyed = false;
  let failed = false;

  /* camera choreography: one pending follow-up per flight (orbit after arrival) */
  type Orbit = "stop" | "idle" | null;
  let orbit: Orbit = null; // the orbit currently running
  // The flight in progress: its target, what follows it, and when it should be done.
  let flight: { cam: Camera; then: Orbit; due: number; check: number } | null = null;
  let resumeOrbit: Orbit = null;
  let resumeFlight: { cam: Camera; then: Orbit } | null = null;

  const camNow = (): Camera => ({
    center: { lat: map.center?.lat ?? 0, lng: map.center?.lng ?? 0, altitude: map.center?.altitude ?? 0 },
    range: map.range ?? 10000,
    tilt: map.tilt ?? 45,
    heading: map.heading ?? 0,
  });
  const clearFlight = () => {
    if (flight) window.clearTimeout(flight.check);
    flight = null;
  };
  const stopCamera = () => {
    clearFlight();
    orbit = null;
    try {
      map.stopCameraAnimation();
    } catch {
      /* not animating */
    }
  };
  const startOrbit = (kind: Exclude<Orbit, null>) => {
    if (o.reduced || !active || destroyed) return;
    if (kind === "idle" && touched) return;
    orbit = kind;
    // camNow() reads absolute altitudes, which is the API default for the orbit camera.
    // Clockwise orbit around the current centre: ~2 min a turn on a stop, ~6 min idle.
    map.flyCameraAround({ camera: camNow(), durationMillis: kind === "idle" ? 360_000 : 120_000, repeatCount: Number.POSITIVE_INFINITY });
  };
  const land = () => {
    const f = flight;
    clearFlight();
    if (f?.then) startOrbit(f.then);
  };
  const fly = (cam: Camera, ms: number, then: Orbit) => {
    stopCamera();
    const dur = o.reduced ? 0 : ms;
    // Targets sit on the ground (altitude 0 relative to terrain). The API default is ABSOLUTE,
    // which puts the target under the surface in hilly or high cities and shifts the framing.
    const end = { ...cam, altitudeMode: "RELATIVE_TO_GROUND" };
    map.flyCameraTo({ endCamera: end, durationMillis: dur });
    if (o.reduced) return;
    const due = performance.now() + dur - 250;
    // A throttled or backgrounded tab can stall a flight half-way: if it has not landed shortly
    // after it should have, jump to the target so the camera never rests somewhere arbitrary.
    const check = window.setTimeout(() => {
      if (flight?.due !== due || !active || destroyed) return;
      map.flyCameraTo({ endCamera: end, durationMillis: 0 });
      land();
    }, dur + 1500);
    flight = { cam, then, due, check };
  };
  map.addEventListener("gmp-animationend", () => {
    // Only a flight that ran to its end continues (an interrupted one ends early).
    if (!flight || performance.now() < flight.due) return;
    land();
  });

  /* the person takes over: the idle drift stops for good */
  const userStart = () => {
    if (orbit || flight) stopCamera();
    if (touched) return;
    touched = true;
    o.onUserInteract();
  };
  map.addEventListener("pointerdown", userStart);
  map.addEventListener("wheel", userStart, { passive: true });
  map.addEventListener("touchstart", userStart, { passive: true });

  /* failure: auth (bad/blocked key), map errors before the first steady frame, or nothing in 15 visible seconds */
  const fail = (reason: string) => {
    if (failed || destroyed) return;
    failed = true;
    console.warn(`[places] Google 3D map unavailable (${reason}); falling back`);
    o.onFail(reason);
    earlyReject?.(new Error(reason));
  };
  const onAuth = () => fail("auth");
  authListeners.add(onAuth);
  map.addEventListener("gmp-error", () => fail("map error"));
  let earlyReject: ((e: Error) => void) | null = null;

  /* shapes */
  const homePolys = new Map<string, Shape3D>();
  const path = new Polyline3DElement({
    altitudeMode: "CLAMP_TO_GROUND",
    strokeColor: "rgba(255,255,255,0.55)",
    strokeWidth: 4,
    zIndex: 1,
    outerColor: "rgba(0,0,0,0.55)",
    outerWidth: 0.5,
    drawsOccludedSegments: true,
    geodesic: false,
  });
  const trail = new Polyline3DElement({
    altitudeMode: "CLAMP_TO_GROUND",
    strokeColor: "#ffffff",
    strokeWidth: 7,
    zIndex: 2,
    outerColor: "rgba(0,0,0,0.75)",
    outerWidth: 0.4,
    drawsOccludedSegments: true,
    geodesic: false,
  });
  // The API rejects an empty path: a line with fewer than two points is detached instead.
  const setLine = (el: Shape3D, pts: LatLngAlt[]) => {
    if (pts.length < 2) {
      if (el.isConnected) el.remove();
      return;
    }
    el.path = pts;
    if (el.parentNode !== map) map.append(el);
  };

  // The travelling dot: a plain marker moved along the path.
  const dot = new Marker3DElement({ altitudeMode: "RELATIVE_TO_GROUND", position: { lat: 0, lng: 0, altitude: 12 }, drawsWhenOccluded: true, sizePreserved: true, zIndex: 50 });
  {
    const t = document.createElement("template");
    t.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="10" fill="rgba(0,0,0,0.35)"/><circle cx="11" cy="11" r="6.5" fill="#fff" stroke="#000" stroke-width="2.5"/></svg>';
    dot.append(t);
  }
  let dotOn = false;
  const showDot = (at: { lat: number; lng: number } | null) => {
    if (!at) {
      if (dotOn) dot.remove();
      dotOn = false;
      return;
    }
    dot.position = { lat: at.lat, lng: at.lng, altitude: 12 };
    if (!dotOn) map.append(dot);
    dotOn = true;
  };

  const coords = () => stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  let travelledTo = -1;
  let travel: { from: LatLngAlt; to: LatLngAlt; t0: number; dur: number; toIdx: number } | null = null;
  let loopT = 0;
  let lastFrame = 0;
  let lastPaint = 0;
  let raf = 0;

  const setTrail = (pts: LatLngAlt[]) => {
    setLine(trail, pts);
  };

  function frame(now: number) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    // Moving 3D objects re-tessellates them: ~25 updates a second is plenty.
    const paint = now - lastPaint >= 40;
    let keep = false;
    const c = coords();
    if (travel) {
      const t = Math.min(1, (now - travel.t0) / travel.dur);
      const k = easeInOut(t);
      const p = { lat: travel.from.lat + (travel.to.lat - travel.from.lat) * k, lng: travel.from.lng + (travel.to.lng - travel.from.lng) * k };
      if (paint || t >= 1) {
        showDot(p);
        setTrail([...c.slice(0, travel.toIdx), p]);
        lastPaint = now;
      }
      if (t >= 1) {
        travelledTo = travel.toIdx;
        travel = null;
      }
      keep = true;
    } else if (idle && !o.reduced && c.length >= 2) {
      const legs = c.length - 1;
      const cycle = legs * 2600 + 1200;
      loopT = (loopT + dt) % cycle;
      const leg = Math.min(legs - 1, Math.floor(loopT / 2600));
      const k = easeInOut(Math.min(1, (loopT - leg * 2600) / 2600));
      if (paint) {
        showDot({ lat: c[leg].lat + (c[leg + 1].lat - c[leg].lat) * k, lng: c[leg].lng + (c[leg + 1].lng - c[leg].lng) * k });
        lastPaint = now;
      }
      keep = true;
    }
    if (keep) raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && active && !destroyed) {
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    }
  };

  /* pins: black with a white glyph; the home area red; the selected one inverted, larger and labelled */
  function pinFor(s: EngineStop, isSel: boolean): HTMLElement {
    const home = s.kind === "home_area";
    const pin = new PinElement({
      background: home ? DANGER : isSel ? "#ffffff" : "#000000",
      borderColor: home ? "#000000" : isSel ? "#000000" : "#ffffff",
      glyphSrc: glyphUrl(s.kind, home ? "#000" : isSel ? "#000" : "#fff", home ? DANGER : isSel ? "#fff" : "#000"),
      scale: isSel ? 1.55 : home ? 1.25 : 1.05,
    });
    // Current API: PinElement is itself the element; older builds expose `.element`.
    return pin instanceof HTMLElement ? pin : (pin.element as HTMLElement);
  }
  function renderMarker(rec: { el: Marker3D; stop: EngineStop; selected: boolean | null }) {
    const isSel = rec.stop.id === selected;
    const home = rec.stop.kind === "home_area";
    rec.el.label = home ? `${rec.stop.label} (approximate)` : isSel ? rec.stop.label : null;
    rec.el.title = home ? `${rec.stop.label}, approximate` : rec.stop.label;
    rec.el.zIndex = isSel ? 40 : home ? 20 : 10;
    if (rec.selected === isSel) return;
    rec.selected = isSel;
    rec.el.replaceChildren(pinFor(rec.stop, isSel));
  }

  function syncHome() {
    const homes = new Map(stops.filter((s) => s.kind === "home_area").map((s) => [s.id, s]));
    for (const [id, p] of homePolys) {
      if (homes.has(id)) continue;
      p.remove();
      homePolys.delete(id);
    }
    for (const [id, s] of homes) {
      const pts = circlePolygon(s.lng, s.lat, HOME_RADIUS_M).map(([lng, lat]) => ({ lat, lng }));
      let p = homePolys.get(id);
      if (!p) {
        p = new Polygon3DElement({
          altitudeMode: "CLAMP_TO_GROUND",
          fillColor: "rgba(255,95,82,0.24)",
          strokeColor: "rgba(255,95,82,0.95)",
          strokeWidth: 3,
          drawsOccludedSegments: true,
          path: pts,
        });
        homePolys.set(id, p);
        map.prepend(p);
      } else p.path = pts;
    }
  }
  function syncPath() {
    setLine(path, coords());
    if (o.reduced || !idle) {
      if (!travel) setTrail(coords().slice(0, travelledTo + 1));
    } else setTrail([]);
    if (o.reduced) showDot(null);
  }

  function fitCamera(): Camera | null {
    if (!stops.length) return null;
    let n = -90, s = 90, e = -180, w = 180;
    for (const st of stops) {
      const pts = st.kind === "home_area" ? circlePolygon(st.lng, st.lat, HOME_RADIUS_M).map(([lng, lat]) => ({ lat, lng })) : [st];
      for (const p of pts) {
        n = Math.max(n, p.lat);
        s = Math.min(s, p.lat);
        e = Math.max(e, p.lng);
        w = Math.min(w, p.lng);
      }
    }
    const center = { lat: (n + s) / 2, lng: (e + w) / 2, altitude: 0 };
    const ns = metresBetween({ lat: n, lng: center.lng }, { lat: s, lng: center.lng });
    const ew = metresBetween({ lat: center.lat, lng: e }, { lat: center.lat, lng: w });
    // A 35° field of view sees ~0.63 x range across; leave room for the caption card.
    const range = Math.min(4_000_000, Math.max(6000, Math.max(ns, ew * 0.75) * 2.3));
    return { center, range, tilt: range > 400_000 ? 20 : 42, heading: (camNow().heading + 360) % 360 };
  }

  /*
   * Ready once the element is live and Google has not rejected the key or the map for a moment.
   * (gmp-steadychange is not a usable signal: it does not fire on the first load, and a throttled
   * window renders too slowly to wait for frames.) Auth and map errors after this still fall back via onFail.
   */
  o.container.append(map);
  await new Promise<void>((resolve, reject) => {
    earlyReject = reject;
    window.setTimeout(resolve, 1200);
  }).catch((e) => {
    authListeners.delete(onAuth);
    map.remove();
    o.container.classList.remove("sv-google");
    throw e;
  });
  earlyReject = null;
  if (failed || destroyed) {
    map.remove();
    throw new Error("failed");
  }
  o.onReady();

  const engine: MapEngine = {
    setStops(next) {
      const ids = new Set(next.map((s) => s.id));
      for (const [id, rec] of markers) {
        if (ids.has(id)) continue;
        rec.el.remove();
        markers.delete(id);
      }
      for (const s of next) {
        const home = s.kind === "home_area";
        const rec = markers.get(s.id);
        const position = { lat: s.lat, lng: s.lng, altitude: home ? 60 : 30 };
        if (rec) {
          rec.el.position = position;
          rec.stop = s;
          renderMarker(rec);
          continue;
        }
        const el = new Marker3DInteractiveElement({
          position,
          altitudeMode: "RELATIVE_TO_GROUND",
          extruded: !home,
          drawsWhenOccluded: true,
          sizePreserved: true,
        });
        el.addEventListener("gmp-click", (ev) => {
          ev.stopPropagation();
          o.onSelect(s.id);
        });
        const r = { el, stop: s, selected: null as boolean | null };
        markers.set(s.id, r);
        renderMarker(r);
        map.append(el);
      }
      stops = next;
      syncHome();
      syncPath();
      kick();
    },
    select(id) {
      selected = id;
      for (const rec of markers.values()) renderMarker(rec);
    },
    goTo(id, { duration, from }) {
      const idx = stops.findIndex((s) => s.id === id);
      const s = stops[idx];
      if (!s) return;
      const cam = cameraFor(s);
      const heading = (360 + (-35 + hash(s.id) * 70)) % 360;
      fly({ center: { lat: s.lat, lng: s.lng, altitude: 0 }, range: cam.range, tilt: cam.tilt, heading }, Math.max(duration, 2400), "stop");
      if (o.reduced) {
        travelledTo = Math.max(travelledTo, idx);
        setTrail(coords().slice(0, idx + 1));
        return;
      }
      const fromIdx = from ? stops.findIndex((x) => x.id === from) : -1;
      if (fromIdx >= 0 && fromIdx === idx - 1) {
        travel = { from: stops[fromIdx], to: s, t0: performance.now(), dur: duration, toIdx: idx };
      } else {
        travel = null;
        travelledTo = idx;
        setTrail(coords().slice(0, idx + 1));
        showDot(s);
      }
      kick();
    },
    fitAll(animate) {
      const cam = fitCamera();
      if (!cam) return;
      fly(cam, animate ? 2200 : 0, idle ? "idle" : null);
      if (!animate && idle) startOrbit("idle");
    },
    setTheme() {
      // Photorealistic imagery has no dark/light variant; our chrome follows the theme in CSS.
    },
    setIdle(v) {
      idle = v;
      if (v) {
        travel = null;
        travelledTo = -1;
        setTrail([]);
        if (o.reduced) showDot(null);
      } else if (orbit === "idle") stopCamera();
      kick();
    },
    setActive(v) {
      if (v === active) return;
      active = v;
      if (!v) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        // Pause the camera off-screen; remember what to resume.
        resumeFlight = flight ? { cam: flight.cam, then: flight.then } : null;
        resumeOrbit = orbit;
        stopCamera();
      } else {
        const f = resumeFlight;
        const r = resumeOrbit;
        resumeFlight = null;
        resumeOrbit = null;
        if (f) fly(f.cam, 1200, f.then);
        else if (r) startOrbit(r);
        kick();
      }
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      authListeners.delete(onAuth);
      stopCamera();
      markers.clear();
      map.remove();
      o.container.classList.remove("sv-google");
    },
  };
  return engine;
};
