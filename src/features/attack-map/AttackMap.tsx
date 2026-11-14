"use client";

import "@xyflow/react/dist/style.css";
import "./attack-map.css";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { AttackChain, ExposureScore, Finding } from "@/lib/types";
import { edgeTypes, GeomContext, type ChainEdgeT, type StructEdgeT } from "./edges";
import {
  nodeTypes,
  type Emphasis,
  type FactNodeT,
  type PersonNodeT,
  type SourceNodeT,
  type TargetNodeT,
} from "./nodes";
import { buildModel, factId, layout, PERSON_ID, sourceId, type ChainModel } from "./model";
import { useReducedMotion, useTweenedBoxes } from "./useTween";
import { FactPanel } from "./FactPanel";
import { ChainRail } from "./ChainRail";
import { ChainPlayer } from "./ChainPlayer";
import { SegmentedTabs } from "@/design/SegmentedTabs";

export interface AttackMapProps {
  findings: Finding[];
  chains: AttackChain[];
  score?: ExposureScore;
  subjectName: string;
  masked: boolean;
  /** Facts the user has taken down; chains that depend on them render as cut. */
  removedFindingIds?: string[];
  className?: string;
  /** Phones only: open on the list of ways in (default) or on the graph. */
  phoneDefault?: "list" | "map";
  /** Desktop: start with the "Ways in" panel open (default) or folded away. */
  railDefault?: "open" | "closed";
  /** A small side panel: fit the whole map even if that means zooming far out. */
  compact?: boolean;
}

export interface PlayState {
  chainId: string;
  step: number;
  running: boolean;
}

const STEP_MS = 4200;
type Px = `${number}px`;
type FitPadding = { top: Px; bottom: Px; left: Px; right: Px };
const EMPTY: string[] = [];

function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia("(max-width: 760px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useNarrow() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia("(max-width: 760px)").matches,
    () => false,
  );
}

export function AttackMap(props: AttackMapProps) {
  return (
    <ReactFlowProvider>
      <AttackMapInner {...props} />
    </ReactFlowProvider>
  );
}

function AttackMapInner({
  findings,
  chains,
  score,
  subjectName,
  masked,
  removedFindingIds = EMPTY,
  className,
  phoneDefault = "list",
  railDefault = "open",
  compact = false,
}: AttackMapProps) {
  const [phoneView, setPhoneView] = useState<"list" | "map">(phoneDefault);
  const reduced = useReducedMotion();
  const narrow = useNarrow();
  const rf = useReactFlow();
  // Semantic zoom: when the whole map is fitted the boxes get small, so they switch
  // to one big label each instead of two small lines.
  const far = useStore((st) => st.transform[2] < 0.7);
  const [railUser, setRailUser] = useState<boolean | null>(null);
  const railOpen = narrow && phoneView === "list" ? true : (railUser ?? (narrow ? false : railDefault === "open"));

  const removed = useMemo(() => new Set(removedFindingIds), [removedFindingIds]);
  const model = useMemo(() => buildModel(findings, chains, removed), [findings, chains, removed]);

  // Layout depends only on structure, so masking / removal never moves anything.
  const structureKey = useMemo(
    () =>
      model.sources.map((s) => `${s.type}:${s.factIds.join(",")}`).join("|") +
      "#" +
      model.chains.map((c) => `${c.chain.id}>${c.targetNodeId}:${c.factNodeIds.join(",")}`).join("|"),
    [model],
  );
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targetBoxes = useMemo(() => layout(model, narrow || compact), [structureKey, narrow, compact]);
  const boxes = useTweenedBoxes(targetBoxes, reduced);

  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [autoFit, setAutoFit] = useState(true);

  const focusChainId = play?.chainId ?? selectedChainId;
  const focusChain: ChainModel | undefined = model.chains.find((c) => c.chain.id === focusChainId);
  const playChain = play ? focusChain : undefined;
  const playStep = playChain && play ? playChain.steps[Math.min(play.step, playChain.steps.length - 1)] : undefined;

  /* ---------- camera ---------- */
  const dur = reduced ? 0 : 750;
  const fitPadding: FitPadding = narrow
    ? { top: "86px", bottom: "20px", left: "14px", right: "62px" }
    : railOpen
      ? { top: "40px", bottom: "40px", left: "380px", right: "80px" }
      : compact
        ? { top: "96px", bottom: "24px", left: "24px", right: "64px" }
        : { top: "112px", bottom: "40px", left: "40px", right: "80px" };
  const fitPadKey = JSON.stringify(fitPadding);
  const fitAll = useCallback(() => {
    rf.fitView({
      padding: JSON.parse(fitPadKey) as FitPadding,
      duration: dur,
      // Far-zoom labels stay readable down to here; below it, pan instead.
      minZoom: compact ? 0.15 : narrow ? 0.34 : 0.4,
      maxZoom: 1,
    });
  }, [rf, narrow, dur, fitPadKey, compact]);

  // Throttled (not debounced) so a fast stream still refits as it grows, plus a trailing
  // refit once the last tween has settled: fitView measures the nodes where they are *now*,
  // so a fit that lands mid-tween (e.g. the first facts after mounting empty) would stay zoomed in.
  const fitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!autoFit || focusChainId) return;
    if (trailTimer.current) clearTimeout(trailTimer.current);
    trailTimer.current = setTimeout(() => {
      trailTimer.current = null;
      fitAll();
    }, reduced ? 60 : 900);
    if (fitTimer.current) return;
    fitTimer.current = setTimeout(() => {
      fitTimer.current = null;
      fitAll();
    }, reduced ? 30 : 760);
  }, [targetBoxes, autoFit, focusChainId, fitAll, reduced]);
  useEffect(
    () => () => {
      if (fitTimer.current) clearTimeout(fitTimer.current);
      if (trailTimer.current) clearTimeout(trailTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!focusChain) return;
    let ids: string[];
    if (playChain && playStep) {
      ids = [...playStep.findingIds.map(factId), playStep.nextNodeId];
    } else {
      ids = [...focusChain.factNodeIds, focusChain.targetNodeId];
    }
    const t = setTimeout(
      () =>
        rf.fitView({
          nodes: ids.map((id) => ({ id })),
          padding: narrow
            ? { top: "90px", bottom: playStep ? "48%" : "24px", left: "20px", right: "62px" }
            : { top: "60px", bottom: playStep ? "360px" : "60px", left: railOpen ? "390px" : "60px", right: "110px" },
          duration: dur,
          maxZoom: 1.25,
        }),
      30,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusChain?.chain.id, playStep?.index, narrow]);

  /* ---------- chain playback ---------- */
  const startPlay = useCallback((chainId: string) => {
    setSelectedFactId(null);
    setSelectedChainId(chainId);
    setPlay({ chainId, step: 0, running: true });
  }, []);
  const stopPlay = useCallback(() => setPlay(null), []);
  const stepBy = useCallback(
    (d: number) =>
      setPlay((p) => {
        if (!p) return p;
        const c = modelRef.current.chains.find((x) => x.chain.id === p.chainId);
        const max = (c?.steps.length ?? 1) - 1;
        return { ...p, step: Math.max(0, Math.min(max, p.step + d)), running: false };
      }),
    [],
  );
  const toggleRun = useCallback(
    () =>
      setPlay((p) => {
        if (!p) return p;
        const c = modelRef.current.chains.find((x) => x.chain.id === p.chainId);
        const atEnd = p.step >= (c?.steps.length ?? 1) - 1;
        return { ...p, running: !p.running, step: !p.running && atEnd ? 0 : p.step };
      }),
    [],
  );

  const playLen = playChain?.steps.length ?? 0;
  useEffect(() => {
    if (!play?.running) return;
    const t = setTimeout(() => {
      setPlay((p) => {
        if (!p) return p;
        if (p.step >= playLen - 1) return { ...p, running: false };
        return { ...p, step: p.step + 1, running: p.step + 1 < playLen - 1 };
      });
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [play, playLen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        if (play) setPlay(null);
        else if (selectedFactId) setSelectedFactId(null);
        else if (selectedChainId) setSelectedChainId(null);
        return;
      }
      if (!play) return;
      if (e.key === "ArrowRight") stepBy(1);
      else if (e.key === "ArrowLeft") stepBy(-1);
      else if (e.key === " ") {
        e.preventDefault();
        toggleRun();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play, selectedFactId, selectedChainId, stepBy, toggleRun]);

  // Leaving chain focus returns to the overview.
  const prevFocus = useRef<string | null>(null);
  useEffect(() => {
    if (prevFocus.current && !focusChainId) {
      const t = setTimeout(fitAll, 30);
      prevFocus.current = focusChainId;
      return () => clearTimeout(t);
    }
    prevFocus.current = focusChainId;
  }, [focusChainId, fitAll]);

  /* ---------- emphasis ---------- */
  const emphasis = useMemo(() => {
    const node = new Map<string, Emphasis>();
    const badge = new Map<string, { n: number; color: string }>();
    if (!focusChain) return { node, badge, any: false };
    for (const s of focusChain.steps)
      for (const id of s.findingIds)
        if (!badge.has(factId(id))) badge.set(factId(id), { n: s.index + 1, color: focusChain.color });
    for (const id of focusChain.factNodeIds) node.set(id, "focus");
    node.set(focusChain.targetNodeId, "focus");
    if (playStep) {
      for (const s of focusChain.steps) {
        for (const id of s.findingIds) {
          const nid = factId(id);
          if (s.index < playStep.index && node.get(nid) !== "active") node.set(nid, "visited");
          if (s.index > playStep.index && node.get(nid) === "focus") node.set(nid, "normal");
        }
      }
      if (focusChain.targetNodeId !== playStep.nextNodeId) node.set(focusChain.targetNodeId, "normal");
      node.set(playStep.nextNodeId, "next");
      for (const id of playStep.findingIds) node.set(factId(id), "active");
    }
    return { node, badge, any: true };
  }, [focusChain, playStep]);

  const emp = useCallback(
    (id: string): Emphasis => (emphasis.any ? emphasis.node.get(id) ?? "dim" : "normal"),
    [emphasis],
  );

  /* ---------- nodes ---------- */
  const colorsByFinding = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of model.chains)
      for (const id of c.factNodeIds) {
        const arr = m.get(id) ?? [];
        arr.push(c.color);
        m.set(id, arr);
      }
    return m;
  }, [model]);

  const nodes = useMemo(() => {
    const out: Node[] = [];
    const place = (id: string) => {
      const b = boxes.get(id);
      if (!b) return null;
      return {
        position: { x: b.x - b.w / 2, y: b.y - b.h / 2 },
        width: b.w,
        height: b.h,
        className: `am-w-${emp(id)}`,
      };
    };
    const person = place(PERSON_ID);
    if (person)
      out.push({
        id: PERSON_ID,
        type: "person",
        ...person,
        data: { name: subjectName, score, emphasis: emp(PERSON_ID) },
        zIndex: 2,
      } satisfies PersonNodeT);
    for (const s of model.sources) {
      const id = sourceId(s.type);
      const p = place(id);
      if (!p) continue;
      out.push({
        id,
        type: "source",
        ...p,
        data: { type: s.type, count: s.factIds.length, emphasis: emp(id) },
        zIndex: 2,
      } satisfies SourceNodeT);
      for (const fid of s.factIds) {
        const nid = factId(fid);
        const fp = place(nid);
        const f = model.findings.get(fid);
        if (!fp || !f) continue;
        out.push({
          id: nid,
          type: "fact",
          ...fp,
          data: {
            finding: f,
            masked,
            removed: removed.has(fid),
            chainColors: colorsByFinding.get(nid) ?? [],
            selected: selectedFactId === fid,
            emphasis: emp(nid),
            stepBadge: emphasis.badge.get(nid),
          },
          zIndex: 3,
        } satisfies FactNodeT);
      }
    }
    for (const t of model.targets) {
      const p = place(t.id);
      if (!p) continue;
      out.push({
        id: t.id,
        type: "target",
        ...p,
        data: {
          label: t.label,
          blocked: t.blocked,
          chainCount: t.chainIds.length,
          colors: model.chains.filter((c) => c.targetNodeId === t.id).map((c) => c.color),
          emphasis: emp(t.id),
        },
        zIndex: 3,
      } satisfies TargetNodeT);
    }
    return out;
  }, [boxes, model, subjectName, score, masked, removed, colorsByFinding, selectedFactId, emp, emphasis]);

  /* ---------- edges ---------- */
  const edges = useMemo(() => {
    const out: Edge[] = [];
    const structEmp: Emphasis = emphasis.any ? "dim" : "normal";
    for (const s of model.sources) {
      const sid = sourceId(s.type);
      out.push({
        id: `e:${PERSON_ID}:${sid}`,
        source: PERSON_ID,
        target: sid,
        type: "struct",
        data: { emphasis: structEmp },
        zIndex: 0,
      } satisfies StructEdgeT);
      for (const fid of s.factIds) {
        out.push({
          id: `e:${sid}:${fid}`,
          source: sid,
          target: factId(fid),
          type: "struct",
          data: { emphasis: structEmp },
          zIndex: 0,
        } satisfies StructEdgeT);
      }
    }
    model.chains.forEach((c, ci) => {
      const isFocus = c.chain.id === focusChainId;
      const bendBase = 0.1 + 0.05 * Math.floor(ci / 2);
      const bend = ci % 2 === 0 ? bendBase : -bendBase;
      for (const step of c.steps) {
        step.findingIds.forEach((fid, k) => {
          const from = factId(fid);
          if (from === step.nextNodeId) return;
          let e: Emphasis = emphasis.any ? "dim" : "normal";
          if (isFocus) {
            if (playStep) {
              e = step.index < playStep.index ? "visited" : step.index === playStep.index ? "active" : "normal";
            } else e = "focus";
          }
          const labelled = k === 0;
          out.push({
            id: `c:${c.chain.id}:${step.index}:${fid}`,
            source: from,
            target: step.nextNodeId,
            type: "chain",
            zIndex: isFocus ? 5 : 1,
            data: {
              color: c.color,
              bend: bend + k * 0.04,
              stepN: labelled && isFocus ? step.index + 1 : undefined,
              stepTitle: labelled ? step.title : undefined,
              showTitle: labelled && isFocus && !playStep,
              severed: step.severed,
              emphasis: e,
              dash: c.dash,
              final: step.nextNodeId === c.targetNodeId,
            },
          } satisfies ChainEdgeT);
        });
      }
    });
    return out;
  }, [model, emphasis, focusChainId, playStep]);

  /* ---------- render ---------- */
  const selectedFinding = selectedFactId ? model.findings.get(selectedFactId) : undefined;

  return (
    <div className={`am-root${className ? ` ${className}` : ""}${reduced ? " am-reduced" : ""}${narrow && phoneView === "list" ? " am-list-view" : ""}${far ? " am-far" : ""}${compact ? " am-compact" : ""}`}>
      <GeomContext.Provider value={boxes}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          minZoom={0.12}
          maxZoom={2.5}
          fitView
          fitViewOptions={{
            padding: fitPadding,
            minZoom: compact ? 0.15 : narrow ? 0.34 : 0.4,
            maxZoom: 1,
          }}
          proOptions={{ hideAttribution: true }}
          onMoveStart={(ev) => {
            if (ev) setAutoFit(false);
          }}
          onNodeClick={(_, n) => {
            if (n.type === "fact") {
              const fid = n.id.slice(5);
              setSelectedFactId((cur) => (cur === fid ? null : fid));
            } else if (n.type === "target") {
              const c = model.chains.find((x) => x.targetNodeId === n.id);
              if (c && !play) setSelectedChainId((cur) => (cur === c.chain.id ? null : c.chain.id));
            }
          }}
          onPaneClick={() => {
            setSelectedFactId(null);
            if (!play) setSelectedChainId(null);
          }}
          aria-label={`Attack map for ${subjectName}`}
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.3} color="var(--border-strong)" />
        </ReactFlow>
      </GeomContext.Provider>


      {narrow && (
        <div className="am-phone-toggle">
          <SegmentedTabs
            size="sm"
            label="Attack map view"
            value={phoneView}
            onChange={setPhoneView}
            items={[
              { id: "list", label: "Ways in" },
              { id: "map", label: "Map" },
            ]}
          />
        </div>
      )}

      <ChainRail
        model={model}
        masked={masked}
        narrow={narrow && phoneView === "map"}
        selectedChainId={selectedChainId}
        playingChainId={play?.chainId ?? null}
        open={railOpen}
        onOpenChange={setRailUser}
        onSelect={(id) => {
          if (narrow) setPhoneView("map");
          setPlay(null);
          setSelectedChainId((cur) => (cur === id ? null : id));
        }}
        onPlay={(id) => {
          if (narrow) setPhoneView("map");
          startPlay(id);
        }}
      />

      <div className="am-zoom" role="group" aria-label="Map view">
        <button type="button" onClick={() => rf.zoomIn({ duration: dur / 3 })} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => rf.zoomOut({ duration: dur / 3 })} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            setAutoFit(true);
            setPlay(null);
            setSelectedChainId(null);
            fitAll();
          }}
          aria-label="Fit whole map"
          className={autoFit ? "" : "am-zoom-attn"}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <path
              d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {playChain && play && playStep && (
        <ChainPlayer
          chain={playChain}
          step={playStep}
          running={play.running}
          findings={findings}
          masked={masked}
          onPrev={() => stepBy(-1)}
          onNext={() => stepBy(1)}
          onToggle={toggleRun}
          onClose={stopPlay}
          onJump={(i) => setPlay((p) => (p ? { ...p, step: i, running: false } : p))}
        />
      )}

      {selectedFinding && (
        <FactPanel
          finding={selectedFinding}
          masked={masked}
          removed={removed.has(selectedFinding.id)}
          chains={model.chains.filter((c) => model.usage.get(selectedFinding.id)?.includes(c.chain.id))}
          onClose={() => setSelectedFactId(null)}
          onChain={(id) => {
            setSelectedFactId(null);
            setPlay(null);
            setSelectedChainId(id);
          }}
        />
      )}
    </div>
  );
}
