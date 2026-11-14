"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ExposureScore, Finding, SourceType } from "@/lib/types";
import { maskValue } from "./mask";
import { SOURCE_LABEL } from "./model";
import { SOURCE_ICON } from "@/design/Icon3D";
import { riskColor } from "@/design/risk";

export type Emphasis = "normal" | "dim" | "focus" | "active" | "next" | "visited";

function Anchors() {
  return (
    <>
      <Handle type="target" position={Position.Top} className="am-handle" isConnectable={false} />
      <Handle type="source" position={Position.Top} className="am-handle" isConnectable={false} />
    </>
  );
}

/* ---------- person ---------- */

export type PersonData = { name: string; score?: ExposureScore; emphasis: Emphasis };
export type PersonNodeT = Node<PersonData, "person">;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function PersonNode({ data }: NodeProps<PersonNodeT>) {
  const score = data.score?.score;
  const C = 2 * Math.PI * 98;
  return (
    <div className={`am-node am-person am-e-${data.emphasis}`} style={score !== undefined ? { ["--am-ring" as string]: riskColor(score) } : undefined}>
      <Anchors />
      <svg className="am-person-ring" viewBox="0 0 210 210" aria-hidden>
        <circle cx="105" cy="105" r="98" className="am-ring-track" />
        {score !== undefined && (
          <circle
            cx="105"
            cy="105"
            r="98"
            className="am-ring-value"
            strokeDasharray={`${(score / 100) * C} ${C}`}
            transform="rotate(-90 105 105)"
          />
        )}
      </svg>
      <div className="am-person-body">
        <span className="am-person-initials">{initials(data.name)}</span>
        <span className="am-person-name">{data.name}</span>
        {score !== undefined ? (
          <span className="am-person-score">
            Exposure <b>{Math.round(score)}</b>
          </span>
        ) : (
          <span className="am-person-score am-scanning">Scanning</span>
        )}
      </div>
    </div>
  );
}

/* ---------- source ---------- */

export type SourceData = { type: SourceType; count: number; emphasis: Emphasis };
export type SourceNodeT = Node<SourceData, "source">;

export function SourceNode({ data }: NodeProps<SourceNodeT>) {
  return (
    <div className={`am-node am-source am-e-${data.emphasis}`}>
      <Anchors />
      <span className="am-source-mono" data-src={data.type} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- static 3D icon */}
        <img src={`/icons3d/${SOURCE_ICON[data.type]}-160.webp`} alt="" draggable={false} />
      </span>
      <span className="am-source-label">{SOURCE_LABEL[data.type]}</span>
      <span className="am-source-count" aria-label={`${data.count} facts`}>
        {data.count}
      </span>
    </div>
  );
}

/* ---------- fact ---------- */

export type FactData = {
  finding: Finding;
  masked: boolean;
  removed: boolean;
  chainColors: string[];
  selected: boolean;
  emphasis: Emphasis;
  stepBadge?: { n: number; color: string };
};
export type FactNodeT = Node<FactData, "fact">;

export function FactNode({ data }: NodeProps<FactNodeT>) {
  const f = data.finding;
  const value = data.masked ? maskValue(f.value, f.category) : f.value;
  const risk = f.riskWeight >= 7 ? "high" : f.riskWeight >= 4 ? "mid" : "low";
  return (
    <div
      className={`am-node am-fact am-risk-${risk} am-e-${data.emphasis}${data.removed ? " am-removed" : ""}${
        data.selected ? " am-selected" : ""
      }`}
      title={`${f.label}: ${value}`}
    >
      <Anchors />
      {f.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={f.imageUrl}
          alt=""
          className={`am-thumb${data.masked ? " am-blur" : ""}`}
          draggable={false}
        />
      )}
      <div className="am-fact-text">
        <span className="am-fact-label">{f.label}</span>
        {data.masked ? (
          <span className="am-fact-value am-redacted" style={{ width: `${Math.min(100, 18 + value.length * 6)}%` }} aria-label="Hidden" />
        ) : (
          <span className="am-fact-value">{value}</span>
        )}
      </div>
      {data.chainColors.length > 0 && (
        <span className="am-fact-dots" aria-hidden>
          {data.chainColors.map((_, i) => (
            <i key={i} />
          ))}
        </span>
      )}
      {data.removed && <span className="am-removed-tag">Removed</span>}
      {data.stepBadge && (
        <span className="am-step-badge">
          {data.stepBadge.n}
        </span>
      )}
    </div>
  );
}

/* ---------- target (the prize) ---------- */

export type TargetData = {
  label: string;
  blocked: boolean;
  chainCount: number;
  colors: string[];
  emphasis: Emphasis;
};
export type TargetNodeT = Node<TargetData, "target">;

export function TargetNode({ data }: NodeProps<TargetNodeT>) {
  return (
    <div
      className={`am-node am-target am-e-${data.emphasis}${data.blocked ? " am-blocked" : ""}`}
    >
      <Anchors />
      {/* eslint-disable-next-line @next/next/no-img-element -- static 3D icon */}
      <img className="am-target-icon" src={`/icons3d/${data.blocked ? "shield" : "lock"}-160.webp`} alt="" draggable={false} />
      <div className="am-target-text">
        <span className="am-target-kicker">
          {data.blocked ? "Takeover blocked" : "Account takeover"}
        </span>
        <span className="am-target-label">{data.label}</span>
      </div>
    </div>
  );
}

export const nodeTypes = {
  person: PersonNode,
  source: SourceNode,
  fact: FactNode,
  target: TargetNode,
};
