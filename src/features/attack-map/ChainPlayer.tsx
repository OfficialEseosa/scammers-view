"use client";

import type { Finding } from "@/lib/types";
import { maskIn } from "./mask";
import type { ChainModel, StepModel } from "./model";
import { PlayIcon } from "./ChainRail";

export function ChainPlayer({
  chain,
  step,
  running,
  findings,
  masked,
  onPrev,
  onNext,
  onToggle,
  onClose,
  onJump,
}: {
  chain: ChainModel;
  step: StepModel;
  running: boolean;
  findings: Finding[];
  masked: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
  onClose: () => void;
  onJump: (i: number) => void;
}) {
  const n = chain.steps.length;
  const last = step.index === n - 1;
  return (
    <section
      className={`am-player${step.severed ? " am-severed" : ""}`}
      aria-label={`Attack on ${chain.chain.target}`}
      aria-live="polite"
    >
      <div className="am-player-top">
        <span className="am-player-target">{chain.chain.target}</span>
        <ol className="am-player-dots" aria-label="Steps">
          {chain.steps.map((s) => (
            <li key={s.index}>
              <button
                type="button"
                aria-label={`Step ${s.index + 1}: ${s.title}`}
                aria-current={s.index === step.index ? "step" : undefined}
                className={`${s.index < step.index ? "done" : ""}${s.index === step.index ? " cur" : ""}${
                  s.severed ? " cut" : ""
                }`}
                onClick={() => onJump(s.index)}
              />
            </li>
          ))}
        </ol>
        <button type="button" className="am-icon-btn" onClick={onClose} aria-label="Stop playback">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="am-player-body" key={step.index}>
        <span className={`am-player-num${last && !step.severed ? " am-final" : ""}`} aria-hidden>
          {step.index + 1}
        </span>
        <div>
          <h3 className="am-player-title">
            <span className="am-sr">
              Step {step.index + 1} of {n}:{" "}
            </span>
            {maskIn(step.title, findings, masked)}
          </h3>
          <p className="am-player-desc">{maskIn(step.description, findings, masked)}</p>
          {step.severed ? (
            <p className="am-player-outcome am-calm">Cut. A fact it needs is gone.</p>
          ) : step.enables ? (
            <p className="am-player-outcome">Unlocks {maskIn(step.enables, findings, masked)}</p>
          ) : last ? (
            <p className="am-player-outcome am-final">{chain.chain.target} taken over</p>
          ) : null}
        </div>
      </div>

      <div className="am-player-controls">
        <button type="button" onClick={onPrev} disabled={step.index === 0}>
          Back
        </button>
        <button type="button" className="am-player-main" onClick={onToggle}>
          {running ? (
            <>
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
                <rect x="5" y="4" width="3.4" height="12" rx="1" fill="currentColor" />
                <rect x="11.6" y="4" width="3.4" height="12" rx="1" fill="currentColor" />
              </svg>
              Pause
            </>
          ) : (
            <>
              <PlayIcon />
              {last ? "Replay" : "Play"}
            </>
          )}
        </button>
        <button type="button" onClick={onNext} disabled={last}>
          Next
        </button>
      </div>
    </section>
  );
}
