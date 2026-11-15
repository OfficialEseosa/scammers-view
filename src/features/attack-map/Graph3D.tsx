"use client";

import "./attack-map.css";
import "./graph3d.css";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import type { Finding } from "@/lib/types";
import type { AttackMapProps } from "./AttackMap";
import { FactPanel } from "./FactPanel";
import { MapLiquid } from "./MapLiquid";
import { maskValue } from "./mask";
import { buildModel, SOURCE_LABEL } from "./model";
import { isBulkItem } from "@/lib/findingKinds";

/**
 * The footprint as a 3D radial tree, laid out like a slow galaxy: you at the
 * centre, the places you are exposed on the first ring, every fact found one
 * ring further out, and the accounts an attacker can reach on the outside.
 * Drag to turn it, pinch or scroll to zoom. Labels are drawn in WebGL and
 * placed every frame so they point away from you and never stack.
 */

type Kind = "you" | "source" | "hub" | "fact" | "target";

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
  /** Bulk items (posts, followed accounts): small, quiet, no label. */
  faint?: boolean;
  findingId?: string;
  /** Branch parents: children are pulled toward their parent's direction. */
  parents?: string[];
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}
interface GLink {
  source: string | GNode;
  target: string | GNode;
  kind: "found" | "attack";
  cut?: boolean;
  faint?: boolean;
  bend?: number;
}

interface Palette {
  text: string;
  bg: string;
  muted: string;
  danger: string;
  warn: string;
  safe: string;
  light: boolean;
  font: string;
  display: string;
}

interface Vis {
  node: GNode;
  group: THREE.Group;
  coreMat: THREE.MeshLambertMaterial;
  wireMat?: THREE.MeshBasicMaterial;
  halo: THREE.Sprite;
  ring: THREE.Sprite;
  spin?: THREE.Object3D;
  label?: THREE.Sprite;
  labelKey?: string;
  /** Label size in CSS pixels. */
  lw: number;
  lh: number;
  radius: number;
  /** Current and wanted label opacity, eased each frame. */
  op: number;
  want: number;
  scale: number;
}

const EMPTY: string[] = [];
const LEVEL = 58;
const RADIUS: Record<Kind, number> = { you: 8, source: 4.2, hub: 3, fact: 2.2, target: 4.4 };

/* ---------- small helpers ---------- */

const NO_RAY = () => {};
let hitMat: THREE.MeshBasicMaterial | null = null;
const HIT_MAT = () => (hitMat ??= new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));

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

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

let SHARED: { sphere: THREE.SphereGeometry; octa: THREE.OctahedronGeometry; torus: THREE.TorusGeometry; halo: THREE.Texture; ring: THREE.Texture } | null = null;
function shared() {
  if (SHARED) return SHARED;
  const tex = (draw: (ctx: CanvasRenderingContext2D, s: number) => void) => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    draw(ctx, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  SHARED = {
    sphere: new THREE.SphereGeometry(1, 28, 20),
    octa: new THREE.OctahedronGeometry(1, 0),
    torus: new THREE.TorusGeometry(1, 0.018, 6, 96),
    halo: tex((ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.25, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }),
    ring: tex((ctx, s) => {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
      ctx.stroke();
    }),
  };
  return SHARED;
}

/** A crisp two-line label with a soft halo in the background colour, so it reads over lines and smoke. */
function drawLabel(title: string, sub: string | undefined, kind: Kind, p: Palette, titleColor: string, subColor: string) {
  const DPR = 2;
  const titlePx = kind === "you" ? 17 : kind === "fact" ? 12.5 : kind === "hub" ? 13 : 14;
  const subPx = kind === "you" ? 13 : 12;
  const titleFont = `${kind === "fact" || kind === "hub" ? 500 : 600} ${titlePx * DPR}px ${kind === "you" ? p.display : p.font}`;
  const subFont = `500 ${subPx * DPR}px ${p.font}`;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = titleFont;
  const tw = ctx.measureText(title).width;
  ctx.font = subFont;
  const sw = sub ? ctx.measureText(sub).width : 0;
  const pad = 8 * DPR;
  const gap = 3 * DPR;
  const w = Math.ceil(Math.max(tw, sw) + pad * 2);
  const h = Math.ceil(titlePx * 1.25 * DPR + (sub ? subPx * 1.25 * DPR + gap : 0) + pad * 2);
  c.width = w;
  c.height = h;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const paint = (halo: boolean) => {
    ctx.shadowColor = halo ? p.bg : "transparent";
    ctx.shadowBlur = halo ? 7 * DPR : 0;
    ctx.font = titleFont;
    ctx.fillStyle = halo ? p.bg : titleColor;
    ctx.fillText(title, w / 2, pad);
    if (sub) {
      ctx.font = subFont;
      ctx.fillStyle = halo ? p.bg : subColor;
      ctx.fillText(sub, w / 2, pad + titlePx * 1.25 * DPR + gap);
    }
  };
  paint(true);
  paint(true);
  paint(false);
  return { canvas: c, w: w / DPR, h: h / DPR };
}

function forceBranch(strength: number) {
  let nodes: GNode[] = [];
  let byId = new Map<string, GNode>();
  const force = (alpha: number) => {
    for (const n of nodes) {
      if (!n.parents?.length || n.x === undefined) continue;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      for (const pid of n.parents) {
        const p = byId.get(pid);
        if (!p || p.x === undefined) continue;
        const l = Math.hypot(p.x, p.y ?? 0, p.z ?? 0) || 1;
        dx += p.x / l;
        dy += (p.y ?? 0) / l;
        dz += (p.z ?? 0) / l;
      }
      const dl = Math.hypot(dx, dy, dz);
      if (!dl) continue;
      const r = Math.hypot(n.x, n.y ?? 0, n.z ?? 0);
      const k = strength * alpha;
      n.vx = (n.vx ?? 0) + ((dx / dl) * r - n.x) * k;
      n.vy = (n.vy ?? 0) + ((dy / dl) * r - (n.y ?? 0)) * k;
      n.vz = (n.vz ?? 0) + ((dz / dl) * r - (n.z ?? 0)) * k;
    }
  };
  force.initialize = (ns: GNode[]) => {
    nodes = ns;
    byId = new Map(ns.map((n) => [n.id, n]));
  };
  return force;
}

/** Squash the tree toward a thick disc, so an orbit around the vertical axis never turns it edge-on. */
function forceFlat(strength: number) {
  let nodes: GNode[] = [];
  const force = (alpha: number) => {
    for (const n of nodes) if (n.y !== undefined) n.vy = (n.vy ?? 0) - n.y * strength * alpha;
  };
  force.initialize = (ns: GNode[]) => {
    nodes = ns;
  };
  return force;
}

/* ---------- media ---------- */

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useReducedMotion = () =>
  useSyncExternalStore(subscribeReduced, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);

/* ---------- component ---------- */

export function Graph3D({
  findings,
  chains,
  score,
  subjectName,
  masked,
  removedFindingIds = EMPTY,
  className,
  onTarget,
}: AttackMapProps & { onTarget?: (chainId: string) => void }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const fg = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const small = size.w > 0 && size.w < 640;

  const removed = useMemo(() => new Set(removedFindingIds), [removedFindingIds]);
  const model = useMemo(() => buildModel(findings, chains, removed), [findings, chains, removed]);

  /* Mutable scene state read by the per-frame pass (never triggers React renders). */
  const palRef = useRef<Palette | null>(null);
  const visRef = useRef(new Map<string, Vis>());
  const hoverRef = useRef<string | null>(null);
  const selRef = useRef<string | null>(null);
  const sizeRef = useRef(size);
  const smallRef = useRef(small);
  const reduceRef = useRef(reduce);
  const userMoved = useRef(false);
  const fitAt = useRef<{ at: number; ms: number } | null>(null);
  const fontsVer = useRef(0);
  const fitRef = useRef<((ms: number) => void) | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);

  useEffect(() => {
    sizeRef.current = size;
    smallRef.current = small;
    reduceRef.current = reduce;
  }, [size, small, reduce]);

  // Size to the container, and follow the theme.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const readTheme = () => {
      const body = getComputedStyle(document.body);
      const bg = cssColor(el, "--bg", "#000000");
      const lum = parseInt(bg.slice(1, 3), 16) + parseInt(bg.slice(3, 5), 16) + parseInt(bg.slice(5, 7), 16);
      const p: Palette = {
        text: cssColor(el, "--text", "#ffffff"),
        bg,
        muted: cssColor(el, "--muted", "#a3a3a3"),
        danger: cssColor(el, "--danger", "#ff5f52"),
        warn: cssColor(el, "--warn", "#f5b843"),
        safe: cssColor(el, "--safe", "#3ddc97"),
        light: lum > 384,
        font: body.getPropertyValue("--font-sans").trim() || body.fontFamily || "sans-serif",
        display: body.getPropertyValue("--font-display").trim() || body.fontFamily || "sans-serif",
      };
      palRef.current = p;
      setPalette(p);
    };
    readTheme();
    const mo = new MutationObserver(readTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    // Labels are painted to canvas: repaint once the web fonts have arrived.
    document.fonts?.ready.then(() => {
      fontsVer.current += 1;
      readTheme();
    });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  /* ---------- graph data: node objects stay stable so the tree grows instead of restarting ---------- */
  const [cache] = useState(() => new Map<string, GNode>());
  const data = useMemo(() => {
    const nodes: GNode[] = [];
    const links: GLink[] = [];
    const node = (n: GNode) => {
      const prev = cache.get(n.id);
      let next: GNode;
      if (prev) {
        // Drop stale optional fields, keep the simulation's position and velocity.
        for (const k of ["sub", "risk", "cut", "blocked", "inChain", "faint", "findingId", "parents"] as const) delete prev[k];
        next = Object.assign(prev, n);
      } else {
        next = n;
        // New arrivals start next to their parent, not at the centre, so nothing flies across the graph.
        const parent = n.parents?.map((id) => cache.get(id)).find((p) => p?.x !== undefined);
        if (parent && parent.x !== undefined) {
          const j = () => (Math.random() - 0.5) * 8;
          next.x = parent.x * 1.15 + j();
          next.y = (parent.y ?? 0) * 1.15 + j();
          next.z = (parent.z ?? 0) * 1.15 + j();
        }
      }
      cache.set(n.id, next);
      nodes.push(next);
    };
    const inChain = new Set<string>();
    for (const c of model.chains) for (const s of c.steps) for (const id of s.findingIds) inChain.add(id);

    node({ id: "you", kind: "you", label: subjectName || "You", sub: score ? `Exposure ${Math.round(score.score)}` : "Scanning", fx: 0, fy: 0, fz: 0 });
    for (const s of model.sources) {
      const sid = `src:${s.type}`;
      node({ id: sid, kind: "source", label: SOURCE_LABEL[s.type], sub: `${s.factIds.length} ${s.factIds.length === 1 ? "fact" : "facts"}`, parents: ["you"] });
      links.push({ source: "you", target: sid, kind: "found" });
      // Bulk items hang off one hub per source, so they read as a branch of their own.
      const followed = s.factIds.map((id) => model.findings.get(id)).filter((f): f is Finding => !!f && f.category === "connection");
      const hubFinding = followed.find((f) => !f.value.startsWith("@"));
      const hubId = `grp:${s.type}`;
      const posts = s.factIds.map((id) => model.findings.get(id)).filter((f): f is Finding => !!f && f.category !== "connection" && isBulkItem(f));
      const postsId = `posts:${s.type}`;
      if (posts.length > 0) {
        node({ id: postsId, kind: "hub", label: "Public posts", sub: `${posts.length} photos and videos`, parents: [sid] });
        links.push({ source: sid, target: postsId, kind: "found" });
      }
      if (followed.length > 0) {
        node({ id: hubId, kind: "hub", label: "People you follow", sub: hubFinding?.value ?? `${followed.length} accounts`, findingId: hubFinding?.id, parents: [sid] });
        links.push({ source: sid, target: hubId, kind: "found" });
      }
      for (const fid of s.factIds) {
        const f = model.findings.get(fid);
        if (!f) continue;
        const cut = removed.has(fid);
        if (f.category !== "connection" && isBulkItem(f) && !inChain.has(fid)) {
          node({ id: `fact:${fid}`, kind: "fact", label: f.label, sub: masked ? maskValue(f.value, f.category) : f.value, risk: 0, cut, faint: true, findingId: fid, parents: [postsId] });
          links.push({ source: postsId, target: `fact:${fid}`, kind: "found", faint: true });
          continue;
        }
        if (f.category === "connection") {
          if (f === hubFinding) continue;
          node({ id: `fact:${fid}`, kind: "fact", label: f.value, sub: f.label, risk: 0, cut, faint: true, findingId: fid, parents: [hubId] });
          links.push({ source: hubId, target: `fact:${fid}`, kind: "found", faint: true });
          continue;
        }
        node({
          id: `fact:${fid}`,
          kind: "fact",
          label: f.label,
          sub: masked ? maskValue(f.value, f.category) : f.value,
          risk: f.riskWeight,
          cut,
          inChain: inChain.has(fid),
          findingId: fid,
          parents: [sid],
        });
        links.push({ source: sid, target: `fact:${fid}`, kind: "found" });
      }
    }
    for (const t of model.targets) {
      const parents = model.chains
        .filter((c) => c.targetNodeId === t.id)
        .flatMap((c) => c.steps.flatMap((s) => s.findingIds))
        .filter((id) => model.findings.has(id))
        .map((id) => `fact:${id}`);
      node({ id: t.id, kind: "target", label: t.label, sub: t.blocked ? "Takeover blocked" : "See how they get in", blocked: t.blocked, parents: [...new Set(parents)] });
    }
    const seen = new Set<string>();
    let bend = 0;
    for (const c of model.chains) {
      for (const s of c.steps) {
        for (const id of s.findingIds) {
          const key = `${id}>${c.targetNodeId}`;
          if (seen.has(key) || !model.findings.has(id)) continue;
          seen.add(key);
          links.push({ source: `fact:${id}`, target: c.targetNodeId, kind: "attack", cut: removed.has(id) || s.severed, bend: bend++ });
        }
      }
    }
    for (const id of [...cache.keys()]) if (!nodes.some((n) => n.id === id)) cache.delete(id);
    return { nodes, links };
  }, [model, masked, removed, subjectName, score, cache]);

  /* ---------- node visuals ---------- */

  const style = useCallback((v: Vis) => {
    const p = palRef.current;
    if (!p) return;
    const n = v.node;
    const hov = hoverRef.current === n.id;
    const sel = selRef.current === n.id;
    const risk = n.risk ?? 0;
    const colour =
      n.kind === "target"
        ? n.blocked
          ? p.safe
          : p.danger
        : n.kind === "fact"
          ? n.cut
            ? p.safe
            : n.faint
              ? p.muted
              : risk >= 7
                ? p.danger
                : risk >= 4 && n.inChain
                  ? p.warn
                  : p.text
          : p.text;
    const opacity = n.kind === "fact" ? (n.cut ? 0.55 : n.faint ? 0.5 : n.inChain ? 1 : 0.82) : n.kind === "hub" ? 0.85 : 1;
    v.coreMat.color.set(colour);
    v.coreMat.emissive.set(colour).multiplyScalar(p.light ? 0 : n.kind === "target" ? 0.45 : 0.22);
    v.coreMat.opacity = opacity;
    v.coreMat.transparent = opacity < 1;
    v.coreMat.depthWrite = opacity >= 1;
    if (v.wireMat) {
      v.wireMat.color.set(colour);
      v.wireMat.opacity = hov ? 0.9 : 0.55;
    }
    const haloOpacity =
      n.kind === "you" ? 0.42 : n.kind === "target" ? (hov ? 0.75 : 0.45) : n.kind === "source" ? 0.22 : n.kind === "fact" && n.inChain && !n.cut ? 0.24 : 0;
    const haloMat = v.halo.material as THREE.SpriteMaterial;
    haloMat.color.set(colour);
    haloMat.opacity = haloOpacity * (p.light ? 0.55 : 1);
    v.halo.visible = haloOpacity > 0;
    const ringMat = v.ring.material as THREE.SpriteMaterial;
    ringMat.color.set(n.kind === "target" ? colour : p.text);
    v.ring.visible = sel || (hov && n.kind !== "you");
    v.scale = hov && (n.kind === "target" || !!n.findingId) ? 1.22 : sel ? 1.15 : 1;

    // Label text: facts show only their kind; their value lives in the panel.
    const titleColor = n.kind === "target" ? (n.blocked ? p.safe : p.danger) : p.text;
    const subColor = n.kind === "target" ? titleColor : p.muted;
    const title = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
    const sub = n.kind === "fact" ? undefined : n.sub && n.sub.length > 30 ? `${n.sub.slice(0, 29)}…` : n.sub;
    const key = `${title}|${sub}|${titleColor}|${subColor}|${p.bg}|${p.font}|${fontsVer.current}`;
    // Bulk items only get a label (a canvas) once someone points at them.
    const needsLabel = !n.faint || hov || sel || !!v.label;
    if (needsLabel && key !== v.labelKey) {
      v.labelKey = key;
      const { canvas, w, h } = drawLabel(title, sub, n.kind, p, titleColor, subColor);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      if (!v.label) {
        v.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
        v.label.renderOrder = 30;
        // A visible label is part of the node: clicking a target's name opens its steps.
        const lbl = v.label;
        lbl.raycast = (rc, out) => {
          if (v.op > 0.5) THREE.Sprite.prototype.raycast.call(lbl, rc, out);
        };
        v.label.visible = false;
        v.group.add(v.label);
      } else {
        const m = v.label.material as THREE.SpriteMaterial;
        m.map?.dispose();
        m.map = tex;
        m.needsUpdate = true;
      }
      v.lw = w;
      v.lh = h;
    }
  }, []);

  const nodeObject = useCallback(
    (n: GNode) => {
      const S = shared();
      const group = new THREE.Group();
      const radius = n.kind === "fact" ? (n.faint ? 1.25 : n.inChain ? 2.8 : RADIUS.fact) : RADIUS[n.kind];
      const coreMat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
      let wireMat: THREE.MeshBasicMaterial | undefined;
      let spin: THREE.Object3D | undefined;
      if (n.kind === "target") {
        const core = new THREE.Mesh(S.octa, coreMat);
        core.scale.setScalar(radius);
        wireMat = new THREE.MeshBasicMaterial({ color: "#ffffff", wireframe: true, transparent: true, opacity: 0.55 });
        const wire = new THREE.Mesh(S.octa, wireMat);
        wire.scale.setScalar(radius * 1.75);
        group.add(core, wire);
        spin = wire;
      } else {
        const core = new THREE.Mesh(S.sphere, coreMat);
        core.scale.setScalar(radius);
        group.add(core);
      }
      if (n.kind === "you" || n.kind === "source") {
        // Thin orbit rings give the hubs presence without heavy geometry.
        const ringMat = new THREE.MeshBasicMaterial({ color: palRef.current?.text ?? "#ffffff", transparent: true, opacity: n.kind === "you" ? 0.35 : 0.2, depthWrite: false });
        const orbit = new THREE.Group();
        const a = new THREE.Mesh(S.torus, ringMat);
        a.scale.setScalar(radius * (n.kind === "you" ? 1.9 : 1.8));
        a.rotation.x = Math.PI / 2.4;
        orbit.add(a);
        if (n.kind === "you") {
          const b = new THREE.Mesh(S.torus, ringMat);
          b.scale.setScalar(radius * 2.5);
          b.rotation.x = Math.PI / 2;
          b.rotation.y = Math.PI / 5;
          orbit.add(b);
        }
        group.add(orbit);
        spin = orbit;
      }
      // A larger invisible sphere makes small nodes easy to tap; decorations never catch the pointer.
      const hit = new THREE.Mesh(S.sphere, HIT_MAT());
      hit.scale.setScalar(Math.max(radius * 2.2, n.faint ? 5 : 8));
      group.add(hit);
      for (const child of group.children) if (child !== hit && child.type !== "Mesh") child.raycast = NO_RAY;
      if (spin && n.kind !== "target") spin.traverse((o) => (o.raycast = NO_RAY));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: S.halo, transparent: true, depthWrite: false, opacity: 0 }));
      halo.scale.setScalar(radius * (n.kind === "you" ? 7 : n.kind === "target" ? 6 : 5));
      group.add(halo);
      halo.raycast = NO_RAY;
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: S.ring, transparent: true, depthWrite: false, depthTest: false }));
      ring.raycast = NO_RAY;
      ring.scale.setScalar(radius * 3.2 + 3);
      ring.visible = false;
      group.add(ring);
      const v: Vis = { node: n, group, coreMat, wireMat, halo, ring, spin, lw: 0, lh: 0, radius, op: 0, want: 0, scale: 1 };
      style(v);
      visRef.current.set(n.id, v);
      return group;
    },
    [style],
  );

  // Re-style everything when the data or theme changes (objects themselves persist across updates).
  useEffect(() => {
    const live = new Set(data.nodes.map((n) => n.id));
    for (const [id, v] of visRef.current) {
      if (!live.has(id)) {
        visRef.current.delete(id);
        continue;
      }
      style(v);
    }
  }, [data, palette, style]);

  /* ---------- scene setup: lights, fog, forces, controls, per-frame pass ---------- */
  const mounted = size.w > 0;
  useEffect(() => {
    const g = fg.current;
    if (!g || !mounted) return;
    const scene = g.scene();
    const camera = g.camera() as THREE.PerspectiveCamera;
    const renderer = g.renderer() as THREE.WebGLRenderer;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse || smallRef.current ? 1.5 : 2));

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(0.6, 1, 0.8);
    g.lights([new THREE.AmbientLight(0xffffff, 0.75), key]);
    const fog = new THREE.Fog(0x000000, 100, 1000);
    scene.fog = fog;

    g.d3Force("branch", forceBranch(0.16) as never);
    g.d3Force("flat", forceFlat(0.32) as never);
    const charge = g.d3Force("charge") as unknown as { strength?: (fn: (n: GNode) => number) => void } | undefined;
    charge?.strength?.((n: GNode) => (n.faint ? -6 : n.kind === "you" ? -140 : n.kind === "target" ? -60 : -42));
    const link = g.d3Force("link") as unknown as { strength?: (fn: (l: GLink) => number) => void } | undefined;
    link?.strength?.((l: GLink) => (l.kind === "attack" ? 0.02 : 0.5));
    g.d3ReheatSimulation();

    type Orbit = {
      autoRotate: boolean;
      autoRotateSpeed: number;
      enableDamping: boolean;
      dampingFactor: number;
      rotateSpeed: number;
      zoomSpeed: number;
      enablePan: boolean;
      minDistance: number;
      maxDistance: number;
      minPolarAngle: number;
      maxPolarAngle: number;
      addEventListener: (e: string, cb: () => void) => void;
      removeEventListener: (e: string, cb: () => void) => void;
    };
    const controls = g.controls() as unknown as Orbit;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = coarse ? 0.7 : 0.55;
    controls.zoomSpeed = 0.8;
    controls.enablePan = false;
    controls.minDistance = 30;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI - 0.15;
    controls.autoRotate = !reduceRef.current;
    controls.autoRotateSpeed = 0.35;
    const onStart = () => {
      userMoved.current = true;
      controls.autoRotate = false;
      fitAt.current = null;
    };
    controls.addEventListener("start", onStart);

    // First framing: look down on the disc from above-front, you in the middle.
    camera.position.set(0, 260, 380);
    fitAt.current = { at: performance.now() + 60, ms: 0 };

    const v3 = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const centre = new THREE.Vector3();
    let frame = 0;
    let lastBg = "";

    const graphRadius = () => {
      let r = LEVEL;
      for (const v of visRef.current.values()) {
        const n = v.node;
        if (n.x === undefined) continue;
        r = Math.max(r, Math.hypot(n.x, n.z ?? 0) + v.radius, Math.abs(n.y ?? 0) * 1.4);
      }
      return r;
    };

    /** Frame the whole tree around the origin, keeping the current viewing direction. */
    const fit = (ms: number) => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const dir = camera.position.clone();
      if (dir.lengthSq() < 1) dir.set(0, 0.6, 1);
      dir.normalize();
      // Phones are tall: look down more steeply so the disc fills the height.
      const wantUp = smallRef.current ? 0.78 : 0.5;
      if (!userMoved.current) {
        const flat = Math.hypot(dir.x, dir.z) || 1;
        const s = Math.sqrt(1 - wantUp * wantUp);
        dir.set((dir.x / flat) * s, wantUp, (dir.z / flat) * s);
      }
      const fwd = dir.clone().negate();
      const r = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const u = new THREE.Vector3().crossVectors(r, fwd).normalize();
      // Leave room for the overlays at the top and bottom, and for labels at the sides.
      const padY = smallRef.current ? 104 : 96;
      const padX = smallRef.current ? 12 : 90;
      const tanV = Math.tan(((camera.fov / 2) * Math.PI) / 180) * Math.max(0.3, 1 - (padY * 2) / h);
      const tanH = Math.tan(((camera.fov / 2) * Math.PI) / 180) * (w / h) * Math.max(0.3, 1 - (padX * 2) / w);
      let dist = 120;
      // The disc keeps turning, so frame every node at eight turns of the vertical axis.
      const spin = !reduceRef.current && !userMoved.current;
      const turns = spin ? 8 : 1;
      for (const v of visRef.current.values()) {
        const n = v.node;
        if (n.x === undefined) continue;
        const m = v.radius + (n.kind === "target" ? 14 : 4);
        for (let k = 0; k < turns; k++) {
          const a = (k / turns) * Math.PI * 2;
          const x = n.x * Math.cos(a) - (n.z ?? 0) * Math.sin(a);
          const z = n.x * Math.sin(a) + (n.z ?? 0) * Math.cos(a);
          v3.set(x, n.y ?? 0, z);
          const need = Math.max((Math.abs(v3.dot(u)) + m) / tanV, (Math.abs(v3.dot(r)) + m) / tanH) - v3.dot(fwd);
          dist = Math.max(dist, need);
        }
      }
      const pos = dir.multiplyScalar(dist);
      g.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: 0, z: 0 }, ms);
      (controls as unknown as { maxDistance: number }).maxDistance = dist * 3;
    };
    fitRef.current = fit;

    scene.onBeforeRender = () => {
      frame++;
      const p = palRef.current;
      const { w, h } = sizeRef.current;
      if (!p || !w || !h) return;
      const now = performance.now();
      if (fitAt.current && now >= fitAt.current.at) {
        const req = fitAt.current;
        fitAt.current = null;
        fit(req.ms);
      }
      if (p.bg !== lastBg) {
        fog.color.set(p.bg);
        lastBg = p.bg;
      }
      const R = graphRadius();
      const camDist = camera.position.length();
      fog.near = Math.max(1, camDist - R * 0.2);
      fog.far = camDist + R * 2.2;

      camera.updateMatrixWorld();
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      centre.set(0, 0, 0).project(camera);
      const cx = ((centre.x + 1) / 2) * w;
      const cy = ((1 - centre.y) / 2) * h;
      const tanV = Math.tan(((camera.fov / 2) * Math.PI) / 180);
      const reduceNow = reduceRef.current;
      const compact = smallRef.current;
      const spinBy = reduceNow ? 0 : 0.0025;

      type Item = { v: Vis; pri: number; base: number; x0: number; y0: number; x1: number; y1: number };
      const items: Item[] = [];
      for (const v of visRef.current.values()) {
        const n = v.node;
        // Ease hover scale.
        const s = v.group.scale.x + (v.scale - v.group.scale.x) * (reduceNow ? 1 : 0.2);
        v.group.scale.setScalar(s);
        if (v.spin) v.spin.rotation.y += n.kind === "target" ? spinBy * 2 : spinBy;
        if (!v.label || n.x === undefined) continue;
        const hov = hoverRef.current === n.id;
        const sel = selRef.current === n.id;
        let base = 0;
        let pri = 0;
        if (hov || sel) {
          base = 1;
          pri = 1000;
        } else if (n.kind === "you") {
          base = 1;
          pri = 900;
        } else if (n.kind === "target") {
          base = 1;
          pri = n.blocked ? 780 : 820;
        } else if (n.kind === "source") {
          base = 0.95;
          pri = 600;
        } else if (n.kind === "hub") {
          base = compact ? 0 : 0.7;
          pri = 400;
        } else if (n.kind === "fact" && n.inChain && !compact) {
          base = 0.62;
          pri = 200 + (n.risk ?? 0);
        }
        v3.set(n.x, n.y ?? 0, n.z ?? 0);
        const dist = camera.position.distanceTo(v3);
        const wpp = (2 * tanV * dist) / h;
        v3.project(camera);
        if (v3.z > 1 || base === 0) {
          v.want = 0;
          continue;
        }
        const sx = ((v3.x + 1) / 2) * w;
        const sy = ((1 - v3.y) / 2) * h;
        let dx = sx - cx;
        let dy = sy - cy;
        const dl = Math.hypot(dx, dy);
        if (n.kind === "you" || dl < 6) {
          dx = 0;
          dy = 1;
        } else {
          dx /= dl;
          dy /= dl;
        }
        const rpx = (v.radius * s) / wpp;
        const off = rpx + 4 + (Math.abs(dx) * v.lw) / 2 + (Math.abs(dy) * v.lh) / 2 - 6;
        // Keep labels inside the frame: near an edge they slide along it instead of being cut off.
        const lx = Math.min(w - v.lw / 2 + 4, Math.max(v.lw / 2 - 4, sx + dx * off));
        const ly = Math.min(h - v.lh / 2 + 4, Math.max(v.lh / 2 - 4, sy + dy * off));
        v.label.position.copy(right).multiplyScalar(((lx - sx) * wpp) / s).addScaledVector(up, (-(ly - sy) * wpp) / s);
        v.label.scale.set((v.lw * wpp) / s, (v.lh * wpp) / s, 1);
        // Labels further back than the centre fade a little: a depth cue that keeps the front readable.
        const depth = Math.min(1, Math.max(n.kind === "target" || n.kind === "you" ? 0.85 : 0.5, 1 - (dist - camDist) / (R * 2)));
        items.push({ v, pri, base: base * depth, x0: lx - v.lw / 2 + 6, y0: ly - v.lh / 2 + 6, x1: lx + v.lw / 2 - 6, y1: ly + v.lh / 2 - 6 });
      }
      // Greedy collision culling, highest priority first.
      if (frame % 2 === 0 || reduceNow) {
        items.sort((a, b) => b.pri - a.pri);
        const taken: Item[] = [];
        for (const it of items) {
          const off = it.x1 < 0 || it.y1 < 0 || it.x0 > w || it.y0 > h;
          const hit = taken.some((t) => it.x0 < t.x1 && it.x1 > t.x0 && it.y0 < t.y1 && it.y1 > t.y0);
          if (off || (hit && it.pri < 1000)) it.v.want = 0;
          else {
            it.v.want = it.base;
            taken.push(it);
          }
        }
      }
      for (const v of visRef.current.values()) {
        if (!v.label) continue;
        v.op += (v.want - v.op) * (reduceNow ? 1 : 0.18);
        if (Math.abs(v.want - v.op) < 0.01) v.op = v.want;
        const m = v.label.material as THREE.SpriteMaterial;
        m.opacity = v.op;
        v.label.visible = v.op > 0.01;
      }
    };

    return () => {
      controls.removeEventListener("start", onStart);
      scene.onBeforeRender = () => {};
      fitRef.current = null;
    };
  }, [mounted]);

  // Keep the whole tree framed as it grows, until the person takes the camera.
  const count = data.nodes.length;
  useEffect(() => {
    if (userMoved.current) return;
    const ms = reduce ? 0 : 900;
    fitAt.current = { at: performance.now() + (count < 3 ? 60 : 700), ms: count < 3 ? 0 : ms };
  }, [count, size.w, size.h, small, reduce]);

  // Auto-rotate follows the reduced-motion setting.
  useEffect(() => {
    const g = fg.current;
    if (!g || !mounted) return;
    const c = g.controls() as unknown as { autoRotate: boolean };
    c.autoRotate = !reduce && !userMoved.current;
  }, [reduce, mounted]);

  // Stop rendering entirely while off screen or in a hidden tab.
  useEffect(() => {
    const el = wrap.current;
    const g = fg.current;
    if (!el || !g || !mounted) return;
    let onScreen = true;
    const sync = () => {
      if (onScreen && document.visibilityState === "visible") g.resumeAnimation();
      else g.pauseAnimation();
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [mounted]);

  const restyle = (id: string | null) => {
    if (!id) return;
    const v = visRef.current.get(id);
    if (v) style(v);
  };
  const closePanel = () => {
    const prev = selRef.current;
    selRef.current = null;
    restyle(prev);
    setOpen(null);
  };

  // Escape closes the detail panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const goToTarget = (n: GNode, chainId: string) => {
    if (leaving) return;
    setLeaving(chainId);
    const g = fg.current;
    if (g && n.x !== undefined && !reduce) {
      const l = Math.hypot(n.x, n.y ?? 0, n.z ?? 0) || 1;
      const k = (l + 70) / l;
      g.cameraPosition({ x: n.x * k, y: (n.y ?? 0) * k + 40, z: (n.z ?? 0) * k }, { x: n.x, y: n.y ?? 0, z: n.z ?? 0 }, 650);
      window.setTimeout(() => onTarget?.(chainId), 560);
    } else onTarget?.(chainId);
  };

  /* ---------- link styling ---------- */
  const pal = palette;
  const linkColor = useCallback(
    (l: GLink) => {
      if (!pal) return "rgba(255,255,255,0.2)";
      if (l.kind === "attack") return l.cut ? rgba(pal.safe, 0.7) : rgba(pal.danger, 0.62);
      return rgba(pal.text, l.faint ? 0.1 : pal.light ? 0.3 : 0.24);
    },
    [pal],
  );
  // Width changes rebuild every link object, so keep this stable.
  const linkWidth = useCallback((l: GLink) => (l.kind === "attack" && !small ? 0.55 : 0), [small]);
  const particles = useCallback((l: GLink) => (l.kind === "attack" && !l.cut && !reduce ? (small ? 1 : 2) : 0), [reduce, small]);

  const openFinding: Finding | undefined = open ? model.findings.get(open) : undefined;
  const ways = model.chains.filter((c) => !c.broken).length;
  const hoverTarget = hover?.kind === "target";

  return (
    <div ref={wrap} className={`g3-root${leaving ? " g3-leaving" : ""}${hover && (hover.kind === "target" || hover.findingId) ? " g3-pointer" : ""} ${className ?? ""}`}>
      <MapLiquid />
      {mounted && pal && (
        <div className="g3-canvas">
          <ForceGraph3D<GNode, GLink>
            ref={fg}
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            rendererConfig={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
            controlType="orbit"
            showNavInfo={false}
            dagMode="radialout"
            dagLevelDistance={LEVEL}
            onDagError={() => undefined}
            warmupTicks={reduce ? 220 : 50}
            cooldownTicks={reduce ? 0 : Infinity}
            cooldownTime={6000}
            d3AlphaDecay={0.028}
            d3VelocityDecay={0.38}
            nodeThreeObject={nodeObject}
            nodeLabel={() => ""}
            linkColor={linkColor}
            linkOpacity={1}
            linkWidth={linkWidth}
            linkResolution={6}
            linkCurvature={(l) => (l.kind === "attack" ? 0.28 : 0)}
            linkCurveRotation={(l) => ((l.bend ?? 0) * 1.3) % (Math.PI * 2)}
            linkDirectionalParticles={particles}
            linkDirectionalParticleWidth={small ? 1.8 : 1.4}
            linkDirectionalParticleSpeed={0.006}
            linkDirectionalParticleColor={() => pal.danger}
            linkDirectionalParticleResolution={6}
            enableNodeDrag={false}
            onEngineStop={() => {
              if (!userMoved.current) fitAt.current = { at: performance.now(), ms: reduce ? 0 : 700 };
            }}
            onNodeHover={(n) => {
              const prev = hoverRef.current;
              hoverRef.current = n?.id ?? null;
              restyle(prev);
              restyle(hoverRef.current);
              setHover(n ?? null);
            }}
            onNodeClick={(n) => {
              if (n.kind === "target") {
                // A red target is an account at risk: open the step-by-step view of how it falls.
                const chain = model.chains.find((c) => c.targetNodeId === n.id && !c.broken) ?? model.chains.find((c) => c.targetNodeId === n.id);
                if (chain) goToTarget(n, chain.chain.id);
                return;
              }
              if (!n.findingId) return;
              const prev = selRef.current;
              selRef.current = n.id;
              restyle(prev);
              restyle(n.id);
              setOpen(n.findingId);
            }}
            onBackgroundClick={closePanel}
          />
        </div>
      )}

      <div className="g3-stats" aria-hidden>
        <span>
          <b>{findings.length}</b> facts
        </span>
        <span>
          <b>{model.sources.length}</b> sources
        </span>
        <span className={ways > 0 ? "g3-stat-hot" : undefined}>
          <b>{ways}</b> {ways === 1 ? "way in" : "ways in"}
        </span>
      </div>

      {hover && hover.kind !== "you" && !openFinding && (
        <div className={`g3-tip${hoverTarget ? " g3-tip-target" : ""}`} role="status">
          <span className="g3-tip-title">{hover.label}</span>
          {hoverTarget ? (
            <span className="g3-tip-cta">{hover.blocked ? "Blocked by your fixes. Click to see the steps" : "Click to see how they get in"}</span>
          ) : (
            hover.sub && <span className={`g3-tip-sub${hover.kind === "fact" ? " g3-mono" : ""}`}>{hover.sub}</span>
          )}
        </div>
      )}

      <p className="g3-hint" aria-hidden>
        {small ? "Drag to turn. Pinch to zoom. Tap a red account." : "Drag to turn. Scroll to zoom. Click a red account to see how."}
      </p>

      <div className="g3-legend" aria-hidden>
        <span>
          <i className="g3-l-fact" /> Fact
        </span>
        <span>
          <i className="g3-l-risk" /> High risk
        </span>
        <span>
          <i className="g3-l-target" /> Account at risk
        </span>
        <span>
          <i className="g3-l-cut" /> Cut by a fix
        </span>
      </div>

      <button
        type="button"
        className="g3-fit"
        onClick={() => {
          userMoved.current = false;
          fitRef.current?.(reduce ? 0 : 650);
        }}
        aria-label="Fit the whole graph"
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
          <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {openFinding && (
        <FactPanel
          finding={openFinding}
          masked={masked}
          removed={removed.has(openFinding.id)}
          chains={model.chains.filter((c) => (model.usage.get(openFinding.id) ?? []).includes(c.chain.id))}
          onClose={closePanel}
          onChain={(id) => {
            closePanel();
            onTarget?.(id);
          }}
        />
      )}
    </div>
  );
}
