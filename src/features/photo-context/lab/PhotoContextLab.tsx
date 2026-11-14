"use client";

import { useState } from "react";
import type { Finding } from "@/lib/types";
import { RiskDot } from "@/design/Badge";
import { weightLevel } from "@/design/risk";
import { PhotoContext } from "../PhotoContext";
import { VideoContext } from "../VideoContext";
import { LAB_PHOTO_FIXTURE, LAB_PHOTOS, LAB_VIDEO_FIXTURE, LAB_VIDEOS } from "../fixtures";

/**
 * Dev harness: CC0 sample photos (fetched from Wikimedia Commons at runtime)
 * and our own fictional clip. Fixture mode needs no key and no network to
 * Gemini; Live mode calls /api/vision/* (signed-in or DEV_SCAN_SUBJECT).
 */
export function PhotoContextLab() {
  const [live, setLive] = useState(false);
  const [masked, setMasked] = useState(false);
  const [photoFindings, setPhotoFindings] = useState<Finding[]>([]);
  const [videoFindings, setVideoFindings] = useState<Finding[]>([]);
  const merged = [...photoFindings, ...videoFindings];

  return (
    <div className="flex flex-col gap-14">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
        <label className="flex min-h-10 items-center gap-2">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="size-5" />
          Live Gemini
        </label>
        <label className="flex min-h-10 items-center gap-2">
          <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} className="size-5" />
          Presentation mode
        </label>
        <span>{live ? "Sends the samples to Google Gemini." : "Fixture answers. Nothing is sent."}</span>
      </div>

      <PhotoContext key={`p-${live}`} photos={LAB_PHOTOS} masked={masked} onFindings={setPhotoFindings} fixture={live ? undefined : LAB_PHOTO_FIXTURE} showUsage />
      <VideoContext key={`v-${live}`} findings={LAB_VIDEOS} masked={masked} onFindings={setVideoFindings} fixture={live ? undefined : LAB_VIDEO_FIXTURE} showUsage />

      <section aria-label="Merged findings" className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-semibold">Findings merged into the scan ({merged.length})</h2>
        <ul className="flex flex-col divide-y divide-edge rounded-card border border-edge">
          {merged.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <RiskDot level={weightLevel(f.riskWeight)} />
              <span className="font-medium">{f.label}</span>
              <span className="text-muted">{masked ? "hidden" : f.value}</span>
              <span className="ml-auto text-xs text-muted">
                {f.category} · {f.anchor} · risk {f.riskWeight}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted">
        Photos: Wikimedia Commons, CC0 (Annie Spratt; Mnation2; Calettso2). Video: fictional render made for this lab.
      </p>
    </div>
  );
}
