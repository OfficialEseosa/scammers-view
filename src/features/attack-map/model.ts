import type { AttackChain, Finding, SourceType } from "@/lib/types";

/* ---------- fixed geometry (map units at zoom 1) ---------- */

export const SIZE = {
  person: { w: 220, h: 220 },
  source: { w: 280, h: 66 },
  fact: { w: 300, h: 92 },
  target: { w: 340, h: 124 },
} as const;

export type NodeKind = keyof typeof SIZE;

export interface Box {
  x: number; // center
  y: number; // center
  w: number;
  h: number;
}

export const PERSON_ID = "person";
export const sourceId = (t: SourceType) => `src:${t}`;
export const factId = (id: string) => `fact:${id}`;
export const targetKey = (target: string) =>
  `tgt:${target.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/** Chains are told apart by line style, not hue: solid, dashed, dotted. Red is reserved for the step into the account. */
export const CHAIN_COLORS = ["var(--text)"];
export const CHAIN_DASH = ["none", "12 8", "2 7"];

export const SOURCE_LABEL: Record<SourceType, string> = {
  web: "Web search",
  github: "GitHub",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  x: "X",
  tiktok: "TikTok",
  bluesky: "Bluesky",
  school: "School sites",
  broker: "Data brokers",
  personal_site: "Personal site",
  news: "News",
  other: "Other",
};

export const SOURCE_MONOGRAM: Record<SourceType, string> = {
  web: "W",
  github: "GH",
  linkedin: "in",
  instagram: "IG",
  x: "X",
  tiktok: "TT",
  bluesky: "BS",
  school: "Sc",
  broker: "DB",
  personal_site: "PS",
  news: "N",
  other: "?",
};

/* ---------- derived model ---------- */

export interface SourceGroup {
  type: SourceType;
  factIds: string[]; // finding ids, arrival order
}

export interface StepModel {
  index: number;
  title: string;
  description: string;
  enables?: string;
  findingIds: string[]; // only findings that exist
  severed: boolean;
  /** Node the step leads to (next step's first fact, or the target). */
  nextNodeId: string;
}

export interface ChainModel {
  chain: AttackChain;
  color: string;
  /** 0 solid, 1 dashed, 2 dotted. */
  style: number;
  dash: string;
  targetNodeId: string;
  steps: StepModel[];
  broken: boolean;
  /** All fact node ids on the path, in order. */
  factNodeIds: string[];
}

export interface TargetModel {
  id: string;
  label: string;
  chainIds: string[];
  blocked: boolean;
  severity: number;
}

export interface MapModel {
  sources: SourceGroup[];
  findings: Map<string, Finding>;
  chains: ChainModel[];
  targets: TargetModel[];
  /** finding id -> chain ids that use it */
  usage: Map<string, string[]>;
}

export function buildModel(
  findings: Finding[],
  chains: AttackChain[],
  removed: Set<string>,
): MapModel {
  const byId = new Map<string, Finding>();
  const sources: SourceGroup[] = [];
  const srcIdx = new Map<SourceType, SourceGroup>();
  for (const f of findings) {
    if (byId.has(f.id)) continue;
    byId.set(f.id, f);
    let g = srcIdx.get(f.sourceType);
    if (!g) {
      g = { type: f.sourceType, factIds: [] };
      srcIdx.set(f.sourceType, g);
      sources.push(g);
    }
    g.factIds.push(f.id);
  }

  const usage = new Map<string, string[]>();
  const targets = new Map<string, TargetModel>();
  const chainModels: ChainModel[] = [];

  chains.forEach((chain, ci) => {
    const tId = targetKey(chain.target);
    const steps = chain.steps
      .map((s) => ({ ...s, findingIds: s.findingIds.filter((id) => byId.has(id)) }))
      .filter((s) => s.findingIds.length > 0);
    const stepModels: StepModel[] = steps.map((s, i) => {
      const next = steps[i + 1];
      return {
        index: i,
        title: s.title,
        description: s.description,
        enables: s.enables,
        findingIds: s.findingIds,
        severed: s.findingIds.some((id) => removed.has(id)),
        nextNodeId: next ? factId(next.findingIds[0]) : tId,
      };
    });
    const factNodeIds: string[] = [];
    for (const s of stepModels) {
      for (const id of s.findingIds) {
        if (!factNodeIds.includes(factId(id))) factNodeIds.push(factId(id));
        const u = usage.get(id) ?? [];
        if (!u.includes(chain.id)) u.push(chain.id);
        usage.set(id, u);
      }
    }
    const broken = stepModels.some((s) => s.severed);
    chainModels.push({
      chain,
      color: CHAIN_COLORS[0],
      style: ci % CHAIN_DASH.length,
      dash: CHAIN_DASH[ci % CHAIN_DASH.length],
      targetNodeId: tId,
      steps: stepModels,
      broken,
      factNodeIds,
    });
    const t = targets.get(tId);
    if (t) {
      t.chainIds.push(chain.id);
      t.blocked = t.blocked && broken;
      t.severity = Math.max(t.severity, chain.severity);
    } else {
      targets.set(tId, {
        id: tId,
        label: chain.target,
        chainIds: [chain.id],
        blocked: broken,
        severity: chain.severity,
      });
    }
  });

  return { sources, findings: byId, chains: chainModels, targets: [...targets.values()], usage };
}

/* ---------- radial layout ---------- */

const TAU = Math.PI * 2;
const START = -Math.PI / 2; // first source sits at 12 o'clock
const R_SOURCE = 250;

/** Extent of a w×h box along the tangent / radial direction at polar angle a. */
const tangentExtent = (w: number, h: number, a: number) =>
  Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h;
const radialExtent = (w: number, h: number, a: number) =>
  Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h;

/**
 * Orders sources so ones linked by attack steps sit next to each other,
 * which keeps chain arcs short instead of criss-crossing the map.
 */
function orderSources(model: MapModel): SourceGroup[] {
  const srcOf = new Map<string, SourceType>();
  for (const s of model.sources) for (const id of s.factIds) srcOf.set(id, s.type);
  const aff = new Map<string, number>();
  const bump = (a?: SourceType, b?: SourceType) => {
    if (!a || !b || a === b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    aff.set(k, (aff.get(k) ?? 0) + 1);
  };
  for (const c of model.chains) {
    const ids = c.steps.flatMap((s) => s.findingIds);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) bump(srcOf.get(ids[i]), srcOf.get(ids[j]));
  }
  if (aff.size === 0) return model.sources;
  const get = (a: SourceType, b: SourceType) => aff.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;
  const rest = [...model.sources];
  const out = [rest.shift()!];
  while (rest.length) {
    const last = out[out.length - 1].type;
    let best = 0;
    for (let i = 1; i < rest.length; i++) if (get(last, rest[i].type) > get(last, rest[best].type)) best = i;
    out.push(rest.splice(best, 1)[0]);
  }
  return out;
}

/** `portrait` stretches the ring vertically for phones; otherwise sideways for widescreens. */
export function layout(model: MapModel, portrait = false): Map<string, Box> {
  const KX = portrait ? 0.62 : 1.3;
  const KY = portrait ? 1.45 : 0.72;
  const out = new Map<string, Box>();
  out.set(PERSON_ID, { x: 0, y: 0, ...wh("person") });

  const sources = orderSources(model);
  const weights = sources.map((s) => Math.max(2, s.factIds.length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = START - (weights[0] ? (weights[0] / total) * Math.PI : 0);
  const facts: Box[] = [];

  const ring = sources.map((s, i) => {
    const sector = (weights[i] / total) * TAU;
    const a = cursor + sector / 2;
    cursor += sector;
    return { sector, a, p: { x: Math.cos(a) * R_SOURCE * KX, y: Math.sin(a) * R_SOURCE * KY } };
  });
  // nudge overlapping source pills apart
  const SW = SIZE.source.w + 16;
  const SH = SIZE.source.h + 12;
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < ring.length; i++)
      for (let j = i + 1; j < ring.length; j++) {
        const p = ring[i].p;
        const q = ring[j].p;
        const ox = SW - Math.abs(p.x - q.x);
        const oy = SH - Math.abs(p.y - q.y);
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) {
          const d = (ox / 2) * Math.sign(q.x - p.x || 1);
          p.x -= d;
          q.x += d;
        } else {
          const d = (oy / 2) * Math.sign(q.y - p.y || 1);
          p.y -= d;
          q.y += d;
        }
      }
  }

  // keep pills clear of the person in the middle (portrait squeezes the ring sideways)
  const PH = SIZE.person.w / 2 + 14;
  for (const r of ring) {
    for (let k = 0; k < 40; k++) {
      const clearX = Math.abs(r.p.x) >= SW / 2 + PH - 8;
      const clearY = Math.abs(r.p.y) >= SH / 2 + PH - 8;
      if (clearX || clearY) break;
      r.p.x *= 1.05;
      r.p.y *= 1.05;
      if (Math.abs(r.p.y) < 1) r.p.y = (Math.sin(r.a) || 1) * 4;
    }
  }

  sources.forEach((s, i) => {
    const { sector, a, p: sp } = ring[i];
    out.set(sourceId(s.type), { ...sp, ...wh("source") });

    // Facts fan out from their source, away from the person.
    const { w, h } = SIZE.fact;
    const usable = Math.min(sector, TAU) * 0.9;
    let d = radialExtent(SIZE.source.w, SIZE.source.h, a) / 2 + radialExtent(w, h, a) / 2 + 30;
    let placed = 0;
    while (placed < s.factIds.length) {
      const step = tangentExtent(w, h, a) + 14;
      const reach = R_SOURCE + d;
      const cap = Math.max(1, Math.floor((usable * reach) / step));
      const n = Math.min(cap, s.factIds.length - placed);
      const dA = step / reach;
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * dA;
        // project along the source's outward direction so tiers stay parallel
        const along = d;
        const across = Math.tan(off) * reach;
        const id = s.factIds[placed + k];
        const box = {
          x: sp.x + Math.cos(a) * along - Math.sin(a) * across,
          y: sp.y + Math.sin(a) * along + Math.cos(a) * across,
          w,
          h,
        };
        out.set(factId(id), box);
        facts.push(box);
      }
      placed += n;
      d += radialExtent(w, h, a) + 16;
    }
  });

  // Targets ("prizes") sit just outside the cloud, on the side where their chain ends.
  const T = SIZE.target;
  const placedT: Box[] = [];
  for (const t of model.targets) {
    let sx = 0;
    let sy = 0;
    for (const c of model.chains) {
      if (c.targetNodeId !== t.id) continue;
      for (const st of c.steps)
        for (const id of st.findingIds) {
          const b = out.get(factId(id));
          if (!b) continue;
          const wgt = 1 + st.index * 1.5; // later steps pull harder
          const len = Math.hypot(b.x, b.y) || 1;
          sx += (b.x / len) * wgt;
          sy += (b.y / len) * wgt;
        }
    }
    // bias toward the left/right edges, where a widescreen has room
    let a = sx === 0 && sy === 0 ? 0 : portrait ? Math.atan2(sy, sx * 0.55) : Math.atan2(sy * 0.55, sx);
    let box: Box | null = null;
    for (let tries = 0; tries < 24 && !box; tries++) {
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      let reach = R_SOURCE;
      for (const f of facts) {
        // only facts roughly in this direction matter
        const along = f.x * ux + f.y * uy;
        const across = Math.abs(-f.x * uy + f.y * ux);
        if (across < (f.w + T.w) / 2 + 20) reach = Math.max(reach, along + radialExtent(f.w, f.h, a) / 2);
      }
      reach += radialExtent(T.w, T.h, a) / 2 + 40;
      const cand = { x: ux * reach, y: uy * reach, w: T.w, h: T.h };
      const hit = placedT.some(
        (p) => Math.abs(p.x - cand.x) < (p.w + cand.w) / 2 + 24 && Math.abs(p.y - cand.y) < (p.h + cand.h) / 2 + 24,
      );
      if (!hit) box = cand;
      else a += (tries % 2 === 0 ? 1 : -1) * 0.18 * (tries + 1);
    }
    if (!box) box = { x: Math.cos(a) * 1200, y: Math.sin(a) * 800, w: T.w, h: T.h };
    placedT.push(box);
    out.set(t.id, box);
  }
  return out;
}

function wh(kind: NodeKind) {
  return { w: SIZE[kind].w, h: SIZE[kind].h };
}

/* ---------- edge geometry ---------- */

/** Point where the ray from the box centre toward (tx,ty) leaves the box. */
export function boxExit(b: Box, tx: number, ty: number, round = false, pad = 4) {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const len = Math.hypot(dx, dy) || 1;
  if (round) {
    const r = b.w / 2 + pad;
    return { x: b.x + (dx / len) * r, y: b.y + (dy / len) * r };
  }
  const hw = b.w / 2 + pad;
  const hh = b.h / 2 + pad;
  const t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  return { x: b.x + dx * t, y: b.y + dy * t };
}
