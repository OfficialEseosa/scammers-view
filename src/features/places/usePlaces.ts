"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Finding } from "@/lib/types";
import { buildTour, extractPlaces, type TourStop } from "@/lib/places/extract";
import type { GeocodedPlace, PlaceCandidate } from "@/lib/places/types";

/**
 * Geocodes the candidates through POST /api/places/geocode.
 * One candidate per request so pins drop in as each resolves, four in flight
 * at a time (Google has no per-second rule; the server still queues any
 * Nominatim fallback at 1 request/second). Results are cached for the tab.
 */

const CONCURRENCY = 4;
const clientCache = new Map<string, GeocodedPlace | null>();
const keyOf = (c: PlaceCandidate) => `${c.kind === "home_area" ? "home" : "pin"}:${c.region ?? "-"}:${c.query.toLowerCase()}`;

const EMPTY_PLACES: Record<string, GeocodedPlace> = {};
const EMPTY_MISSING: Record<string, true> = {};

type Res = { key: string; places: Record<string, GeocodedPlace>; missing: Record<string, true>; auth: boolean };

export interface PlacesState {
  stops: TourStop[];
  /** Candidates still waiting on a geocode. */
  pending: number;
  authError: boolean;
  retry: (id: string) => void;
}

export function usePlaces(findings: Finding[], masked: boolean): PlacesState {
  const candidates = useMemo(() => extractPlaces(findings), [findings]);
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const candKey = candidates.map((c) => `${c.findingId}|${c.kind}|${c.region ?? ""}|${c.query}`).join("\n");

  const [res, setRes] = useState<Res>({ key: "", places: {}, missing: {}, auth: false });
  const fresh = res.key === candKey;

  const patch = useCallback(
    (key: string, fn: (r: Res) => Partial<Res>) =>
      setRes((r) => {
        const base: Res = r.key === key ? r : { key, places: {}, missing: {}, auth: false };
        return { ...base, ...fn(base) };
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const settle = (c: PlaceCandidate, p: GeocodedPlace | null) => {
      if (!alive) return;
      if (p) patch(candKey, (x) => ({ places: { ...x.places, [c.findingId]: { ...p, findingId: c.findingId } } }));
      else patch(candKey, (x) => ({ missing: { ...x.missing, [c.findingId]: true } }));
    };
    const queue: PlaceCandidate[] = [];
    for (const c of candidates) {
      const hit = clientCache.get(keyOf(c));
      if (hit !== undefined) settle(c, hit);
      else queue.push(c);
    }
    const worker = async () => {
      for (let c = queue.shift(); c && alive; c = queue.shift()) {
        try {
          const r = await fetch("/api/places/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidates: [c] }),
            signal: ctrl.signal,
          });
          if (r.status === 401) {
            if (alive) patch(candKey, () => ({ auth: true }));
            queue.length = 0;
            return;
          }
          if (!r.ok) {
            settle(c, null); // transient: not cached, so a retry can succeed
            continue;
          }
          const data = (await r.json()) as GeocodedPlace[];
          clientCache.set(keyOf(c), data[0] ?? null);
          settle(c, data[0] ?? null);
        } catch {
          if (!ctrl.signal.aborted) settle(c, null);
        }
      }
    };
    for (let i = 0; i < CONCURRENCY; i++) void worker();
    return () => {
      alive = false;
      ctrl.abort();
    };
    // candKey captures `candidates`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candKey, patch]);

  const places = fresh ? res.places : EMPTY_PLACES;
  const missing = fresh ? res.missing : EMPTY_MISSING;
  const stops = useMemo(() => buildTour(candidates, byId, places, missing, masked), [candidates, byId, places, missing, masked]);
  // Retry one stop that failed (network or upstream error; a real "no match" is cached and stays missing).
  const retry = useCallback(
    (id: string) => {
      const c = candidates.find((x) => x.findingId === id);
      if (!c) return;
      clientCache.delete(keyOf(c));
      patch(candKey, (x) => {
        const missing = { ...x.missing };
        delete missing[c.findingId];
        return { missing };
      });
      fetch("/api/places/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidates: [c] }) })
        .then(async (r) => (r.ok ? ((await r.json()) as GeocodedPlace[]) : []))
        .catch(() => [] as GeocodedPlace[])
        .then((data) => {
          if (data[0]) {
            clientCache.set(keyOf(c), data[0]);
            patch(candKey, (x) => ({ places: { ...x.places, [c.findingId]: { ...data[0], findingId: c.findingId } } }));
          } else patch(candKey, (x) => ({ missing: { ...x.missing, [c.findingId]: true } }));
        });
    },
    [candidates, candKey, patch],
  );

  return {
    stops,
    pending: stops.filter((s) => s.status === "pending").length,
    authError: fresh && res.auth,
    retry,
  };
}
