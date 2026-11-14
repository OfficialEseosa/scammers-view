"use client";

import type { MapModel } from "./model";

export function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
      <path d="M6 4.2v11.6a.6.6 0 0 0 .9.5l9.2-5.8a.6.6 0 0 0 0-1L6.9 3.7a.6.6 0 0 0-.9.5z" fill="currentColor" />
    </svg>
  );
}

export function ChainRail({
  model,
  narrow,
  selectedChainId,
  playingChainId,
  onSelect,
  onPlay,
  open,
  onOpenChange,
}: {
  model: MapModel;
  masked: boolean;
  narrow: boolean;
  selectedChainId: string | null;
  playingChainId: string | null;
  onSelect: (id: string) => void;
  onPlay: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setUserOpen = onOpenChange;
  const facts = model.findings.size;
  const open_ = model.chains.filter((c) => !c.broken).length;
  const blocked = model.chains.length - open_;

  return (
    <section className={`am-rail${open ? "" : " am-rail-closed"}`} aria-label="Ways in">
      <header className="am-rail-head">
        <div>
          <h2 className="am-rail-title">Ways in</h2>
          <p className="am-rail-sub">
            <b>{facts}</b> {facts === 1 ? "fact" : "facts"} · <b>{model.sources.length}</b> {model.sources.length === 1 ? "source" : "sources"}
          </p>
        </div>
        <button
          type="button"
          className="am-icon-btn am-rail-toggle"
          aria-expanded={open}
          aria-label={open ? "Hide attack list" : "Show attack list"}
          onClick={() => setUserOpen(!open)}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <path
              d={open ? "M5 12l5-5 5 5" : "M5 8l5 5 5-5"}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {open && (
        <>
          {model.chains.length === 0 ? (
            <p className="am-rail-empty">No way in yet.</p>
          ) : (
            <>
              <p className="am-rail-tally">
                <b>{open_}</b> {open_ === 1 ? "account" : "accounts"} reachable
                {blocked > 0 && (
                  <>
                    , <b className="am-calm">{blocked}</b> blocked
                  </>
                )}
              </p>
              <ul className="am-rail-list">
                {model.chains.map((c) => {
                  const active = c.chain.id === selectedChainId || c.chain.id === playingChainId;
                  return (
                    <li
                      key={c.chain.id}
                      className={`am-rail-item${active ? " am-active" : ""}${c.broken ? " am-broken" : ""}`}
                    >
                      <button
                        type="button"
                        className="am-rail-select"
                        aria-pressed={active}
                        onClick={() => {
                          if (narrow) setUserOpen(false);
                          onSelect(c.chain.id);
                        }}
                      >
                        <span className="am-rail-swatch" data-style={c.style} aria-hidden />
                        <span className="am-rail-target">{c.chain.target}</span>
                        <span className="am-rail-meta">
                          {c.broken ? "Blocked" : `${c.steps.length} steps`}
                          <span className="am-sev" aria-label={`Severity ${c.chain.severity} of 10`}>
                            {Array.from({ length: 5 }, (_, i) => (
                              <i key={i} className={i < Math.round(c.chain.severity / 2) ? (c.chain.severity >= 7 ? "on hot" : "on") : ""} />
                            ))}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="am-rail-play"
                        onClick={() => {
                          if (narrow) setUserOpen(false);
                          onPlay(c.chain.id);
                        }}
                        aria-label={`Play attack on ${c.chain.target}`}
                      >
                        <PlayIcon />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <ul className="am-legend" aria-label="Legend">
            <li>
              <i className="am-lg-struct" aria-hidden />
              Found at
            </li>
            <li>
              <i className="am-lg-chain" aria-hidden />
              Attack step
            </li>
            <li>
              <i className="am-lg-final" aria-hidden />
              Into the account
            </li>
            <li>
              <i className="am-lg-cut" aria-hidden />
              Cut by a fix
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
