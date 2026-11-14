"use client";

import { useState, type ReactNode } from "react";
import { RiskDot } from "@/design/Badge";
import { RedactedValue } from "@/design/RedactedValue";
import { weightLevel, RISK_LABEL } from "@/design/risk";
import { cn } from "@/design/utils";
import { proxiedUrl } from "@/lib/face/image";
import type { ItemState } from "./client";
import { Button } from "@/design/Button";

/** Small provenance mark for anything Gemini read. */
export function GeminiMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-chip border border-edge px-2 py-0.5 text-xs font-medium text-muted", className)}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path d="M6 0c.4 3.2 2.8 5.6 6 6-3.2.4-5.6 2.8-6 6-.4-3.2-2.8-5.6-6-6 3.2-.4 5.6-2.8 6-6Z" fill="currentColor" />
      </svg>
      Read by Gemini
    </span>
  );
}

/** Remote image: original URL first, our hardened relay as fallback. Blurred in presentation mode. */
export function RemoteImage({ url, alt, masked, children, className }: { url: string; alt: string; masked: boolean; children?: ReactNode; className?: string }) {
  const [src, setSrc] = useState(url);
  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts */}
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        className={cn("block h-auto w-full", masked && "blur-xl grayscale")}
        onError={() => {
          if (src === url && url.startsWith("https://")) setSrc(proxiedUrl(url));
        }}
      />
      {!masked && children}
    </div>
  );
}

/** One fact as a chip: risk dot, label, value (redacted in presentation mode). */
export function FactChip({
  label,
  value,
  risk,
  masked,
  index,
  meta,
  active,
  onActive,
}: {
  label: string;
  value: string;
  risk: number;
  masked: boolean;
  index?: number;
  meta?: string;
  active?: boolean;
  onActive?: (on: boolean) => void;
}) {
  const level = weightLevel(risk);
  return (
    <li>
      <button
        type="button"
        onPointerEnter={() => onActive?.(true)}
        onPointerLeave={() => onActive?.(false)}
        onFocus={() => onActive?.(true)}
        onBlur={() => onActive?.(false)}
        className={cn(
          "flex w-full items-start gap-2 rounded-control border px-3 py-2 text-left transition-colors",
          active ? "border-fg" : "border-edge hover:border-edge-strong",
        )}
      >
        {index !== undefined && (
          <span aria-hidden className="sv-num mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-fg text-xs font-semibold text-canvas">
            {index + 1}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm text-muted">
            <RiskDot level={level} label={RISK_LABEL[level]} />
            {label}
            {meta && <span className="sv-num ml-auto text-xs">{meta}</span>}
          </span>
          <RedactedValue value={value} redacted={masked} mono={false} className="block font-medium text-fg" />
        </span>
      </button>
    </li>
  );
}

/** Per-item action: Analyse / reading / retry / skipped. */
export function ItemAction({ state, onRun, disabled }: { state: ItemState; onRun: () => void; disabled?: boolean }) {
  if (state.k === "busy")
    return (
      <p className="flex min-h-11 items-center gap-2 text-sm text-muted" aria-live="polite">
        <span aria-hidden className="sv-pulse inline-block size-2 rounded-full bg-fg" />
        Gemini is reading
      </p>
    );
  if (state.k === "skipped") return <p className="text-sm text-muted">Skipped: {state.reason}</p>;
  if (state.k === "done") return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="secondary" onClick={onRun} disabled={disabled}>
        {state.k === "failed" ? "Try again" : "Analyse"}
      </Button>
      {state.k === "failed" && <span className="text-sm text-danger-fg">{state.message}</span>}
    </div>
  );
}

export function usageLine(u?: { model: string; ms: number; costUsd?: number }) {
  if (!u || u.model === "fixture") return undefined;
  const s = `${(u.ms / 1000).toFixed(1)} s`;
  return u.costUsd !== undefined ? `${s} · $${u.costUsd.toFixed(4)}` : s;
}
