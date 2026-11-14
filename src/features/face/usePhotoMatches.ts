"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_MATCH_THRESHOLD, matchFaces } from "@/lib/face/match";
import { getFaceReference, subscribeFaceReference } from "@/lib/face/store";
import type { FaceReference, MatchResult } from "@/lib/face/types";
import type { Finding } from "@/lib/types";

export interface PhotoMatchState {
  finding: Finding;
  result?: MatchResult;
}

/** The current in-memory reference face (null before a passed scan / after clearFaceData). */
export function useFaceReference(): FaceReference | null {
  return useSyncExternalStore(subscribeFaceReference, getFaceReference, () => null);
}

const EMPTY = new Map<string, MatchResult>();

/**
 * Progressively match findings that carry an imageUrl against the reference,
 * one image at a time. Findings appended later (streaming scan) are picked up.
 */
export function usePhotoMatches(
  findings: Finding[],
  reference: FaceReference | null,
  { threshold = DEFAULT_MATCH_THRESHOLD }: { threshold?: number } = {},
) {
  const withImages = useMemo(() => {
    const seen = new Set<string>();
    return findings.filter((f) => {
      if (!f.imageUrl || seen.has(f.imageUrl)) return false;
      seen.add(f.imageUrl);
      return true;
    });
  }, [findings]);
  const allKey = withImages.map((f) => f.imageUrl).join("\n");

  const [state, setState] = useState<{ ref: FaceReference | null; map: Map<string, MatchResult> }>({
    ref: null,
    map: EMPTY,
  });
  // Results belong to one reference; a new scan or clearFaceData() resets them.
  const map = reference && state.ref === reference ? state.map : EMPTY;
  const mapRef = useRef(map);
  useEffect(() => {
    mapRef.current = map;
  });

  useEffect(() => {
    if (!reference || !reference.descriptors.length || !allKey) return;
    const urls = allKey.split("\n").filter((u) => !mapRef.current.has(u));
    if (!urls.length) return;
    const controller = new AbortController();
    void matchFaces(reference, urls, {
      threshold,
      signal: controller.signal,
      onResult: (r) => {
        if (controller.signal.aborted) return;
        setState((prev) => {
          const next = new Map(prev.ref === reference ? prev.map : EMPTY);
          next.set(r.imageUrl, r);
          return { ref: reference, map: next };
        });
      },
    }).catch(() => {});
    return () => controller.abort();
  }, [reference, allKey, threshold]);

  const items: PhotoMatchState[] = withImages.map((finding) => ({ finding, result: map.get(finding.imageUrl!) }));
  const pending = items.filter((i) => !i.result);

  return {
    items,
    matched: items.filter((i) => i.result?.matched),
    notMatched: items.filter((i) => i.result && !i.result.matched),
    pending,
    running: !!reference && pending.length > 0,
  };
}
