"use client";

import "./attack-map.css";
import "./graph3d.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import type { Finding } from "@/lib/types";
import type { AttackMapProps } from "./AttackMap";
import { FactPanel } from "./FactPanel";
import { maskValue } from "./mask";
import { buildModel, SOURCE_LABEL } from "./model";

/**
 * The footprint as a 3D radial tree: you at the centre, the places you are
 * exposed around you, every fact found one ring further out, and the accounts
 * an attacker can reach on the outside. Drag to turn it, scroll to zoom.
 */

type Kind = "you" | "source" | "fact" | "target";

interface GNode {
  id: string;
  kind: Kind;
  label: string;
  sub?: string;
  /** 0..10 for facts. */
  risk?: number;
  cut?: boolean;
  blocked?: boolean;
  inChain?: boolean;
  /** A followed account: drawn small and quiet, hanging off a "People you follow" hub. */
  faint?: boolean;
  findingId?: string;
  x?: number;
  y?: number;
  z?: number;
}
interface GLink {
  source: string | GNode;
  target: string | GNode;
  kind: "found" | "attack";
  cut?: boolean;
}

const EMPTY: string[] = [];

/** Resolve a CSS colour (any syntax) to a hex string three.js understands. */
function cssColor(el: Element, name: string, fallback: string): string {
  try {
    const raw = getComputedStyle(el).getPropertyValue(name).trim();
    if (!raw) return fallback;
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d");
    if (!ctx) return fallback;
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

export function Graph3D({ findings, chains, score, subjectName, masked, removedFindingIds = EMPTY, className }: AttackMapProps) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const fg = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const [palette, setPalette] = useState({ text: "#ffffff", bg: "#000000", muted: "#8a8a8a", danger: "#ff5a4d", warn: "#f2b441", safe: "#5fd4a4" });

  const removed = useMemo(() => new Set(removedFindingIds), [removedFindingIds]);
  const model = useMemo(() => buildModel(findings, chains, removed), [findings, chains, removed]);

  // Size to the container, and follow the theme.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const readTheme = () =>
      setPalette({
        text: cssColor(el, "--text", "#ffffff"),
        bg: cssColor(el, "--bg", "#000000"),
        muted: cssColor(el, "--muted", "#8a8a8a"),
        danger: cssColor(el, "--danger", "#ff5a4d"),
        warn: cssColor(el, "--warn", "#f2b441"),
        safe: cssColor(el, "--safe", "#5fd4a4"),
      });
    readTheme();
    const mo = new MutationObserver(readTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // Keep node objects stable across updates so the graph grows instead of restarting.
  const [cache] = useState(() => new Map<string, GNode>());
  const data = useMemo(() => {
    const nodes: GNode[] = [];
    const links: GLink[] = [];
    const node = (n: GNode) => {
      const prev = cache.get(n.id);
      const next = prev ? Object.assign(prev, n) : n;
      cache.set(n.id, next);
      nodes.push(next);
    };
    const inChain = new Set<string>();
    for (const c of model.chains) for (const s of c.steps) for (const id of s.findingIds) inChain.add(id);

    node({ id: "you", kind: "you", label: subjectName || "You", sub: score ? `Exposure ${Math.round(score.score)}` : "Scanning" });
    for (const s of model.sources) {
      node({ id: `src:${s.type}`, kind: "source", label: SOURCE_LABEL[s.type], sub: `${s.factIds.length} ${s.factIds.length === 1 ? "fact" : "facts"}` });
      links.push({ source: "you", target: `src:${s.type}`, kind: "found" });
      // People the subject follows hang off one hub per source, so they read as a branch of their own.
      const followed = s.factIds.map((id) => model.findings.get(id)).filter((f): f is Finding => !!f && f.category === "connection");
      const hubFinding = followed.find((f) => !f.value.startsWith("@"));
      const hubId = `grp:${s.type}`;
      if (followed.length > 0) {
        node({ id: hubId, kind: "source", label: "People you follow", sub: hubFinding?.value ?? `${followed.length} accounts`, findingId: hubFinding?.id });
        links.push({ source: `src:${s.type}`, target: hubId, kind: "found" });
      }
      for (const fid of s.factIds) {
        const f = model.findings.get(fid);
        if (!f) continue;
        if (f.category === "connection") {
          if (f === hubFinding) continue;
          node({ id: `fact:${fid}`, kind: "fact", label: f.value, sub: f.label, risk: 0, cut: removed.has(fid), faint: true, findingId: fid });
          links.push({ source: hubId, target: `fact:${fid}`, kind: "found" });
          continue;
        }
        node({
          id: `fact:${fid}`,
          kind: "fact",
          label: f.label,
          sub: masked ? maskValue(f.value, f.category) : f.value,
          risk: f.riskWeight,
          cut: removed.has(fid),
          inChain: inChain.has(fid),
          findingId: fid,
        });
        links.push({ source: `src:${s.type}`, target: `fact:${fid}`, kind: "found" });
      }
    }
    for (const t of model.targets) node({ id: t.id, kind: "target", label: t.label, sub: t.blocked ? "Takeover blocked" : "Can be taken over", blocked: t.blocked });
    const seen = new Set<string>();
    for (const c of model.chains) {
      for (const s of c.steps) {
        for (const id of s.findingIds) {
          const key = `${id}>${c.targetNodeId}`;
          if (seen.has(key) || !model.findings.has(id)) continue;
          seen.add(key);
          links.push({ source: `fact:${id}`, target: c.targetNodeId, kind: "attack", cut: removed.has(id) || s.severed });
        }
      }
    }
    for (const id of [...cache.keys()]) if (!nodes.some((n) => n.id === id)) cache.delete(id);
    return { nodes, links };
  }, [model, masked, removed, subjectName, score, cache]);

  // Slow turn until the person takes over; fit the camera as the graph grows.
  const reduce = typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const count = data.nodes.length;
  useEffect(() => {
    const g = fg.current;
    if (!g || !size.w) return;
    const controls = g.controls() as { autoRotate?: boolean; autoRotateSpeed?: number; addEventListener?: (e: string, cb: () => void) => void };
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = 0.55;
    const stop = () => {
      controls.autoRotate = false;
    };
    controls.addEventListener?.("start", stop);
    // Fit while it is still settling, and once more when it comes to rest (see onEngineStop).
    const id = window.setTimeout(() => g.zoomToFit(700, 36), 1100);
    return () => window.clearTimeout(id);
  }, [count, size.w, size.h, reduce]);
  const [fitted, setFitted] = useState(0);

  const nodeObject = useCallback(
    (n: GNode) => {
      const group = new THREE.Group();
      const ink = new THREE.Color(palette.text);
      const riskColor = n.cut ? palette.safe : (n.risk ?? 0) >= 7 ? palette.danger : (n.risk ?? 0) >= 4 ? palette.warn : palette.text;
      const radius = n.kind === "you" ? 11 : n.kind === "source" ? 5.5 : n.kind === "target" ? 7 : n.faint ? 1.5 : n.inChain ? 3.4 : 2.2;

      if (n.kind === "target") {
        const colour = new THREE.Color(n.blocked ? palette.safe : palette.danger);
        group.add(new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), new THREE.MeshBasicMaterial({ color: colour, wireframe: true })));
        group.add(new THREE.Mesh(new THREE.OctahedronGeometry(radius * 0.55, 0), new THREE.MeshBasicMaterial({ color: colour })));
      } else {
        const colour = n.kind === "fact" ? new THREE.Color(riskColor) : ink;
        const opacity = n.kind === "fact" ? (n.cut ? 0.35 : n.faint ? 0.42 : n.inChain ? 1 : 0.62) : 1;
        group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 20), new THREE.MeshBasicMaterial({ color: colour, transparent: opacity < 1, opacity })));
      }
      if (n.kind === "you" || n.kind === "source") {
        // A faint shell gives the hub nodes depth without lighting.
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(radius * (n.kind === "you" ? 1.9 : 1.6), 24, 24),
          new THREE.MeshBasicMaterial({ color: ink, transparent: true, opacity: n.kind === "you" ? 0.1 : 0.07, depthWrite: false }),
        );
        group.add(shell);
        group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * (n.kind === "you" ? 1.45 : 1.3), 16, 16), new THREE.MeshBasicMaterial({ color: ink, wireframe: true, transparent: true, opacity: 0.16 })));
      }
      if (n.kind !== "fact" || n.inChain) {
        const text = new SpriteText(n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label);
        text.color = n.kind === "target" ? (n.blocked ? palette.safe : palette.danger) : palette.text;
        text.textHeight = n.kind === "you" ? 6.5 : n.kind === "fact" ? 3 : 4.4;
        text.fontFace = getComputedStyle(document.body).fontFamily || "sans-serif";
        text.fontWeight = n.kind === "fact" ? "500" : "600";
        text.backgroundColor = false as unknown as string;
        text.position.set(0, -(radius + (n.kind === "you" ? 9 : 6.5)), 0);
        group.add(text);
      }
      return group;
    },
    [palette],
  );

  const openFinding: Finding | undefined = open ? model.findings.get(open) : undefined;
  const ways = model.chains.filter((c) => !c.broken).length;

  return (
    <div ref={wrap} className={`g3-root ${className ?? ""}`}>
      {size.w > 0 && (
        <ForceGraph3D<GNode, GLink>
          ref={fg}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          dagMode="radialout"
          dagLevelDistance={62}
          d3VelocityDecay={0.32}
          cooldownTime={4200}
          nodeRelSize={4}
          nodeThreeObject={nodeObject}
          nodeLabel={() => ""}
          linkColor={(l) => (l.kind === "attack" ? (l.cut ? palette.safe : palette.danger) : palette.text)}
          linkOpacity={0.34}
          linkWidth={(l) => (l.kind === "attack" ? 1.1 : 0.3)}
          linkDirectionalParticles={(l) => (l.kind === "attack" && !l.cut && !reduce ? 3 : 0)}
          linkDirectionalParticleWidth={1.6}
          linkDirectionalParticleSpeed={0.008}
          linkDirectionalParticleColor={() => palette.danger}
          enableNodeDrag={false}
          onEngineStop={() => {
            if (fitted === count) return;
            setFitted(count);
            fg.current?.zoomToFit(700, 36);
          }}
          onNodeHover={(n) => setHover(n ?? null)}
          onNodeClick={(n) => {
            if (n.findingId) setOpen(n.findingId);
            const g = fg.current;
            if (!g || n.x === undefined) return;
            const dist = n.kind === "you" ? 260 : 120;
            const len = Math.hypot(n.x, n.y ?? 0, n.z ?? 0) || 1;
            const k = 1 + dist / len;
            g.cameraPosition({ x: n.x * k, y: (n.y ?? 0) * k, z: (n.z ?? 0) * k || dist }, { x: n.x, y: n.y ?? 0, z: n.z ?? 0 }, 900);
          }}
          onBackgroundClick={() => setOpen(null)}
        />
      )}

      <div className="g3-stats" aria-hidden>
        <span>
          <b>{findings.length}</b> facts
        </span>
        <span>
          <b>{model.sources.length}</b> sources
        </span>
        <span>
          <b>{ways}</b> {ways === 1 ? "way in" : "ways in"}
        </span>
      </div>

      {hover && hover.kind !== "you" && (
        <div className="g3-tip" role="status">
          <span className="g3-tip-title">{hover.label}</span>
          {hover.sub && <span className={`g3-tip-sub${hover.kind === "fact" ? " g3-mono" : ""}`}>{hover.sub}</span>}
        </div>
      )}

      <div className="g3-hint" aria-hidden>
        Drag to turn · scroll to zoom · click a fact
      </div>

      <div className="g3-legend" aria-hidden>
        <span>
          <i className="g3-l-fact" /> Fact
        </span>
        <span>
          <i className="g3-l-risk" /> High risk
        </span>
        <span>
          <i className="g3-l-attack" /> Used in an attack
        </span>
        <span>
          <i className="g3-l-cut" /> Cut by a fix
        </span>
      </div>

      <button type="button" className="g3-fit" onClick={() => fg.current?.zoomToFit(600, 70)} aria-label="Fit the whole graph">
        Fit
      </button>

      {openFinding && (
        <FactPanel
          finding={openFinding}
          masked={masked}
          removed={removed.has(openFinding.id)}
          chains={model.chains.filter((c) => (model.usage.get(openFinding.id) ?? []).includes(c.chain.id))}
          onClose={() => setOpen(null)}
          onChain={() => setOpen(null)}
        />
      )}
    </div>
  );
}
