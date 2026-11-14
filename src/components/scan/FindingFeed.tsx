"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Finding } from "@/lib/types";
import { ANCHOR_LABEL, hostOf, safeHref } from "@/components/scan/meta";
import { maskIn } from "@/components/scan/mask";
import { Icon3D, CATEGORY_ICON } from "@/design/Icon3D";
import { RedactedValue } from "@/design/RedactedValue";
import { AnchorBadge, ConfidenceMeter, RiskDot } from "@/design/Badge";
import { weightLevel } from "@/design/risk";
import { EASE_OUT, usePrefersReducedMotion } from "@/design/motion";
import { NotMeButton } from "@/components/scan/NotMe";

function Row({ f, masked, all }: { f: Finding; masked: boolean; all: Finding[] }) {
  const href = safeHref(f.sourceUrl);
  const host = hostOf(f.sourceUrl);
  const level = weightLevel(f.riskWeight);
  return (
    <details className="group">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 hover:bg-surface [&::-webkit-details-marker]:hidden">
        <Icon3D name={CATEGORY_ICON[f.category]} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-muted">{f.label}</span>
          <span className="block truncate text-base">
            <RedactedValue value={f.value} redacted={masked} label={f.label} />
          </span>
        </span>
        <RiskDot level={level} label={`Risk ${f.riskWeight} of 10`} />
      </summary>
      <div className="flex flex-col gap-3 border-t border-edge bg-surface px-3 pb-4 pt-3 pl-[3.6rem]">
        {f.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts
          <img src={f.imageUrl} alt="" className={`h-28 w-full rounded-control object-cover ${masked ? "blur-xl grayscale" : ""}`} loading="lazy" />
        )}
        {f.snippet && <p className="text-sm text-muted">&ldquo;{maskIn(f.snippet, all, masked)}&rdquo;</p>}
        <div className="flex flex-wrap items-center gap-2">
          <AnchorBadge weak={f.anchor === "unconfirmed"}>{ANCHOR_LABEL[f.anchor]}</AnchorBadge>
          <ConfidenceMeter value={f.confidence} />
        </div>
        {f.sources && f.sources.length > 1 && (
          <div className="text-sm">
            <p className="text-muted">Seen in {f.sources.length} places</p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {f.sources.map((x) => (
                <li key={x.url} className="sv-evidence">
                  {hostOf(x.url)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="sv-evidence self-start text-sm underline underline-offset-4 hover:text-muted">
            {host}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span className="sv-evidence text-sm text-muted">{host}</span>
        )}
      </div>
    </details>
  );
}

export function FindingFeed({
  findings,
  masked,
  running,
  onNotMe,
  selectable = false,
}: {
  findings: Finding[];
  masked: boolean;
  running: boolean;
  /** Adds a "Not me" action per row (and bulk marking when `selectable`). */
  onNotMe?: (fs: Finding[]) => void;
  selectable?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const bulk = selectable && !!onNotMe;
  const chosen = findings.filter((f) => picked.has(f.id));
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  if (findings.length === 0) {
    return running ? (
      <div className="flex flex-col gap-4 p-4" role="status" aria-label="Searching">
        {[70, 52, 84, 60].map((w) => (
          <div key={w} className="flex items-center gap-3">
            <span className="sv-skeleton block size-8 rounded-control" />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="sv-skeleton block h-2.5 w-20" />
              <span className="sv-skeleton block h-3.5" style={{ width: `${w}%` }} />
            </span>
          </div>
        ))}
      </div>
    ) : (
      <p className="p-6 text-muted">Nothing public turned up.</p>
    );
  }
  return (
    <>
      {bulk && (
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
          {selecting ? (
            <>
              <button
                type="button"
                disabled={!chosen.length}
                onClick={() => {
                  onNotMe(chosen);
                  stopSelecting();
                }}
                className="sv-press min-h-11 rounded-control bg-accent px-4 text-sm font-semibold text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Mark selected as not me{chosen.length ? ` (${chosen.length})` : ""}
              </button>
              <button type="button" onClick={stopSelecting} className="min-h-11 px-3 text-sm text-muted underline underline-offset-4 hover:text-fg">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setSelecting(true)} className="min-h-11 text-sm text-muted underline underline-offset-4 hover:text-fg">
              Select several
            </button>
          )}
        </div>
      )}
      <ul className="divide-y divide-edge" aria-label="Findings">
        <AnimatePresence initial={false}>
          {findings.map((f) => (
            <motion.li
              key={f.id}
              layout={reduced ? false : "position"}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.15 : 0.24, ease: EASE_OUT }}
              className="flex items-start"
            >
              {bulk && selecting && (
                <label className="grid min-h-14 w-11 shrink-0 cursor-pointer place-items-center pl-2">
                  <input
                    type="checkbox"
                    checked={picked.has(f.id)}
                    onChange={() => toggle(f.id)}
                    aria-label={`Select ${f.label}`}
                    className="size-5 cursor-pointer accent-[var(--fg)]"
                  />
                </label>
              )}
              <div className="min-w-0 flex-1">
                <Row f={f} masked={masked} all={findings} />
              </div>
              {onNotMe && !selecting && <NotMeButton finding={f} onNotMe={onNotMe} className="my-1.5 mr-2" />}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </>
  );
}
