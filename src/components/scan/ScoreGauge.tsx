"use client";

import { useEffect, useRef, useState } from "react";
import type { ExposureScore, Finding } from "@/lib/types";
import { scoreColor } from "@/components/scan/meta";
import { maskIn, maskValue } from "@/components/scan/mask";

const R = 84;
const C = 2 * Math.PI * R;

function useCountUp(target: number | null, ms = 1800) {
  const [shown, setShown] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (target === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      raf.current = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(raf.current);
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return target === null ? 0 : shown;
}

export function ScoreGauge({
  score,
  findings,
  masked,
}: {
  score: ExposureScore | null;
  findings: Finding[];
  masked: boolean;
}) {
  const shown = useCountUp(score ? score.score : null);
  const color = score ? scoreColor(shown) : "var(--line)";
  const top = score ? score.topFindingIds.map((id) => findings.find((f) => f.id === id)).filter((f): f is Finding => !!f) : [];

  return (
    <section aria-label="Exposure score" className="rounded-2xl border border-line bg-panel p-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="relative size-32 shrink-0 sm:size-48">
          <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="100" cy="100" r={R} fill="none" stroke="var(--line)" strokeWidth="14" />
            <circle
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - shown / 100)}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-5xl font-semibold leading-none tabular-nums sm:text-7xl" style={{ color: score ? color : undefined }}>
              {score ? shown : "--"}
            </span>
            <span className="mt-1 text-sm text-muted">exposure</span>
          </div>
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <h2 className="font-display text-2xl font-semibold">Exposure score</h2>
          <p className="mt-2 text-muted" aria-live="polite">
            {score ? maskIn(score.summary, findings, masked) : "Calculated once the search finishes. Higher means easier to impersonate."}
          </p>
        </div>
      </div>

      {top.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="font-display text-lg font-semibold">What a scammer would use first</h3>
          <ol className="mt-3 space-y-2">
            {top.map((f, i) => (
              <li key={f.id} className="flex items-baseline gap-3 rounded-lg bg-panel-2 px-4 py-2.5">
                <span className="font-display text-lg text-signal">{i + 1}</span>
                <span className="text-muted">{f.label}</span>
                <span className="ml-auto truncate font-mono">{masked ? maskValue(f.value, f.category) : f.value}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
