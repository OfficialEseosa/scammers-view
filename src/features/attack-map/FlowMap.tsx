"use client";

import "@xyflow/react/dist/style.css";
import "./attack-map.css";
import "./flow-map.css";
import "./graph3d.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { Finding, SourceType } from "@/lib/types";
import { CATEGORY_ICON, SOURCE_ICON, type Icon3DName } from "@/design/Icon3D";
import { riskColor } from "@/design/risk";
import { LogoMark } from "@/design/brand/Logo";
import type { AttackMapProps } from "./AttackMap";
import { FactPanel } from "./FactPanel";
import { maskValue } from "./mask";
import { buildModel, SOURCE_LABEL, type ChainModel } from "./model";

/**
 * The attack map as a left-to-right story on a tidy grid:
 * you -> where you are exposed -> what an attacker learns -> what they take.
 * Every edge is an orthogonal line with rounded corners. Only the facts that
 * matter are drawn (the ones an attack uses, or the riskiest while scanning);
 * the rest stay counted on their source.
 */

const COL = { you: 0, source: 330, fact: 700, target: 1070 } as const;
const ROW = { source: 132, fact: 132, target: 190 } as const;
const MAX_FACTS = 8;
/** Node box is NODE_W wide with the tile centred at the top; positions below are tile centres. */
const NODE_W = 190;
const at = (p: { x: number; y: number }, half = 36) => ({ x: p.x - NODE_W / 2, y: p.y - half });
const EMPTY: string[] = [];

type Tone = "normal" | "dim" | "lit" | "step";

type TileData = {
  kind: "you" | "source" | "fact" | "target";
  icon?: Icon3DName;
  image?: string;
  title: string;
  sub?: string;
  badge?: string;
  tone: Tone;
  cut?: boolean;
  blocked?: boolean;
  risk?: string;
  mono?: boolean;
  score?: number;
  clickable?: boolean;
};
type TileNode = Node<TileData, "tile">;

function Tile({ data }: NodeProps<TileNode>) {
  return (
    <div
      className={`fm-node fm-${data.kind} fm-t-${data.tone}${data.cut ? " fm-cut" : ""}${data.blocked ? " fm-blocked" : ""}${data.clickable ? " fm-click" : ""}`}
      style={data.risk ? { ["--fm-risk" as string]: data.risk } : undefined}
    >
      <Handle type="target" position={Position.Left} className="fm-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="fm-handle" isConnectable={false} />
      <span className="fm-tile">
        {data.kind === "you" ? (
          <LogoMark size={40} title="" />
        ) : data.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote evidence thumbnail
          <img className="fm-photo" src={data.image} alt="" draggable={false} referrerPolicy="no-referrer" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- static 3D icon
          <img className="fm-icon" src={`/icons3d/${data.icon ?? "folder"}-160.webp`} alt="" draggable={false} />
        )}
        {data.badge && <span className="fm-badge">{data.badge}</span>}
        {data.kind === "fact" && <span className="fm-riskdot" aria-hidden />}
      </span>
      <span className="fm-title">{data.title}</span>
      {data.sub && <span className={`fm-sub${data.mono ? " fm-mono" : ""}`}>{data.sub}</span>}
    </div>
  );
}

const nodeTypes = { tile: Tile };

function column(count: number, x: number, gap: number): { x: number; y: number }[] {
  const top = -((count - 1) * gap) / 2;
  return Array.from({ length: count }, (_, i) => ({ x, y: top + i * gap }));
}

export function FlowMap(props: AttackMapProps & { autoplay?: boolean; startChain?: string | null }) {
  return (
    <ReactFlowProvider>
      <FlowMapInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowMapInner({ findings, chains, score, subjectName, masked, removedFindingIds = EMPTY, className, compact = false, autoplay = false, startChain = null }: AttackMapProps & { autoplay?: boolean; startChain?: string | null }) {
  const removed = useMemo(() => new Set(removedFindingIds), [removedFindingIds]);
  const model = useMemo(() => buildModel(findings, chains, removed), [findings, chains, removed]);
  // Opened from the 3D view: start on the first way in that is still open.
  const [chainId, setChainId] = useState<string | null>(() => (startChain && chains.some((c) => c.id === startChain) ? startChain : autoplay ? ((chains.find((c) => !c.steps.some((s) => s.findingIds.some((id) => removedFindingIds.includes(id)))) ?? chains[0])?.id ?? null) : null));
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [factOpen, setFactOpen] = useState<string | null>(null);
  const flow = useReactFlow();

  const active: ChainModel | null = useMemo(() => model.chains.find((c) => c.chain.id === chainId) ?? null, [model.chains, chainId]);
  const activeStep = active ? active.steps[Math.min(step, active.steps.length - 1)] : null;

  // Which facts get a tile: everything an attack uses, else the riskiest so the map grows during a scan.
  const shown = useMemo(() => {
    const inChains: string[] = [];
    for (const c of model.chains) for (const s of c.steps) for (const id of s.findingIds) if (!inChains.includes(id)) inChains.push(id);
    let ids = inChains.slice(0, MAX_FACTS);
    if (ids.length < MAX_FACTS) {
      const rest = findings
        .filter((f) => !ids.includes(f.id))
        .sort((a, b) => b.riskWeight * b.confidence - a.riskWeight * a.confidence)
        .slice(0, (model.chains.length ? 6 : MAX_FACTS) - Math.min(ids.length, model.chains.length ? 6 : MAX_FACTS))
        .map((f) => f.id);
      ids = [...ids, ...rest];
    }
    return ids;
  }, [model.chains, findings]);

  const { nodes, edges } = useMemo(() => {
    const srcOrder = model.sources.map((s) => s.type);
    const srcPos = column(srcOrder.length, COL.source, ROW.source);
    const srcIndex = new Map<SourceType, number>(srcOrder.map((t, i) => [t, i]));

    // Facts sit near their source's row, to keep lines short and crossings few.
    const facts = shown
      .map((id) => model.findings.get(id))
      .filter((f): f is Finding => !!f)
      .sort((a, b) => (srcIndex.get(a.sourceType) ?? 0) - (srcIndex.get(b.sourceType) ?? 0));
    const factPos = column(facts.length, COL.fact, ROW.fact);
    const factRow = new Map(facts.map((f, i) => [f.id, factPos[i].y]));

    const targets = [...model.targets].sort((a, b) => {
      const avg = (ids: string[]) => {
        const ys = model.chains
          .filter((c) => ids.includes(c.chain.id))
          .flatMap((c) => c.steps.flatMap((s) => s.findingIds))
          .map((id) => factRow.get(id))
          .filter((y): y is number => y !== undefined);
        return ys.length ? ys.reduce((p, q) => p + q, 0) / ys.length : 0;
      };
      return avg(a.chainIds) - avg(b.chainIds);
    });
    const targetPos = column(targets.length, COL.target, ROW.target);

    const litFacts = new Set(active ? active.steps.flatMap((s) => s.findingIds) : []);
    const stepFacts = new Set(activeStep ? activeStep.findingIds : []);
    const litSources = new Set(active ? [...litFacts].map((id) => model.findings.get(id)?.sourceType) : []);
    const toneOf = (lit: boolean, isStep = false): Tone => (!active ? "normal" : isStep ? "step" : lit ? "lit" : "dim");

    const n: TileNode[] = [];
    n.push({
      id: "you",
      type: "tile",
      position: at({ x: COL.you, y: 0 }, 44),
      data: { kind: "you", title: subjectName || "You", sub: score ? `Exposure ${Math.round(score.score)}` : "Scanning", tone: active ? "lit" : "normal", risk: score ? riskColor(score.score) : undefined, score: score?.score },
    });
    model.sources.forEach((s, i) => {
      n.push({
        id: `src:${s.type}`,
        type: "tile",
        position: at(srcPos[i]),
        data: { kind: "source", icon: SOURCE_ICON[s.type], title: SOURCE_LABEL[s.type], sub: `${s.factIds.length} ${s.factIds.length === 1 ? "fact" : "facts"}`, tone: toneOf(litSources.has(s.type)) },
      });
    });
    facts.forEach((f, i) => {
      const cut = removed.has(f.id);
      n.push({
        id: `fact:${f.id}`,
        type: "tile",
        position: at(factPos[i]),
        data: {
          kind: "fact",
          icon: CATEGORY_ICON[f.category],
          image: f.category === "photo" && f.imageUrl && !masked ? f.imageUrl : undefined,
          title: f.label,
          sub: masked ? maskValue(f.value, f.category) : f.value,
          mono: true,
          tone: toneOf(litFacts.has(f.id), stepFacts.has(f.id)),
          cut,
          risk: f.riskWeight >= 7 ? "var(--danger)" : f.riskWeight >= 4 ? "var(--warn)" : "var(--safe)",
          clickable: true,
        },
      });
    });
    targets.forEach((t, i) => {
      n.push({
        id: t.id,
        type: "tile",
        position: at(targetPos[i]),
        data: {
          kind: "target",
          icon: t.blocked ? "shield" : "lock",
          title: t.label,
          sub: t.blocked ? "Takeover blocked" : "Can be taken over",
          tone: toneOf(!!active && active.targetNodeId === t.id, !!active && active.targetNodeId === t.id && !!activeStep && activeStep.index === active.steps.length - 1),
          blocked: t.blocked,
          clickable: true,
        },
      });
    });

    const e: Edge[] = [];
    const base = { type: "smoothstep", pathOptions: { borderRadius: 18, offset: 26 }, focusable: false, selectable: false } as const;
    for (const s of model.sources) {
      e.push({ ...base, id: `you>${s.type}`, source: "you", target: `src:${s.type}`, className: `fm-edge fm-found${active ? (litSources.has(s.type) ? " fm-lit" : " fm-dim") : ""}` });
    }
    for (const f of facts) {
      e.push({ ...base, id: `src>${f.id}`, source: `src:${f.sourceType}`, target: `fact:${f.id}`, className: `fm-edge fm-found${active ? (litFacts.has(f.id) ? " fm-lit" : " fm-dim") : ""}` });
    }
    const drawn = new Set<string>();
    for (const c of model.chains) {
      for (const s of c.steps) {
        for (const id of s.findingIds) {
          if (!factRow.has(id)) continue;
          const key = `${id}>${c.targetNodeId}`;
          if (drawn.has(key)) continue;
          drawn.add(key);
          const cut = removed.has(id) || s.severed;
          const mine = active?.chain.id === c.chain.id;
          const onStep = mine && !!activeStep && activeStep.findingIds.includes(id);
          e.push({
            ...base,
            id: `atk:${key}`,
            source: `fact:${id}`,
            target: c.targetNodeId,
            className: `fm-edge fm-attack${cut ? " fm-cutline" : ""}${active ? (mine ? (onStep ? " fm-step" : " fm-lit") : " fm-dim") : ""}`,
            zIndex: mine ? 2 : 1,
          });
        }
      }
    }
    return { nodes: n, edges: e };
  }, [model, shown, active, activeStep, removed, masked, subjectName, score]);

  // Keep everything in view as the map grows. Wait until the tiles have been measured.
  const count = nodes.length;
  const ready = useNodesInitialized();
  const first = useRef(true);
  useEffect(() => {
    if (!ready) return;
    const fit = (duration: number) => void flow.fitView({ padding: compact ? 0.08 : 0.14, duration, maxZoom: 1.15 });
    const a = window.setTimeout(() => {
      fit(first.current ? 0 : 500);
      first.current = false;
    }, 80);
    // Once more after layout settles (fonts, the player bar sliding in).
    const b = window.setTimeout(() => fit(400), 650);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
    // The player bar changes the canvas height, so refit when a chain opens or closes.
  }, [ready, count, flow, compact, chainId]);

  // Chain playback: one step every few seconds.
  useEffect(() => {
    if (!playing || !active) return;
    const id = window.setTimeout(() => {
      if (step >= active.steps.length - 1) setPlaying(false);
      else setStep((s) => s + 1);
    }, 3200);
    return () => window.clearTimeout(id);
  }, [playing, active, step]);

  const pick = useCallback((id: string | null, autoplay = false) => {
    setChainId(id);
    setStep(0);
    setPlaying(autoplay && !!id);
  }, []);

  // The session's demo keys drive the map through the same event the old map used.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!active) return;
      if (ev.key === "Escape") pick(null);
      else if (ev.key === "ArrowRight") setStep((s) => Math.min(s + 1, active.steps.length - 1));
      else if (ev.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
      else if (ev.key === " ") {
        ev.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, pick]);
  useEffect(() => {
    const onPlay = () => {
      const c = model.chains.find((x) => !x.broken) ?? model.chains[0];
      if (c) pick(c.chain.id, true);
    };
    window.addEventListener("sv:play-chain", onPlay);
    return () => window.removeEventListener("sv:play-chain", onPlay);
  }, [model.chains, pick]);

  const openFinding = factOpen ? model.findings.get(factOpen) : undefined;
  const open = model.chains.filter((c) => !c.broken).length;

  return (
    <div className={`fm-root${compact ? " fm-compact" : ""} ${className ?? ""}`}>
      <header className="fm-head">
        <span className="fm-head-title">Attack map</span>
        <span className="fm-stats">
          <span>
            <b>{findings.length}</b> facts
          </span>
          <span>
            <b>{model.sources.length}</b> sources
          </span>
          <span>
            <b>{open}</b> {open === 1 ? "way in" : "ways in"}
          </span>
          {score && (
            <span className="fm-score" style={{ ["--fm-risk" as string]: riskColor(score.score) }}>
              {Math.round(score.score)}
            </span>
          )}
        </span>
      </header>

      <div className="fm-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: compact ? 0.08 : 0.14, maxZoom: 1.15 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnScroll={false}
          zoomOnScroll={!compact}
          minZoom={0.3}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            if (node.id.startsWith("fact:")) setFactOpen(node.id.slice(5));
            else if ((node.data as TileData).kind === "target") {
              const c = model.chains.find((x) => x.targetNodeId === node.id);
              if (c) pick(chainId === c.chain.id ? null : c.chain.id);
            }
          }}
          onPaneClick={() => setFactOpen(null)}
        />
        <div className="fm-glow" aria-hidden />
      </div>

      {model.chains.length > 0 && (
        <div className="fm-chains" role="tablist" aria-label="Ways in">
          {model.chains.map((c, i) => (
            <button
              key={c.chain.id}
              type="button"
              role="tab"
              aria-selected={chainId === c.chain.id}
              className={`fm-chip${chainId === c.chain.id ? " fm-chip-on" : ""}${c.broken ? " fm-chip-cut" : ""}`}
              onClick={() => pick(chainId === c.chain.id ? null : c.chain.id, chainId !== c.chain.id)}
            >
              <span className="fm-chip-n">{i + 1}</span>
              <span className="fm-chip-label">{c.chain.target}</span>
              <span className="fm-chip-meta">{c.broken ? "cut" : `${c.steps.length} steps`}</span>
            </button>
          ))}
        </div>
      )}

      {active && activeStep && (
        <section className={`fm-player${activeStep.severed ? " fm-player-cut" : ""}`} aria-live="polite">
          <div className="fm-player-dots" aria-hidden>
            {active.steps.map((s) => (
              <button key={s.index} type="button" tabIndex={-1} className={s.index === activeStep.index ? "on" : s.index < activeStep.index ? "done" : ""} onClick={() => setStep(s.index)} />
            ))}
          </div>
          <div className="fm-player-text">
            <span className="fm-player-step">
              Step {activeStep.index + 1} of {active.steps.length}
              {activeStep.severed ? " · cut by your fix" : ""}
            </span>
            <span className="fm-player-title">{activeStep.title}</span>
            <span className="fm-player-desc">{activeStep.description}</span>
          </div>
          <div className="fm-player-ctl">
            <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={activeStep.index === 0} aria-label="Previous step">
              ‹
            </button>
            <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
              {playing ? "❚❚" : "▶"}
            </button>
            <button type="button" onClick={() => setStep((s) => Math.min(active.steps.length - 1, s + 1))} disabled={activeStep.index === active.steps.length - 1} aria-label="Next step">
              ›
            </button>
            <button type="button" onClick={() => pick(null)} aria-label="Close">
              ×
            </button>
          </div>
        </section>
      )}

      <footer className="fm-legend" aria-hidden>
        <span>
          <i className="fm-l-found" /> Found at
        </span>
        <span>
          <i className="fm-l-attack" /> Used in an attack
        </span>
        <span>
          <i className="fm-l-cut" /> Cut by a fix
        </span>
        <span>
          <i className="fm-l-target" /> Account at risk
        </span>
      </footer>

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
