"use client";

import dynamic from "next/dynamic";
import type { Finding } from "@/lib/types";

const Inner = dynamic(() => import("./PlacesMapInner"), {
  ssr: false,
  loading: () => (
    <div className="sv-skeleton h-[60vh] min-h-[360px] rounded-card" aria-label="Loading map" />
  ),
});

export interface PlacesMapProps {
  findings: Finding[];
  /** Projector mode: kind-only labels, jittered pins, no source links. */
  masked?: boolean;
}

export function PlacesMap(props: PlacesMapProps) {
  return <Inner {...props} />;
}

export default PlacesMap;
