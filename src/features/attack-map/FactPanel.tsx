"use client";

import type { Finding, IdentityAnchor } from "@/lib/types";
import { maskValue } from "./mask";
import { SOURCE_LABEL, type ChainModel } from "./model";

const ANCHOR_TEXT: Record<IdentityAnchor, string> = {
  email: "Linked to you by your email address",
  github: "Linked to you through your GitHub account",
  face: "Linked to you by a face match with your photo",
  school: "Linked to you through your school",
  unconfirmed: "Not confirmed. This could be someone with your name",
};

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function FactPanel({
  finding: f,
  masked,
  removed,
  chains,
  onClose,
  onChain,
}: {
  finding: Finding;
  masked: boolean;
  removed: boolean;
  chains: ChainModel[];
  onClose: () => void;
  onChain: (chainId: string) => void;
}) {
  const value = masked ? maskValue(f.value, f.category) : f.value;
  const pct = Math.round(f.confidence * 100);
  return (
    <aside className="am-panel" aria-label={`Fact: ${f.label}`}>
      <div className="am-panel-grip" aria-hidden />
      <header className="am-panel-head">
        <span className="am-panel-kicker">{f.label}</span>
        <button type="button" className="am-icon-btn" onClick={onClose} aria-label="Close fact details">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {f.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={f.imageUrl} alt="" className={`am-panel-img${masked ? " am-blur" : ""}`} />
      )}
      <p className={`am-panel-value${removed ? " am-struck" : ""}`}>{value}</p>
      {removed && <p className="am-panel-removed">Removed. Steps that needed it are cut.</p>}

      <dl className="am-panel-facts">
        <div>
          <dt>Found on</dt>
          <dd>
            <a href={f.sourceUrl} target="_blank" rel="noreferrer noopener">
              {f.sourceTitle ?? SOURCE_LABEL[f.sourceType]}
            </a>
            <span className="am-panel-host">{hostOf(f.sourceUrl)}</span>
          </dd>
        </div>
        {f.sources && f.sources.length > 1 && (
          <div>
            <dt>Seen in {f.sources.length} places</dt>
            <dd>
              <ul className="am-panel-seen">
                {f.sources.map((x) => (
                  <li key={x.url}>
                    <span className="am-panel-host">{hostOf(x.url)}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div>
          <dt>Why we think it’s you</dt>
          <dd>{ANCHOR_TEXT[f.anchor]}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>
            <span className="am-meter" aria-hidden>
              {[0, 1, 2].map((i) => (
                <i key={i} className={i < (f.confidence >= 0.8 ? 3 : f.confidence >= 0.5 ? 2 : 1) ? "on" : ""} />
              ))}
            </span>
            {pct}%
          </dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{f.riskWeight.toFixed(0)} out of 10</dd>
        </div>
      </dl>

      {f.snippet && !masked && <blockquote className="am-panel-snippet">{f.snippet}</blockquote>}

      <section className="am-panel-chains">
        <h3>{chains.length ? `Used in ${chains.length === 1 ? "1 attack" : `${chains.length} attacks`}` : "Not used in an attack yet"}</h3>
        {chains.map((c) => (
          <button
            type="button"
            key={c.chain.id}
            className="am-panel-chain"
            onClick={() => onChain(c.chain.id)}
          >
            <i aria-hidden data-style={c.style} />
            <span>{c.chain.target}</span>
            {c.broken && <em>Blocked</em>}
          </button>
        ))}
      </section>
    </aside>
  );
}
