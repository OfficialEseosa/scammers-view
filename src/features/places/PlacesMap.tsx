"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import type { Finding } from "@/lib/types";

/** Skeleton shaped like the tour: the map hero, then the stops rail. */
function TourSkeleton() {
  return (
    <div role="status" aria-label="Loading map" className="flex flex-col gap-6">
      <div className="sv-skeleton h-[55svh] min-h-[320px] rounded-card md:h-[clamp(520px,70vh,860px)]" />
      <div className="flex gap-2 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="sv-skeleton block h-16 w-64 shrink-0 rounded-control" />
        ))}
      </div>
    </div>
  );
}

// The tour shell is small; Google 3D, MapLibre or Leaflet is imported inside it only once it mounts.
const Tour = dynamic(() => import("./PlacesTour"), { ssr: false, loading: TourSkeleton });

export interface PlacesMapProps {
  findings: Finding[];
  /** Projector mode: kind-only labels, jittered pins, no source links. */
  masked?: boolean;
}

type EngineKind = "google" | "gl" | "leaflet";

const noop = () => () => {};
// Google 3D first when a browser key is configured; MapLibre otherwise.
const DEFAULT_ENGINE: EngineKind = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? "google" : "gl";
/** `?map=google|gl|leaflet` picks the first engine to try (for testing); failures still fall down the chain. */
const pickEngine = (): EngineKind => {
  const q = new URLSearchParams(window.location.search).get("map");
  return q === "leaflet" || q === "gl" || q === "google" ? q : DEFAULT_ENGINE;
};

export function PlacesMap(props: PlacesMapProps) {
  const engine = useSyncExternalStore(noop, pickEngine, () => DEFAULT_ENGINE);
  return <Tour {...props} engine={engine} />;
}

export default PlacesMap;
