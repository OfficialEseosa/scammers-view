"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./places-map.css";
import type { Finding } from "@/lib/types";
import { extractPlaces, KIND_LABEL, parseSchedule, whyItMatters } from "@/lib/places/extract";
import type { GeocodedPlace, PlaceKind } from "@/lib/places/types";
import { EmptyState, ErrorState } from "@/design/states";

// Pins are CSS divIcons, so Leaflet's default marker PNG paths (broken under bundlers) are never used.
// Neutral pins with letter glyphs; colour only for risk (home area is the dangerous one).
const KIND_STYLE: Record<PlaceKind, { color: string; glyph: string; home?: boolean }> = {
  home_area: { color: "var(--danger)", glyph: "H", home: true },
  school: { color: "var(--text)", glyph: "S" },
  work: { color: "var(--text)", glyph: "W" },
  hangout: { color: "var(--text)", glyph: "R" },
  event: { color: "var(--text)", glyph: "E" },
  other: { color: "var(--text)", glyph: "P" },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function safeHref(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.href : null;
  } catch {
    return null;
  }
}

const EMPTY: Record<string, GeocodedPlace> = {};
const EMPTY_MISSING: Record<string, true> = {};

type Status = "pending" | "found" | "missing";

export default function PlacesMapInner({ findings, masked = false }: { findings: Finding[]; masked?: boolean }) {
  const candidates = useMemo(() => extractPlaces(findings), [findings]);
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const candKey = candidates.map((c) => `${c.findingId}|${c.kind}|${c.query}`).join("\n");

  type Res = { key: string; places: Record<string, GeocodedPlace>; missing: Record<string, true>; auth: boolean };
  const [res, setRes] = useState<Res>({ key: "", places: {}, missing: {}, auth: false });
  const fresh = res.key === candKey;
  const places = fresh ? res.places : EMPTY;
  const missing = fresh ? res.missing : EMPTY_MISSING;
  const authError = fresh && res.auth;
  const patch = (key: string, fn: (r: Res) => Partial<Res>) =>
    setRes((r) => {
      const base: Res = r.key === key ? r : { key, places: {}, missing: {}, auth: false };
      return { ...base, ...fn(base) };
    });
  const [selected, setSelected] = useState<string | null>(null);

  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const fitted = useRef(0);

  // Resolve candidates one request each so pins pop in as they arrive.
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    fitted.current = 0;
    for (const c of candidates) {
      fetch("/api/places/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates: [c] }),
        signal: ctrl.signal,
      })
        .then(async (r) => {
          if (!alive) return;
          if (r.status === 401) return patch(candKey, () => ({ auth: true }));
          const data: GeocodedPlace[] = r.ok ? await r.json() : [];
          if (!alive) return;
          if (data[0]) patch(candKey, (x) => ({ places: { ...x.places, [c.findingId]: data[0] } }));
          else patch(candKey, (x) => ({ missing: { ...x.missing, [c.findingId]: true } }));
        })
        .catch(() => {
          if (alive) patch(candKey, (x) => ({ missing: { ...x.missing, [c.findingId]: true } }));
        });
    }
    return () => {
      alive = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candKey]);

  const resolved = useMemo(
    () =>
      candidates.flatMap((c) => {
        const p = places[c.findingId];
        const f = byId.get(c.findingId);
        if (!p || !f) return [];
        const j = masked
          ? { lat: (hash(c.findingId + "a") - 0.5) * 0.03, lng: (hash(c.findingId + "b") - 0.5) * 0.04 }
          : { lat: 0, lng: 0 };
        return [{ c, p, f, lat: p.lat + j.lat, lng: p.lng + j.lng }];
      }),
    [candidates, places, byId, masked],
  );

  // Init map once.
  useEffect(() => {
    if (!mapEl.current || map.current) return;
    const m = L.map(mapEl.current, { zoomControl: true, scrollWheelZoom: false, worldCopyJump: true }).setView([30, 0], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const markerMap = markers.current;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
      markerMap.clear();
    };
  }, []);

  // Draw pins, approximation rings, routine line.
  useEffect(() => {
    const m = map.current;
    const lg = layer.current;
    if (!m || !lg) return;
    lg.clearLayers();
    markers.current.clear();

    for (const r of resolved) {
      const st = KIND_STYLE[r.c.kind];
      const approx = r.p.approximate;
      if (approx) {
        L.circle([r.lat, r.lng], {
          radius: 4000, color: st.home ? "#c2321f" : "#808080", weight: 1.5, dashArray: "4 6", fillOpacity: 0.06, interactive: false,
        }).addTo(lg);
      }
      const icon = L.divIcon({
        className: `sv-pin${approx ? " is-approx" : ""}`,
        html: `<div class="sv-pin-body${st.home ? " is-home" : ""}"><span>${st.glyph}</span></div>`,
        iconSize: [40, 40],
        iconAnchor: [4, 40],
        popupAnchor: [16, -40],
      });
      const mk = L.marker([r.lat, r.lng], {
        icon, title: masked ? KIND_LABEL[r.c.kind] : r.f.value, keyboard: true, riseOnHover: true,
      });
      mk.bindPopup(() => buildPopup(r.f, r.c.kind, r.p, masked), { className: "sv-popup", autoPanPadding: [24, 24] });
      mk.on("click", () => setSelected(r.c.findingId));
      mk.on("popupclose", () => setSelected((s) => (s === r.c.findingId ? null : s)));
      mk.addTo(lg);
      markers.current.set(r.c.findingId, mk);
    }

    // Routine: home -> school -> work -> scheduled spots in weekly order.
    const hasSchedule = resolved.some((r) => r.f.category === "schedule");
    if (hasSchedule) {
      const rank = (k: PlaceKind) => ({ home_area: 0, school: 1, work: 2, hangout: 3, event: 3, other: 3 })[k];
      const nodes = resolved
        .filter((r) => r.f.category === "schedule" || r.c.kind === "home_area" || r.c.kind === "school" || r.c.kind === "work")
        .sort((a, b) => {
        const d = rank(a.c.kind) - rank(b.c.kind);
        if (d) return d;
        return (parseSchedule(a.f.value)?.order ?? 0) - (parseSchedule(b.f.value)?.order ?? 0);
      });
      if (nodes.length >= 2) {
        L.polyline(
          nodes.map((n) => [n.lat, n.lng] as [number, number]),
          { color: "#8a8a8a", weight: 2.5, opacity: 0.9, dashArray: "6 8", className: "sv-routine", interactive: false },
        ).addTo(lg);
      }
    }

    if (resolved.length && fitted.current !== resolved.length) {
      fitted.current = resolved.length;
      const b = L.latLngBounds(resolved.map((r) => [r.lat, r.lng] as [number, number]));
      m.flyToBounds(b, { padding: [60, 60], maxZoom: 12, duration: 0.8 });
    }
  }, [resolved, masked]);

  // Reflect selection on pins.
  useEffect(() => {
    markers.current.forEach((mk, id) => mk.getElement()?.classList.toggle("is-selected", id === selected));
  }, [selected, resolved]);

  const selectFromList = (id: string) => {
    const mk = markers.current.get(id);
    if (!mk || !map.current) return;
    setSelected(id);
    map.current.flyTo(mk.getLatLng(), Math.max(map.current.getZoom(), 11), { duration: 0.6 });
    mk.openPopup();
  };

  const status = (id: string): Status => (places[id] ? "found" : missing[id] ? "missing" : "pending");
  const doneCount = candidates.filter((c) => status(c.findingId) !== "pending").length;
  const hasRoutine = resolved.some((r) => r.f.category === "schedule") && resolved.length >= 2;

  if (candidates.length === 0) {
    return (
      <EmptyState>No places in what was found.</EmptyState>
    );
  }

  return (
    <section aria-label="Places a stranger can pin down" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-muted" aria-live="polite">
          <span className="text-sm">
            {doneCount < candidates.length
              ? `Locating ${doneCount + 1} of ${candidates.length}…`
              : `${resolved.length} of ${candidates.length} places pinned`}
          </span>
          {hasRoutine && (
            <span className="flex items-center gap-2 text-sm text-fg">
              <svg width="28" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="28" y2="3" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6 5" />
              </svg>
              Weekly routine
            </span>
          )}
        </div>
        <div
          ref={mapEl}
          className="sv-map h-[56vh] min-h-[340px] w-full overflow-hidden rounded-card border border-edge lg:h-[min(640px,70vh)]"
        />
        {authError && <ErrorState className="mt-3" title="Sign in to see your places on the map" />}
      </div>

      <ol className="flex min-w-0 flex-col divide-y divide-edge border-y border-edge lg:max-h-[min(680px,75vh)] lg:overflow-y-auto">
        {candidates.map((c) => {
          const f = byId.get(c.findingId);
          if (!f) return null;
          const st = status(c.findingId);
          const style = KIND_STYLE[c.kind];
          const p = places[c.findingId];
          return (
            <li key={c.findingId}>
              <button
                type="button"
                disabled={st !== "found"}
                onClick={() => selectFromList(c.findingId)}
                aria-current={selected === c.findingId}
                className={`flex min-h-16 w-full items-center gap-3 px-2 py-2 text-left transition-colors ${
                  selected === c.findingId ? "bg-surface" : "hover:bg-surface"
                } ${st === "pending" ? "sv-sweep relative overflow-hidden" : ""} ${st === "missing" ? "opacity-50" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-9 shrink-0 place-items-center rounded-full font-display text-base font-semibold ${style.home ? "bg-danger text-black" : "bg-fg text-canvas"}`}
                >
                  {style.glyph}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold">
                    {masked ? KIND_LABEL[c.kind] : f.value}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {st === "pending" && "Locating…"}
                    {st === "missing" && "Couldn't place this one"}
                    {st === "found" &&
                      p &&
                      (masked ? "Pinned, details hidden" : p.approximate ? `${p.displayName} (approximate)` : p.displayName)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
}

// Built with textContent only: finding values come from the open web.
function buildPopup(f: Finding, kind: PlaceKind, p: GeocodedPlace, masked: boolean): HTMLElement {
  const root = el("div", "");
  root.append(el("div", "sv-kind", KIND_LABEL[kind]));
  if (masked) {
    root.append(el("div", "sv-fact", "A place tied to you"));
  } else {
    root.append(el("div", "sv-fact", f.value));
    root.append(
      el("div", "sv-meta", p.approximate ? `${p.displayName}. Shown as the city only, never your address.` : p.displayName),
    );
  }
  root.append(el("div", "sv-why", whyItMatters(f, kind)));
  const href = masked ? null : safeHref(f.sourceUrl);
  if (href) {
    const meta = el("div", "sv-meta");
    meta.style.marginTop = "8px";
    const a = el("a", "", f.sourceTitle || new URL(href).hostname);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    meta.append("Found on ", a);
    root.append(meta);
  }
  return root;
}
