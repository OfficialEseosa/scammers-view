"use client";

import "./attack-map.css";
import "./graph3d.css";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding } from "@/lib/types";
import type { AttackMapProps } from "./AttackMap";
import { FactPanel } from "./FactPanel";
import { maskValue } from "./mask";
import { buildModel, type ChainModel } from "./model";

/**
 * "Ways in" for phones: one attack at a time, told top to bottom as a
 * numbered timeline from you to the account. Tap a fact to see where it was
 * found; play to walk through the steps.
 */

const EMPTY: string[] = [];
const STEP_MS = 3200;

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}
const PLAY = "M6 4.2v11.6a.6.6 0 0 0 .9.5l9.2-5.8a.6.6 0 0 0 0-1L6.9 3.7a.6.6 0 0 0-.9.5z";
const PAUSE = "M5 4h3.5v12H5zM11.5 4H15v12h-3.5z";
const PREV = "M12.7 4.3a1 1 0 0 1 0 1.4L8.4 10l4.3 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0z";
const NEXT = "M7.3 4.3a1 1 0 0 0 0 1.4l4.3 4.3-4.3 4.3a1 1 0 1 0 1.4 1.4l5-5a1 1 0 0 0 0-1.4l-5-5a1 1 0 0 0-1.4 0z";

function firstOpen(chains: ChainModel[]) {
  return (chains.find((c) => !c.broken) ?? chains[0])?.chain.id ?? null;
}

export function StepsList({
  findings,
  chains,
  subjectName,
  masked,
  removedFindingIds = EMPTY,
  className,
  autoplay = false,
  startChain = null,
}: AttackMapProps & { autoplay?: boolean; startChain?: string | null }) {
  const removed = useMemo(() => new Set(removedFindingIds), [removedFindingIds]);
  const model = useMemo(() => buildModel(findings, chains, removed), [findings, chains, removed]);
  // Lock onto the chain first shown, so a fix that cuts it shows the cut instead of jumping away.
  const [picked, setPicked] = useState<string | null>(() => startChain ?? firstOpen(model.chains));
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [factOpen, setFactOpen] = useState<string | null>(null);
  const body = useRef<HTMLOListElement | null>(null);

  const chainId = picked && model.chains.some((c) => c.chain.id === picked) ? picked : firstOpen(model.chains);
  const active = model.chains.find((c) => c.chain.id === chainId) ?? null;
  const last = active ? active.steps.length - 1 : 0;
  const cur = Math.min(step, last);

  const pick = (id: string, play = false) => {
    setPicked(id);
    setStep(0);
    setPlaying(play);
  };

  // Walk through the steps one by one.
  useEffect(() => {
    if (!playing || !active) return;
    if (cur >= last) {
      const id = window.setTimeout(() => setPlaying(false), STEP_MS);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => window.clearTimeout(id);
  }, [playing, active, cur, last]);

  // Keep the current step in view while playing.
  useEffect(() => {
    if (!playing) return;
    const list = body.current;
    const el = list?.querySelector<HTMLElement>(`[data-step="${cur}"]`);
    if (!list || !el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ top: Math.max(0, el.offsetTop - 72), behavior: reduce ? "auto" : "smooth" });
  }, [cur, playing, chainId]);

  useEffect(() => {
    if (!factOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFactOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [factOpen]);

  const reachable = model.chains.filter((c) => !c.broken).length;
  const blocked = model.chains.length - reachable;
  const openFinding = factOpen ? model.findings.get(factOpen) : undefined;
  const severedAt = active?.steps.find((s) => s.severed)?.index;

  return (
    <div className={`sl-root ${className ?? ""}`}>
      <header className="sl-head">
        <h2 className="sl-title">Ways in</h2>
        <p className="sl-tally">
          {model.chains.length === 0 ? (
            `${findings.length} ${findings.length === 1 ? "fact" : "facts"} found so far`
          ) : (
            <>
              <b className={reachable ? "sl-hot" : undefined}>{reachable}</b> {reachable === 1 ? "account" : "accounts"} reachable
              {blocked > 0 && (
                <>
                  , <b className="sl-calm">{blocked}</b> blocked
                </>
              )}
            </>
          )}
        </p>
      </header>

      {model.chains.length > 0 && (
        <div className="sl-tabs" role="tablist" aria-label="Accounts at risk">
          {model.chains.map((c, i) => (
            <button
              key={c.chain.id}
              type="button"
              role="tab"
              aria-selected={c.chain.id === chainId}
              className={`sl-tab${c.broken ? " sl-tab-cut" : ""}`}
              onClick={() => pick(c.chain.id)}
            >
              <span className="sl-tab-n">{i + 1}</span>
              <span className="sl-tab-label">{c.chain.target}</span>
            </button>
          ))}
        </div>
      )}

      {!active ? (
        <div className="sl-empty">
          <p className="sl-empty-title">No way in yet</p>
          <p className="sl-empty-body">As facts come in, we check whether they add up to a way into one of your accounts.</p>
        </div>
      ) : (
        <ol ref={body} className="sl-list" aria-label={`How they get into ${active.chain.target}`}>
          <li className="sl-item sl-start">
            <span className="sl-marker sl-marker-you" aria-hidden />
            <div className="sl-card">
              <span className="sl-kicker">Starts with</span>
              <span className="sl-step-title">{subjectName || "You"}</span>
            </div>
          </li>
          {active.steps.map((s) => {
            const state = s.index === cur ? "now" : s.index < cur ? "done" : "next";
            return (
              <li key={s.index} data-step={s.index} className={`sl-item sl-${state}${s.severed ? " sl-severed" : ""}`} aria-current={state === "now" ? "step" : undefined}>
                <span className="sl-marker" aria-hidden>
                  {s.index + 1}
                </span>
                <div className="sl-card">
                  <span className="sl-kicker">{s.severed ? `Step ${s.index + 1}, cut by your fix` : `Step ${s.index + 1}`}</span>
                  <span className="sl-step-title">{s.title}</span>
                  <span className="sl-desc">{s.description}</span>
                  <span className="sl-facts">
                    {s.findingIds.map((id) => {
                      const f: Finding | undefined = model.findings.get(id);
                      if (!f) return null;
                      const cut = removed.has(id);
                      const tone = cut ? "cut" : f.riskWeight >= 7 ? "high" : f.riskWeight >= 4 ? "mid" : "low";
                      return (
                        <button key={id} type="button" className={`sl-fact sl-fact-${tone}`} onClick={() => setFactOpen(id)}>
                          <i aria-hidden />
                          <span className="sl-fact-label">{f.label}</span>
                          <span className="sl-fact-value">{masked ? maskValue(f.value, f.category) : f.value}</span>
                        </button>
                      );
                    })}
                  </span>
                </div>
              </li>
            );
          })}
          <li className={`sl-item sl-end${active.broken ? " sl-end-safe" : ""}${cur === last ? " sl-now" : ""}`}>
            <span className="sl-marker sl-marker-target" aria-hidden />
            <div className="sl-card">
              <span className="sl-kicker">{active.broken ? "Blocked" : "Account taken over"}</span>
              <span className="sl-step-title">{active.chain.target}</span>
              {active.broken && severedAt !== undefined && <span className="sl-desc">Your fix cut step {severedAt + 1}, so this path no longer works.</span>}
            </div>
          </li>
        </ol>
      )}

      {active && (
        <div className="sl-bar">
          <span className="sl-bar-step" aria-live="polite">
            Step {cur + 1} of {active.steps.length}
          </span>
          <div className="sl-bar-ctl">
            <button type="button" onClick={() => { setPlaying(false); setStep(Math.max(0, cur - 1)); }} disabled={cur === 0} aria-label="Previous step">
              <Icon d={PREV} />
            </button>
            <button
              type="button"
              className={`sl-play${playing ? "" : " am-rail-play"}`}
              onClick={() => {
                if (playing) setPlaying(false);
                else {
                  if (cur >= last) setStep(0);
                  setPlaying(true);
                }
              }}
            >
              <Icon d={playing ? PAUSE : PLAY} size={16} />
              {playing ? "Pause" : cur >= last && cur > 0 ? "Replay" : "Play steps"}
            </button>
            <button type="button" onClick={() => { setPlaying(false); setStep(Math.min(last, cur + 1)); }} disabled={cur >= last} aria-label="Next step">
              <Icon d={NEXT} />
            </button>
          </div>
        </div>
      )}

      {openFinding && (
        <FactPanel
          finding={openFinding}
          masked={masked}
          removed={removed.has(openFinding.id)}
          chains={model.chains.filter((c) => (model.usage.get(openFinding.id) ?? []).includes(c.chain.id))}
          onClose={() => setFactOpen(null)}
          onChain={(id) => {
            setFactOpen(null);
            pick(id, true);
          }}
        />
      )}
    </div>
  );
}
