"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LivenessScan } from "../LivenessScan";
import { MeshStillTest } from "./MeshStillTest";
import { PhotoMatches } from "../PhotoMatches";
import { useFaceReference } from "../usePhotoMatches";
import { clearFaceData, setFaceReference } from "@/lib/face/store";
import { DEFAULT_MATCH_THRESHOLD, matchFaces } from "@/lib/face/match";
import { pairwiseDistancesForTesting, referenceFromSampleImagesForTesting } from "@/lib/face/testing";
import type { LivenessResult } from "@/lib/face/types";
import type { Finding } from "@/lib/types";

/**
 * DEV HARNESS ONLY (rendered by /lab/face, which 404s outside `next dev`).
 * Image URLs are typed in at runtime; none are stored in the repo.
 */

function lines(text: string) {
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function FrameThumb({ canvas, label }: { canvas: HTMLCanvasElement; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !canvas.width) return;
    el.width = 160;
    el.height = Math.round((160 * canvas.height) / canvas.width);
    el.getContext("2d")?.drawImage(canvas, 0, 0, el.width, el.height);
    return () => {
      el.width = 0;
    };
  }, [canvas]);
  return (
    <figure className="flex flex-col gap-1">
      <canvas ref={ref} className="w-28 -scale-x-100 rounded-lg border border-edge" />
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  );
}

export function FaceLab() {
  const reference = useFaceReference();
  // Dev-harness hook for scripted checks (lab page only, development only).
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__faceLab = {
      pairwise: pairwiseDistancesForTesting,
      async matchAgainstSamples(refUrls: string[], candidateUrls: string[], threshold = DEFAULT_MATCH_THRESHOLD) {
        const ref = await referenceFromSampleImagesForTesting(refUrls);
        try {
          return await matchFaces(ref, candidateUrls, { threshold });
        } finally {
          for (const d of ref.descriptors) d.fill(0);
        }
      },
    };
    return () => {
      delete w.__faceLab;
    };
  }, []);
  const [live, setLive] = useState<LivenessResult | null>(null);
  const [scanKey, setScanKey] = useState(0);
  const [candidates, setCandidates] = useState("");
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(DEFAULT_MATCH_THRESHOLD);

  const [refUrls, setRefUrls] = useState("");
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [pairUrls, setPairUrls] = useState("");
  const [pairs, setPairs] = useState<{ urls: string[]; matrix: (number | null)[][] } | null>(null);

  const findings: Finding[] = useMemo(
    () =>
      submitted.map((url, i) => ({
        id: `lab-${i}`,
        category: "photo",
        label: `Sample ${i + 1}`,
        value: url,
        sourceType: "web",
        sourceUrl: url,
        sourceTitle: `Sample ${i + 1}`,
        imageUrl: url,
        anchor: "unconfirmed",
        confidence: 0.5,
        riskWeight: 3,
        foundAt: new Date(0).toISOString(),
      })),
    [submitted],
  );

  return (
    <div className="flex flex-col gap-12">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,28rem)_1fr]">
        <LivenessScan key={scanKey} onComplete={setLive} />
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-semibold">Scan result</h2>
          {live ? (
            <>
              <p className="text-muted">
                Passed. Order asked: {live.order.join(", then ")}. Same-face distances: left{" "}
                {live.consistency.left.toFixed(3)}, right {live.consistency.right.toFixed(3)}.
              </p>
              <div className="flex gap-3">
                <FrameThumb canvas={live.frames.front} label="front" />
                <FrameThumb canvas={live.frames.left} label="left" />
                <FrameThumb canvas={live.frames.right} label="right" />
              </div>
            </>
          ) : (
            <p className="text-muted">No passed scan yet.</p>
          )}
          <p className="text-sm text-muted" data-testid="reference-status">
            Reference in memory: {reference ? `${reference.descriptors.length} descriptors` : "none"}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="min-h-11 rounded-xl border border-edge px-4 hover:bg-surface"
              onClick={() => {
                clearFaceData();
                setLive(null);
                setScanKey((k) => k + 1);
                setTestStatus(null);
              }}
            >
              Clear face data
            </button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-semibold">Candidate photos</h2>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-muted">Image URLs, one per line (https)</span>
          <textarea
            className="min-h-28 rounded-xl border border-edge bg-surface p-3 font-mono text-sm"
            value={candidates}
            onChange={(e) => setCandidates(e.target.value)}
            name="candidates"
          />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="min-h-11 rounded-xl bg-paper px-5 font-semibold text-canvas"
            onClick={() => setSubmitted(lines(candidates))}
          >
            Match photos
          </button>
          <label className="flex items-center gap-2 text-sm">
            Threshold
            <input
              type="number"
              step="0.01"
              min="0.3"
              max="0.8"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value) || DEFAULT_MATCH_THRESHOLD)}
              className="w-20 rounded-lg border border-edge bg-surface px-2 py-1"
            />
          </label>
        </div>
        <PhotoMatches
          key={threshold}
          findings={findings}
          threshold={threshold}
          clearOnUnmount={false}
          showDistances
        />
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-dashed border-edge-strong p-5">
        <h2 className="font-display text-xl font-semibold">No-camera test path (development only)</h2>
        <p className="max-w-[70ch] text-sm text-muted">
          Builds a reference from sample image URLs so the matching pipeline can be checked without a camera. This exists
          only in this dev harness and throws in production; the product only accepts a live scan.
        </p>
        <MeshStillTest />
        <label className="flex flex-col gap-2">
          <span className="text-sm text-muted">Reference sample URLs</span>
          <textarea
            className="min-h-20 rounded-xl border border-edge bg-surface p-3 font-mono text-sm"
            value={refUrls}
            onChange={(e) => setRefUrls(e.target.value)}
            name="reference-samples"
          />
        </label>
        <button
          type="button"
          className="min-h-11 self-start rounded-xl border border-edge-strong px-4"
          onClick={async () => {
            setTestStatus("Loading…");
            try {
              const ref = await referenceFromSampleImagesForTesting(lines(refUrls));
              setFaceReference(ref);
              setTestStatus(`Test reference set from ${ref.descriptors.length} images.`);
            } catch (e) {
              setTestStatus(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Use as test reference
        </button>
        {testStatus && <p className="text-sm" data-testid="test-status">{testStatus}</p>}

        <label className="flex flex-col gap-2">
          <span className="text-sm text-muted">Pairwise distances: image URLs</span>
          <textarea
            className="min-h-20 rounded-xl border border-edge bg-surface p-3 font-mono text-sm"
            value={pairUrls}
            onChange={(e) => setPairUrls(e.target.value)}
            name="pair-samples"
          />
        </label>
        <button
          type="button"
          className="min-h-11 self-start rounded-xl border border-edge-strong px-4"
          onClick={async () => {
            setPairs(null);
            setPairs(await pairwiseDistancesForTesting(lines(pairUrls)));
          }}
        >
          Compute distances
        </button>
        {pairs && (
          <pre className="overflow-x-auto text-xs" data-testid="pairs">
            {JSON.stringify(pairs, null, 1)}
          </pre>
        )}
      </section>
    </div>
  );
}
