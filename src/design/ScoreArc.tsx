"use client";

import { NumberTicker } from "./NumberTicker";
import { riskColor } from "./risk";
import { cn } from "./utils";

const R = 44;
const SWEEP = 270;
const C = 2 * Math.PI * R;
const ARC = (SWEEP / 360) * C;

/**
 * 270° gauge: risk-coloured arc on a border-coloured track, number centred.
 * `score` null shows an empty track and a dash.
 */
export function ScoreArc({
  score,
  size = 180,
  label = "exposure",
  className,
  numberClassName,
}: {
  score: number | null;
  size?: number;
  label?: string;
  className?: string;
  numberClassName?: string;
}) {
  const v = score ?? 0;
  const color = score === null ? "var(--border)" : riskColor(v);
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} role="img" aria-label={score === null ? "Exposure not scored yet" : `Exposure ${Math.round(v)} out of 100`}>
      <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
        <g transform="rotate(135 50 50)">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--border)" strokeWidth="5" strokeDasharray={`${ARC} ${C}`} strokeLinecap="round" />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${(ARC * v) / 100} ${C}`}
            style={{ transition: "stroke-dasharray 900ms var(--ease-out), stroke 400ms ease" }}
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("sv-num block min-w-[2ch] text-center leading-none", numberClassName)} style={{ fontSize: size * 0.36 }}>
          {score === null ? "–" : <NumberTicker value={Math.round(v)} />}
        </span>
        <span className="mt-1 text-sm text-muted">{label}</span>
      </div>
    </div>
  );
}
