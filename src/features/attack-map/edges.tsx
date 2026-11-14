"use client";

import { createContext, useContext } from "react";
import { EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { boxExit, PERSON_ID, type Box } from "./model";
import type { Emphasis } from "./nodes";

export const GeomContext = createContext<Map<string, Box>>(new Map());

/* ---------- structural: person → source → fact ---------- */

export type StructData = { emphasis: Emphasis };
export type StructEdgeT = Edge<StructData, "struct">;

export function StructEdge({ source, target, data }: EdgeProps<StructEdgeT>) {
  const geom = useContext(GeomContext);
  const a = geom.get(source);
  const b = geom.get(target);
  if (!a || !b) return null;
  const p0 = boxExit(a, b.x, b.y, source === PERSON_ID, 2);
  const p1 = boxExit(b, a.x, a.y, false, 2);
  return (
    <path
      className={`am-struct am-e-${data?.emphasis ?? "normal"}`}
      d={`M${p0.x},${p0.y}L${p1.x},${p1.y}`}
    />
  );
}

/* ---------- attack chain step ---------- */

export type ChainEdgeData = {
  color: string;
  bend: number;
  stepN?: number;
  stepTitle?: string;
  showTitle: boolean;
  severed: boolean;
  emphasis: Emphasis;
  /** Line pattern that identifies the chain (solid / dashed / dotted). */
  dash?: string;
  /** This step lands on the target account: drawn in danger red. */
  final?: boolean;
};
export type ChainEdgeT = Edge<ChainEdgeData, "chain">;

export function ChainEdge({ source, target, data }: EdgeProps<ChainEdgeT>) {
  const geom = useContext(GeomContext);
  const a = geom.get(source);
  const b = geom.get(target);
  if (!a || !b || !data) return null;

  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const c = { x: mx - dy * data.bend, y: my + dx * data.bend };
  const p0 = boxExit(a, c.x, c.y, false, 3);
  const p1 = boxExit(b, c.x, c.y, false, 10);
  const d = `M${p0.x},${p0.y}Q${c.x},${c.y} ${p1.x},${p1.y}`;
  // midpoint of the quadratic
  const lx = 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x;
  const ly = 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y;
  // arrowhead
  const tx = p1.x - c.x;
  const ty = p1.y - c.y;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const s = 14;
  const head = `M${p1.x + ux * 8},${p1.y + uy * 8}L${p1.x - ux * s - uy * s * 0.6},${p1.y - uy * s + ux * s * 0.6}L${
    p1.x - ux * s + uy * s * 0.6
  },${p1.y - uy * s - ux * s * 0.6}Z`;

  const final = data.final && !data.severed;
  const cls = `am-chain am-e-${data.emphasis}${data.severed ? " am-severed" : ""}${final ? " am-final" : ""}`;
  return (
    <>
      <g className={cls} style={{ ["--am-dash" as string]: data.severed ? undefined : data.dash }}>
        <path className="am-chain-halo" d={d} />
        <path className="am-chain-line" d={d} />
        {!data.severed && <path className="am-chain-head" d={head} />}
      </g>
      {data.stepN !== undefined && (
        <EdgeLabelRenderer>
          <div
            className={`am-edge-label am-e-${data.emphasis}${data.severed ? " am-severed" : ""}${final ? " am-final" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {data.severed ? (
              <span className="am-cut" aria-label="Step cut">
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                </svg>
              </span>
            ) : (
              <span className="am-step-n">{data.stepN}</span>
            )}
            {data.showTitle && data.stepTitle && <span className="am-step-title">{data.stepTitle}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { struct: StructEdge, chain: ChainEdge };
