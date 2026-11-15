"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { LogoMark } from "@/design/brand/Logo";
import "./promo.css";

/*
 * Scenes 7-12 of the demo video. Everything on screen is a pure function of one time value:
 * window.__renderAt(t) sets every position, camera and opacity for second t and draws one frame,
 * so the recorder can step through the clip frame by frame.
 */

declare global {
  interface Window {
    __renderAt?: (t: number) => void;
    __capture?: boolean;
    __dur?: number;
  }
}

const W = 1920;
const H = 1080;
const RED = "#ff5a4f";
const GREEN = "#3ddc97";
const FOV = 42;
export const DURATIONS: Record<number, number> = { 7: 11.5, 8: 7.5, 9: 8, 10: 10, 11: 7, 12: 15 };

/* ---------- timing helpers ---------- */
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Progress 0..1 of a move that starts at `start` and lasts `dur` seconds. */
const seg = (t: number, start: number, dur: number) => clamp01((t - start) / dur);
const outCubic = (x: number) => 1 - (1 - x) ** 3;
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
const inCubic = (x: number) => x ** 3;
const outBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
/** Constant speed with a soft start and a soft stop. */
function cruise(x: number, a = 0.12, b = 0.25) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const v = 1 / (1 - a / 2 - b / 2);
  if (x < a) return (v * x * x) / (2 * a);
  if (x < 1 - b) return v * (x - a / 2);
  return 1 - (v * (1 - x) ** 2) / (2 * b);
}
function shake(t: number, start: number, dur: number, amp: number): [number, number] {
  const x = (t - start) / dur;
  if (x <= 0 || x >= 1) return [0, 0];
  const k = amp * (1 - x) ** 2;
  return [k * Math.sin(x * 38), k * Math.cos(x * 31 + 1)];
}
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function mk(parent: HTMLElement, cls: string, css: string, html?: string) {
  const e = document.createElement("div");
  e.className = cls;
  e.style.cssText = css;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

/* ---------- the 3D web (scenes 7 and 9) ---------- */
const HUBS = ["Instagram", "TikTok", "LinkedIn", "GitHub", "X", "Web search", "Data brokers", "School pages"];
const TARGETS: [string, [number, number, number]][] = [
  ["Your email account", [7, 20, 5]],
  ["A message to your family", [-6, -19, -5]],
];
/** [hub, target]: the first fact of that hub is one step of the way into that account. */
const ARCS: [number, number][] = [
  [0, 0],
  [2, 0],
  [6, 0],
  [7, 1],
  [4, 1],
  [5, 1],
];
const TUBE_SEG = 24;

type Label = { el: HTMLElement; w: number; h: number; pos: THREE.Vector3; r: number; base: number };

function createWeb(canvas: HTMLCanvasElement, overlay: HTMLElement, shiftX = 0) {
  const rand = rng(20261115);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const fog = new THREE.Fog(0x000000, 40, 120);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 500);
  if (shiftX) camera.setViewOffset(W, H, shiftX, 0, W, H);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  scene.add(sun);

  const tex = (draw: (c: CanvasRenderingContext2D, s: number) => void) => {
    const s = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const c = cv.getContext("2d");
    if (c) draw(c, s);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const haloTex = tex((c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.25, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
  const ringTex = tex((c, s) => {
    c.strokeStyle = "#fff";
    c.lineWidth = 5;
    c.beginPath();
    c.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
    c.stroke();
  });
  const halo = (color: number, opacity: number) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(sp);
    return sp;
  };

  const sphere = new THREE.SphereGeometry(1, 48, 32);
  const octa = new THREE.OctahedronGeometry(1, 0);
  const rod = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
  rod.translate(0, 0.5, 0);
  const UP = new THREE.Vector3(0, 1, 0);

  /** A straight link that can grow from a to b. */
  const link = (a: THREE.Vector3, b: THREE.Vector3, radius: number, opacity: number) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false });
    const m = new THREE.Mesh(rod, mat);
    const d = b.clone().sub(a);
    const len = d.length();
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    scene.add(m);
    return { mesh: m, mat, opacity, set: (p: number) => (m.visible = p > 0.001) && m.scale.set(radius, len * p, radius) };
  };

  // Centre.
  const you = new THREE.Mesh(sphere, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8c8c8c }));
  you.scale.setScalar(2.4);
  scene.add(you);
  halo(0xffffff, 0.4).scale.setScalar(13);

  // Hubs and their facts, laid out once from a fixed seed.
  const origin = new THREE.Vector3();
  const hubs = HUBS.map((name, i) => {
    const ang = ((i * 45 + (rand() - 0.5) * 16) * Math.PI) / 180;
    const r = 25 + rand() * 5;
    const pos = new THREE.Vector3(Math.sin(ang) * r, (i % 2 ? 1 : -1) * (4 + rand() * 6), Math.cos(ang) * r);
    const mesh = new THREE.Mesh(sphere, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x5a5a5a }));
    mesh.position.copy(pos);
    scene.add(mesh);
    const h = halo(0xffffff, 0.45);
    h.position.copy(pos);
    return { name, pos, mesh, halo: h, link: link(origin, pos, 0.07, 0.42), pop: 0, grow: 0 };
  });
  const facts: { hub: number; pos: THREE.Vector3; r: number; mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial; halo: THREE.Sprite; link: ReturnType<typeof link>; pop: number; grow: number; red: number; order: number }[] = [];
  const firstFact: number[] = [];
  hubs.forEach((hub, h) => {
    firstFact.push(facts.length);
    const n = 6 + Math.floor(rand() * 3);
    const out = hub.pos.clone().normalize();
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().add(out.clone().multiplyScalar(0.7)).normalize();
      const pos = hub.pos.clone().add(dir.multiplyScalar(5 + rand() * 5.5));
      const r = i === 0 ? 0.85 : 0.42 + rand() * 0.36;
      const mat = new THREE.MeshLambertMaterial({ color: 0xdddddd, emissive: 0x404040 });
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.position.copy(pos);
      scene.add(mesh);
      const hl = halo(0xffffff, 0.22);
      hl.position.copy(pos);
      facts.push({ hub: h, pos, r, mesh, mat, halo: hl, link: link(hub.pos, pos, 0.045, 0.3), pop: 0, grow: 0, red: 0, order: i });
    }
  });

  // Accounts at risk.
  const redC = new THREE.Color(RED);
  const greenC = new THREE.Color(GREEN);
  const targets = TARGETS.map(([name, p]) => {
    const pos = new THREE.Vector3(...p);
    const mesh = new THREE.Mesh(octa, new THREE.MeshLambertMaterial({ color: redC, emissive: 0x7a1d16, flatShading: true }));
    const wire = new THREE.Mesh(octa, new THREE.MeshBasicMaterial({ color: redC, wireframe: true, transparent: true, opacity: 0.55 }));
    mesh.position.copy(pos);
    wire.position.copy(pos);
    scene.add(mesh, wire);
    const h = halo(0xff5a4f, 0.5);
    h.position.copy(pos);
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: redC, transparent: true, opacity: 0, depthWrite: false }));
    ring.position.copy(pos);
    scene.add(ring);
    return { name, pos, mesh, wire, halo: h, ring, pop: 0, pulse: 0, ringP: 0, spin: 0, calm: 0 };
  });

  // Red arcs, each built as two halves so it can be drawn in and later broken in the middle.
  const arcs = ARCS.map(([h, tg]) => {
    const fact = firstFact[h] ?? 0;
    const a = facts[fact]!.pos;
    const b = targets[tg]!.pos;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const ctrl = mid.clone().add(mid.clone().setY(0).normalize().multiplyScalar(9)).add(new THREE.Vector3(0, b.y > 0 ? 5 : -5, 0));
    const pts = new THREE.QuadraticBezierCurve3(a, ctrl, b).getPoints(40);
    const mat = new THREE.MeshBasicMaterial({ color: redC, transparent: true, opacity: 1 });
    const halves = [pts.slice(0, 21), pts.slice(20)].map((p) => {
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p), TUBE_SEG, 0.14, 6);
      const m = new THREE.Mesh(geo, mat);
      scene.add(m);
      return { geo, m };
    });
    // from/to: the drawn stretch of the arc (0 = fact end, 1 = account end). gap: hole opened around the middle.
    const spark = halo(0x3ddc97, 0);
    // spark: position of a soft highlight travelling along the arc (0..1), or -1 for none.
    return { fact, target: tg, mat, halves, pts, sparkEl: spark, spark: -1, from: 0, to: 0, gap: 0, green: 0, opacity: 1 };
  });
  const setHalf = (half: { geo: THREE.TubeGeometry; m: THREE.Mesh }, a: number, b: number) => {
    const s = Math.floor(clamp01(a) * TUBE_SEG);
    const e = Math.ceil(clamp01(b) * TUBE_SEG);
    half.m.visible = e > s;
    half.geo.setDrawRange(s * 36, (e - s) * 36);
  };

  // Dust for parallax.
  const dustPos = new Float32Array(300 * 3);
  for (let i = 0; i < 300; i++) {
    const v = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(18 + rand() * 80);
    dustPos.set([v.x, v.y * 0.7, v.z], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffffff, map: haloTex, size: 0.8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })));

  // Labels are HTML, placed each frame from the projected 3D position.
  const shadow = "text-shadow:0 0 14px #000,0 0 5px #000;";
  const labelCss = "left:0;top:0;white-space:nowrap;transform-origin:50% 0;text-align:center;line-height:1.1;will-change:transform;" + shadow;
  const label = (html: string, css: string, pos: THREE.Vector3, r: number, base: number): Label => {
    const el = mk(overlay, "pv-abs font-display", labelCss + css, html);
    return { el, w: el.offsetWidth, h: el.offsetHeight, pos, r, base };
  };
  const youLabel = label("Alex Rivera", "font-size:40px;font-weight:700;", origin, 2.4, 1);
  const hubLabels = hubs.map((h) => label(h.name, "font-size:30px;font-weight:600;", h.pos, 1.25, 0));
  const targetLabels = targets.map((t) =>
    label(`<div class="font-mono" style="font-size:15px;letter-spacing:.16em;color:${RED};margin-bottom:5px">ACCOUNT AT RISK</div>${t.name}`, "font-size:32px;font-weight:600;", t.pos, 2.6, 0),
  );
  const labels = [youLabel, ...targetLabels, ...hubLabels];

  const tmp = new THREE.Vector3();
  const tanHalf = Math.tan((FOV * Math.PI) / 360);
  /** Screen position of a world point: x, y in pixels, depth in world units, px per world unit there. */
  const project = (p: THREE.Vector3) => {
    const depth = -tmp.copy(p).applyMatrix4(camera.matrixWorldInverse).z;
    tmp.copy(p).project(camera);
    return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H, depth, unit: H / 2 / (tanHalf * Math.max(depth, 0.1)) };
  };

  const cWhite = new THREE.Color(0xdddddd);
  const eGrey = new THREE.Color(0x404040);
  const eRed = new THREE.Color(0x99271f);
  const eGreen = new THREE.Color(0x1a6b49);

  const render = (cam: THREE.Vector3, look: THREE.Vector3) => {
    const dist = cam.distanceTo(look);
    camera.position.copy(cam);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    fog.near = dist * 0.62;
    fog.far = dist * 2.3;
    sun.position.set(cam.x + cam.z * 0.6, cam.y + dist * 0.7, cam.z - cam.x * 0.6);

    for (const h of hubs) {
      h.link.set(h.grow);
      const s = Math.max(0, outBack(h.pop)) * 1.25;
      h.mesh.visible = h.halo.visible = h.pop > 0.001;
      h.mesh.scale.setScalar(s);
      h.halo.scale.setScalar(s * 5);
    }
    for (const f of facts) {
      f.link.set(f.grow);
      f.link.mat.opacity = f.link.opacity * clamp01(f.pop * 3);
      const s = Math.max(0, f.pop >= 1 ? 1 : outBack(f.pop)) * f.r * (1 + f.red * 0.25);
      f.mesh.visible = f.halo.visible = f.pop > 0.001;
      f.mesh.scale.setScalar(s);
      f.halo.scale.setScalar(s * (4.5 + f.red * 3));
      f.mat.color.copy(cWhite).lerp(redC, f.red);
      f.mat.emissive.copy(eGrey).lerp(eRed, f.red);
      (f.halo.material as THREE.SpriteMaterial).color.setRGB(1, 1, 1).lerp(redC, f.red);
      (f.halo.material as THREE.SpriteMaterial).opacity = 0.22 + f.red * 0.4;
    }
    for (const t of targets) {
      const s = Math.max(0, outBack(t.pop)) * 2.1 * (1 + t.pulse * 0.22);
      t.mesh.visible = t.wire.visible = t.halo.visible = t.pop > 0.001;
      t.mesh.scale.setScalar(s);
      t.wire.scale.setScalar(s * 1.5);
      (t.mesh.material as THREE.MeshLambertMaterial).color.copy(redC).lerp(greenC, t.calm);
      (t.mesh.material as THREE.MeshLambertMaterial).emissive.setHex(0x7a1d16).lerp(eGreen, t.calm);
      (t.wire.material as THREE.MeshBasicMaterial).color.copy(redC).lerp(greenC, t.calm);
      (t.halo.material as THREE.SpriteMaterial).color.copy(redC).lerp(greenC, t.calm);
      t.mesh.rotation.y = t.spin;
      t.wire.rotation.y = -t.spin * 0.6;
      t.halo.scale.setScalar(s * (5 + t.pulse * 3));
      (t.halo.material as THREE.SpriteMaterial).opacity = 0.45 + t.pulse * 0.4;
      t.ring.visible = t.ringP > 0.001 && t.ringP < 1;
      t.ring.scale.setScalar(4 + t.ringP * 16);
      (t.ring.material as THREE.SpriteMaterial).opacity = (1 - t.ringP) * 0.8;
    }
    for (const a of arcs) {
      a.mat.color.copy(redC).lerp(greenC, a.green);
      a.mat.opacity = a.opacity;
      const lo = Math.min(a.to, 0.5 - a.gap);
      const hi = Math.max(a.from, 0.5 + a.gap);
      setHalf(a.halves[0]!, a.from * 2, lo * 2);
      setHalf(a.halves[1]!, hi * 2 - 1, a.to * 2 - 1);
      if (a.opacity <= 0.001) a.halves.forEach((h) => (h.m.visible = false));
      a.sparkEl.visible = a.spark > 0 && a.spark < 1;
      if (a.sparkEl.visible) {
        const at = a.spark * (a.pts.length - 1);
        const i = Math.min(a.pts.length - 2, Math.floor(at));
        a.sparkEl.position.copy(a.pts[i]!).lerp(a.pts[i + 1]!, at - i);
        a.sparkEl.scale.setScalar(7);
        (a.sparkEl.material as THREE.SpriteMaterial).opacity = Math.sin(a.spark * Math.PI);
      }
    }

    // Labels: below the node, smaller and dimmer with distance, and dimmed where a nearer label covers them.
    youLabel.base = 1;
    hubs.forEach((h, i) => (hubLabels[i]!.base = clamp01(h.pop * 1.5)));
    targets.forEach((t, i) => (targetLabels[i]!.base = clamp01(t.pop * 1.5)));
    const placed = labels.map((l) => {
      const p = project(l.pos);
      const s = Math.min(1.5, Math.max(0.55, 62 / p.depth));
      const fogged = clamp01((p.depth - fog.near) / (fog.far - fog.near));
      return { l, s, x: p.x, y: p.y + l.r * p.unit + 10 + (l.h * s) / 2, depth: p.depth, top: p.y + l.r * p.unit + 10, o: p.depth > 1 ? l.base * (1 - 0.8 * fogged) : 0 };
    });
    for (const a of placed) {
      let o = a.o;
      for (const b of placed) {
        if (a === b || b.o < 0.05 || b.depth >= a.depth) continue;
        const ox = (a.l.w * a.s + b.l.w * b.s) / 2 + 16 - Math.abs(a.x - b.x);
        const oy = (a.l.h * a.s + b.l.h * b.s) / 2 + 8 - Math.abs(a.y - b.y);
        if (ox > 0 && oy > 0) o *= 1 - 0.9 * Math.min(1, ox / 20, oy / 8) * clamp01((a.depth - b.depth) / 4) * clamp01(b.o * 2);
      }
      a.l.el.style.opacity = o.toFixed(3);
      a.l.el.style.transform = `translate(${a.x.toFixed(1)}px,${a.top.toFixed(1)}px) translate(-50%,0) scale(${a.s.toFixed(3)})`;
    }
    renderer.render(scene, camera);
  };

  return { hubs, facts, targets, arcs, firstFact, render, project, dispose: () => renderer.dispose() };
}

type Web = ReturnType<typeof createWeb>;
const orbit = (deg: number, elevDeg: number, dist: number) => {
  const a = (deg * Math.PI) / 180;
  const e = (elevDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e) * dist, Math.sin(e) * dist, Math.cos(a) * Math.cos(e) * dist);
};

/* ---------- foreground: cards in the style of the landing hero card, with clay icons ---------- */
const pending: Promise<unknown>[] = [];
/** One clay icon from /public/icons3d. Decoded before the clip is marked ready. */
function icon(parent: HTMLElement, name: string, size: number, css: string) {
  const e = document.createElement("img");
  e.src = `/icons3d/${name}-${size > 96 ? 384 : 160}.webp`;
  e.alt = "";
  e.draggable = false;
  e.style.cssText = `width:${size}px;height:${size}px;flex:none;${css}`;
  parent.appendChild(e);
  pending.push(e.decode().catch(() => undefined));
  return e;
}
const MUTED = "rgba(255,255,255,.6)";
const PANEL = "border:1.5px solid rgba(255,255,255,.2);background:rgba(9,9,9,.84);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 40px 90px rgba(0,0,0,.7);";
/** Clock for idle motion: eases in after the opening still and comes to rest before the final hold. */
const ambient = (t: number, dur: number) => (dur - 1.3) * cruise(seg(t, 0.3, dur - 1.3), 0.1, 0.2);
const bob = (m: number, i: number, z: number, scale = 1) =>
  `translate3d(0,${(9 * Math.sin(m * 1.5 + i * 2.1)).toFixed(1)}px,${z}px) rotate(${(5 * Math.sin(m * 1.1 + i * 1.3)).toFixed(2)}deg) scale(${scale.toFixed(3)})`;
const pop = (x: number) => (x >= 1 ? 1 : Math.max(0, outBack(x)));

const subjectHead = (name: number, score: number) =>
  `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:40px">` +
  `<div><div style="font-size:22px;color:${MUTED}">Subject</div><div class="font-display" style="margin-top:6px;font-size:${name}px;font-weight:600;line-height:1;white-space:nowrap">Alex Rivera</div></div>` +
  `<div style="text-align:right"><div class="font-display" data-score style="font-size:${score}px;font-weight:700;line-height:.9;color:${RED};font-variant-numeric:tabular-nums">0</div><div style="margin-top:6px;font-size:20px;color:${MUTED}">exposure</div></div></div>`;

/* 7. The web assembles in 3D behind a subject card that fills in as facts are found. */
const ROWS: [string, string, number, boolean][] = [
  ["pet", "Pet’s name", 150, false],
  ["file", "School", 230, true],
  ["gift", "Birthday", 180, true],
  ["chat", "Username", 205, false],
  ["person", "Mother", 220, true],
  ["pin", "Home area", 170, true],
];

function sceneWeb(web: Web, hud: HTMLElement) {
  mk(hud, "pv-abs", "inset:0;background:linear-gradient(90deg,transparent 48%,rgba(0,0,0,.6) 82%);");
  const view = mk(hud, "pv-abs", "left:1140px;top:160px;width:640px;perspective:1600px;");
  const tilt = mk(view, "", "position:relative;transform-style:preserve-3d;will-change:transform;");
  const panel = mk(tilt, "", PANEL + "position:relative;border-radius:30px;padding:36px 40px 28px;", subjectHead(46, 100));
  const score = panel.querySelector("[data-score]") as HTMLElement;
  const rows = ROWS.map(([name, label, width, danger], i) => {
    const row = mk(panel, "", `display:flex;align-items:center;gap:20px;height:84px;margin-top:${i === 0 ? 24 : 0}px;border-top:1px solid rgba(255,255,255,${i === 0 ? 0.16 : 0.1});`);
    const body = mk(row, "", "display:flex;align-items:center;gap:20px;flex:1;");
    icon(body, name, 56, "");
    mk(body, "", `width:140px;flex:none;font-size:23px;color:${MUTED};white-space:nowrap`, label);
    const bar = mk(body, "", `flex:none;width:${width}px;height:22px;border-radius:7px;background:#fff;transform-origin:0 50%;`);
    const dot = mk(body, "", `margin-left:auto;flex:none;width:14px;height:14px;border-radius:50%;background:${danger ? RED : "rgba(255,255,255,.45)"};`);
    return { body, bar, dot, at: 1.5 + i * 0.55 };
  });
  const foot = mk(panel, "", `display:flex;justify-content:space-between;margin-top:8px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1);font-size:20px;color:${MUTED};`, "<span>Fictional</span>");
  const count = mk(foot, "", "font-variant-numeric:tabular-nums;");
  const floats = [
    { el: icon(tilt, "lock", 140, "position:absolute;left:-74px;top:-84px;"), z: 90, at: 0.9 },
    { el: icon(tilt, "shield", 170, "position:absolute;right:-78px;top:-78px;"), z: 140, at: 1.05 },
    { el: icon(tilt, "key", 124, "position:absolute;right:-62px;bottom:-58px;"), z: 110, at: 1.2 },
  ];

  const flagged = new Map(web.arcs.map((a, k) => [a.fact, k]));
  const hubAt = (i: number) => 0.9 + i * 0.4;
  const arcAt = (k: number) => 6.3 + k * 0.22;
  const dur = DURATIONS[7]!;

  return (t: number) => {
    let found = 0;
    web.hubs.forEach((h, i) => {
      h.grow = outCubic(seg(t, hubAt(i), 0.45));
      h.pop = seg(t, hubAt(i) + 0.3, 0.4);
    });
    web.facts.forEach((f, j) => {
      const s = hubAt(f.hub) + 0.6 + f.order * 0.09;
      f.grow = outCubic(seg(t, s, 0.35));
      f.pop = seg(t, s + 0.2, 0.35);
      if (f.pop > 0.3) found++;
      const k = flagged.get(j);
      f.red = k === undefined ? 0 : seg(t, arcAt(k), 0.3);
    });
    const pulseEnv = seg(t, 8, 0.3) * (1 - seg(t, 10, 0.4));
    web.targets.forEach((tg, i) => {
      tg.pop = seg(t, 5.6 + i * 0.3, 0.45);
      tg.spin = cruise(seg(t, 0.3, 10.2)) * 5 + i;
      const ph = (t - 8 - i * 0.25) * 1.1;
      tg.pulse = pulseEnv * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2));
      tg.ringP = t > 8 + i * 0.25 && t < 10.3 ? ((ph % 1) + 1) % 1 : 0;
    });
    web.arcs.forEach((a, k) => {
      a.from = 0;
      a.to = outCubic(seg(t, arcAt(k), 0.75));
      a.gap = 0;
      a.green = 0;
      a.opacity = 1;
    });

    const u = cruise(seg(t, 0.3, 10.2), 0.1, 0.22);
    const back = outCubic(seg(t, 0.3, 5.8) ** 1.4);
    const dist = lerp(17, 64, back) + 6 * cruise(seg(t, 5, 5.5), 0.3, 0.3);
    web.render(orbit(-70 + 150 * u, 5 + 12 * u, dist), new THREE.Vector3(0, 1.5 * u, 0));

    // The card.
    const m = ambient(t, dur);
    const enter = outCubic(seg(t, 0.45, 0.7));
    view.style.opacity = seg(t, 0.45, 0.35).toFixed(3);
    tilt.style.transform = `translate3d(${((1 - enter) * 150).toFixed(1)}px,${(6 * Math.sin(m * 0.9)).toFixed(1)}px,0) rotateY(${(-16 + 5 * u).toFixed(2)}deg) rotateX(${(6 - 3 * u).toFixed(2)}deg)`;
    rows.forEach((r) => {
      r.body.style.opacity = seg(t, r.at, 0.3).toFixed(3);
      r.bar.style.transform = `scaleX(${outCubic(seg(t, r.at + 0.12, 0.5)).toFixed(3)})`;
      r.dot.style.transform = `scale(${pop(seg(t, r.at + 0.5, 0.25)).toFixed(3)})`;
    });
    floats.forEach((f, i) => (f.el.style.transform = bob(m, i, f.z, pop(seg(t, f.at, 0.45)))));
    score.textContent = String(Math.round((78 * found) / web.facts.length));
    const risk = t >= 8.1;
    count.textContent = risk ? "2 accounts at risk" : `${found} public facts found`;
    count.style.color = risk ? RED : MUTED;
  };
}

/* 9. Three exposed facts are locked on and removed; a shield lands on each and its link breaks. */
const TAKEDOWNS: { arc: number; at: number; icon: string; source: string; action: string }[] = [
  { arc: 2, at: 0.5, icon: "folder", source: "Data broker listing", action: "Opt-out" },
  { arc: 0, at: 2.3, icon: "camera", source: "Instagram", action: "Make private" },
  { arc: 3, at: 4.1, icon: "file", source: "School roster", action: "Removal request" },
];
const SCORES = [78, 64, 50, 36];

function sceneTakedown(web: Web, hud: HTMLElement) {
  const corner = (pos: string) => `<i style="position:absolute;${pos}width:22px;height:22px;border:0 solid currentColor;"></i>`;
  const items = TAKEDOWNS.map((td) => {
    const ret = mk(
      hud,
      "pv-abs",
      "left:-48px;top:-48px;width:96px;height:96px;",
      corner("left:0;top:0;border-left-width:3px;border-top-width:3px;") +
        corner("right:0;top:0;border-right-width:3px;border-top-width:3px;") +
        corner("left:0;bottom:0;border-left-width:3px;border-bottom-width:3px;") +
        corner("right:0;bottom:0;border-right-width:3px;border-bottom-width:3px;"),
    );
    const shield = icon(hud, "shield", 100, "position:absolute;left:-50px;top:-50px;");
    const card = mk(hud, "pv-abs", PANEL + "left:0;top:0;display:flex;align-items:center;gap:20px;padding:18px 32px 18px 22px;border-radius:22px;white-space:nowrap;");
    icon(card, td.icon, 72, "");
    const text = mk(
      card,
      "",
      "",
      `<div class="font-mono pv-mono" style="font-size:17px">${td.source}</div>` +
        `<div class="font-display" style="margin-top:8px;font-size:42px;font-weight:600;line-height:1;display:flex;align-items:center;gap:16px">` +
        `<svg width="40" height="24" viewBox="0 0 40 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h34M26 3l10 9-10 9"/></svg><span>${td.action}</span></div>`,
    );
    return { ...td, ret, shield, card, width: card.offsetWidth, action: text.lastElementChild as HTMLElement };
  });
  const view = mk(hud, "pv-abs", "right:100px;top:84px;perspective:1400px;");
  const tilt = mk(view, "", "position:relative;transform-style:preserve-3d;");
  const panel = mk(tilt, "", PANEL + "border-radius:26px;padding:28px 34px 26px;", subjectHead(36, 112));
  const score = panel.querySelector("[data-score]") as HTMLElement;
  const lock = icon(tilt, "lock", 110, "position:absolute;left:-58px;top:-58px;");
  const shade = mk(hud, "pv-abs", "left:0;right:0;bottom:0;height:440px;background:linear-gradient(transparent,rgba(0,0,0,.94) 68%);");
  const line = mk(hud, "pv-abs font-display pv-display", "left:110px;bottom:96px;font-size:150px;transform-origin:0 100%;", "Break the chain.");
  const dur = DURATIONS[9]!;

  return (t: number) => {
    web.hubs.forEach((h) => (h.pop = h.grow = 1));
    web.facts.forEach((f) => (f.pop = f.grow = 1));
    web.targets.forEach((tg, i) => {
      tg.pop = 1;
      tg.spin = cruise(seg(t, 0.3, 6.7)) * 2.4 + i;
      tg.pulse = 0;
      tg.ringP = 0;
    });
    web.arcs.forEach((a) => {
      a.from = 0;
      a.to = 1;
      a.gap = 0;
      a.green = 0;
      a.opacity = 1;
      web.facts[a.fact]!.red = 1;
    });
    let value = SCORES[0]!;
    items.forEach((it, i) => {
      const hit = it.at + 1;
      const a = web.arcs[it.arc]!;
      const f = web.facts[a.fact]!;
      f.pop = 1 - inCubic(seg(t, hit, 0.3));
      f.grow = 1 - seg(t, hit, 0.3);
      a.green = seg(t, hit, 0.12);
      a.gap = 0.5 * outCubic(seg(t, hit + 0.12, 0.75));
      value = lerp(value, SCORES[i + 1]!, outCubic(seg(t, hit, 0.45)));
    });

    const u = cruise(seg(t, 0.3, 6.7), 0.15, 0.3);
    const m = ambient(t, dur);
    web.render(orbit(CAM9 + 16 * u, 15 - 3 * u, 66 - 8 * u), new THREE.Vector3(0, 0, 0));

    items.forEach((it, i) => {
      const p = web.project(web.facts[web.arcs[it.arc]!.fact]!.pos);
      const hit = it.at + 1;
      const lock = outExpo(seg(t, it.at, 0.4));
      const done = seg(t, hit, 0.12);
      const gone = seg(t, hit + 0.1, 0.45);
      it.ret.style.color = done > 0.5 ? GREEN : RED;
      it.ret.style.opacity = (seg(t, it.at, 0.12) * (1 - gone)).toFixed(3);
      it.ret.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) rotate(${((1 - lock) * 90).toFixed(1)}deg) scale(${(lerp(5, 1, lock) + gone * 0.6).toFixed(3)})`;
      const land = seg(t, hit + 0.05, 0.32);
      it.shield.style.opacity = seg(t, hit + 0.05, 0.12).toFixed(3);
      it.shield.style.transform = `translate(${p.x.toFixed(1)}px,${(p.y + 5 * Math.sin(m * 1.5 + i * 2)).toFixed(1)}px) rotate(${(4 * Math.sin(m * 1.1 + i)).toFixed(2)}deg) scale(${lerp(2.1, 1, outCubic(land)).toFixed(3)})`;
      const cardIn = outExpo(seg(t, it.at + 0.28, 0.45));
      const left = p.x > 1150;
      const cx = left ? p.x - 96 - it.width - (1 - cardIn) * 70 : p.x + 96 + (1 - cardIn) * 70;
      it.card.style.opacity = (seg(t, it.at + 0.28, 0.15) * (1 - seg(t, hit + 0.6, 0.3))).toFixed(3);
      it.card.style.transform = `translate(${cx.toFixed(1)}px,${(p.y - 56).toFixed(1)}px) perspective(1100px) rotateY(${left ? 9 : -9}deg) rotateX(3deg)`;
      it.action.style.color = done > 0.5 ? GREEN : "#fff";
      it.card.style.borderColor = done > 0.5 ? GREEN : "rgba(255,255,255,.2)";
    });

    const last = items[items.length - 1]!.at + 1;
    score.textContent = String(Math.round(value));
    score.style.color = t >= last + 0.3 ? GREEN : RED;
    tilt.style.transform = `translate3d(0,${(5 * Math.sin(m * 0.9)).toFixed(1)}px,0) rotateY(${(-13 + 3 * u).toFixed(2)}deg) rotateX(${(5 - 2 * u).toFixed(2)}deg)`;
    lock.style.transform = bob(m, 1, 80);
    const land = seg(t, 6.1, 0.2);
    line.style.opacity = seg(t, 6.1, 0.1).toFixed(3);
    line.style.transform = `scale(${lerp(1.25, 1, outCubic(land)).toFixed(3)})`;
    shade.style.opacity = seg(t, 5.9, 0.3).toFixed(3);
    const [sx, sy] = shake(t, 6.3, 0.35, 3);
    hud.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
  };
}
const CAM9 = 92;

/* 8. Harmless apart, a way in together. Card rows in CSS 3D over the dimmed, out-of-focus web. */
const CHIPS: { icon: string; label: string; value: string; far: [number, number, number, number] }[] = [
  { icon: "pet", label: "Dog’s name", value: "Biscuit", far: [-610, -290, 80, 20] },
  { icon: "file", label: "High school", value: "Lakeview High", far: [570, -260, -420, -24] },
  { icon: "gift", label: "Birthday", value: "March 14", far: [-150, 30, -950, 10] },
  { icon: "chat", label: "Username", value: "alexr_codes", far: [640, 260, 140, -18] },
  { icon: "person", label: "Mother", value: "Sam Rivera", far: [-700, 330, -560, 26] },
  { icon: "pin", label: "Home area", value: "Riverside", far: [150, -470, -1350, -8] },
];
const CHAIN_X = -400;
const CHAIN_STEP = 128;
const CHIP_W = 470;

function sceneChips(web: Web, stage: HTMLElement) {
  const rand = rng(8);
  const view = mk(stage, "pv-abs", "inset:0;perspective:1400px;perspective-origin:50% 50%;");
  const world = mk(view, "pv-abs", "left:50%;top:50%;width:0;height:0;transform-style:preserve-3d;");
  for (let i = 0; i < 60; i++) {
    const s = 3 + rand() * 4;
    mk(world, "pv-abs", `width:${s}px;height:${s}px;border-radius:50%;background:rgba(255,255,255,${(0.15 + rand() * 0.35).toFixed(2)});transform:translate3d(${Math.round((rand() - 0.5) * 3600)}px,${Math.round((rand() - 0.5) * 2200)}px,${Math.round(400 - rand() * 2400)}px);`);
  }
  const spineX = CHAIN_X - CHIP_W / 2 - 44;
  const spine = mk(world, "pv-abs", `left:${spineX - 2}px;top:${-2.5 * CHAIN_STEP}px;width:5px;height:${5 * CHAIN_STEP}px;border-radius:3px;background:${RED};box-shadow:0 0 22px ${RED};transform-origin:50% 0;`);
  const chips = CHIPS.map((c, i) => {
    const el = mk(
      world,
      "pv-abs",
      `left:${-CHIP_W / 2}px;top:-54px;width:${CHIP_W}px;height:108px;box-sizing:border-box;display:flex;align-items:center;gap:18px;padding:0 26px 0 20px;border:1.5px solid rgba(255,255,255,.24);border-radius:20px;background:#0b0b0b;box-shadow:0 24px 60px rgba(0,0,0,.6);will-change:transform;`,
    );
    icon(el, c.icon, 68, "");
    mk(el, "", "flex:1;min-width:0;", `<div style="font-size:20px;line-height:24px;color:${MUTED}">${c.label}</div><div class="font-display" style="margin-top:3px;font-size:40px;line-height:44px;font-weight:600;white-space:nowrap">${c.value}</div>`);
    const dot = mk(el, "", "flex:none;width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,.4);");
    const tag = mk(el, "pv-abs font-mono", "right:22px;top:-15px;padding:5px 11px;border-radius:7px;font-size:15px;line-height:18px;letter-spacing:.14em;text-transform:uppercase;background:#000;border:1px solid rgba(255,255,255,.3);color:rgba(255,255,255,.62);", "harmless");
    const y = (i - 2.5) * CHAIN_STEP;
    const node = mk(world, "pv-abs", `left:${spineX - 9}px;top:${y - 9}px;width:18px;height:18px;border-radius:50%;background:${RED};box-shadow:0 0 16px ${RED};`);
    const arm = mk(world, "pv-abs", `left:${spineX}px;top:${y - 1.5}px;width:44px;height:3px;background:${RED};transform-origin:0 50%;`);
    return { ...c, el, tag, dot, node, arm, y, state: "" };
  });
  const head = mk(
    stage,
    "pv-abs font-display pv-display",
    "left:900px;top:330px;transform-origin:0 60%;",
    `<div style="font-size:124px">Together:</div><div style="margin-top:14px;font-size:176px;color:${RED}">a way in.</div>`,
  );
  const key = icon(stage, "key", 210, "position:absolute;left:1540px;top:230px;");
  const SNAP = 3.75;
  const dur = DURATIONS[8]!;

  return (t: number) => {
    const m = ambient(t, dur);
    // Background: the web, slowly turning. Its red links only appear once the pieces are joined.
    web.hubs.forEach((h) => (h.pop = h.grow = 1));
    web.facts.forEach((f) => (f.pop = f.grow = 1));
    web.targets.forEach((tg, i) => {
      tg.pop = seg(t, 4.3 + i * 0.2, 0.4);
      tg.spin = m * 0.4 + i;
      tg.pulse = 0;
      tg.ringP = 0;
    });
    web.arcs.forEach((a, k) => {
      a.from = 0;
      a.to = outCubic(seg(t, 4.4 + k * 0.12, 0.7));
      a.gap = 0;
      a.green = 0;
      a.opacity = 1;
      web.facts[a.fact]!.red = seg(t, 4.4 + k * 0.12, 0.3);
    });
    const turn = cruise(seg(t, 0.3, dur - 1.3), 0.1, 0.25);
    web.render(orbit(20 + 38 * turn, 12, 60 - 10 * turn), new THREE.Vector3(0, 0, 0));

    const drift = cruise(seg(t, 0.3, 3.2), 0.2, 0.05);
    const punch = inCubic(seg(t, 3.15, 0.6));
    const settle = cruise(seg(t, SNAP, 2.75), 0.02, 0.6);
    const push = 60 * drift + 40 * punch + 20 * settle;
    const ry = lerp(-11, 5, drift) + 4 * punch + 2 * settle;
    const rx = lerp(4, -2, drift) + 2 * punch;
    const [s1x, s1y] = shake(t, SNAP, 0.4, 4);
    const [s2x, s2y] = shake(t, 5.2, 0.35, 3);
    view.style.transform = `translate(${(s1x + s2x).toFixed(1)}px,${(s1y + s2y).toFixed(1)}px)`;
    world.style.transform = `translateZ(${push.toFixed(1)}px) rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg)`;

    const d = Math.max(0, t - 0.3);
    chips.forEach((c, i) => {
      // Each row lands a beat after the one above it; the last lands on the snap.
      const g = inCubic(seg(t, SNAP - 0.42 - (5 - i) * 0.05, 0.42));
      const fx = c.far[0] + 46 * Math.sin(d * 0.9 + i * 1.7);
      const fy = c.far[1] + 30 * Math.cos(d * 1.1 + i * 2.3);
      const fz = c.far[2] + 110 * Math.sin(d * 0.8 + i);
      const fr = c.far[3] + 7 * Math.sin(d * 0.7 + i * 0.9);
      const z = lerp(fz, 0, g);
      c.el.style.transform = `translate3d(${lerp(fx, CHAIN_X, g).toFixed(1)}px,${lerp(fy, c.y, g).toFixed(1)}px,${z.toFixed(1)}px) rotateY(${lerp(fr, 0, g).toFixed(2)}deg) rotateX(${lerp(-fr * 0.4, 0, g).toFixed(2)}deg)`;
      const blur = Math.min(4, Math.max(0, (-z - 400) / 260));
      c.el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
      c.el.style.opacity = (1 - 0.4 * clamp01(-z / 1500)).toFixed(3);

      const flip = seg(t, 3.9 + i * 0.09, 0.3);
      const state = flip > 0.5 ? "red" : "grey";
      if (c.state !== state) {
        const red = state === "red";
        c.state = state;
        c.tag.textContent = red ? "a clue" : "harmless";
        c.tag.style.color = red ? "#000" : "rgba(255,255,255,.62)";
        c.tag.style.background = red ? RED : "#000";
        c.tag.style.borderColor = red ? RED : "rgba(255,255,255,.3)";
        c.el.style.borderColor = red ? RED : "rgba(255,255,255,.24)";
        c.dot.style.background = red ? RED : "rgba(255,255,255,.4)";
      }
      c.tag.style.transform = `scaleY(${Math.abs(Math.cos(flip * Math.PI)).toFixed(3)})`;
      c.node.style.transform = `scale(${pop(seg(t, 4.35 + i * 0.1, 0.14)).toFixed(3)})`;
      c.arm.style.transform = `scaleX(${outCubic(seg(t, 4.38 + i * 0.1, 0.15)).toFixed(3)})`;
    });
    spine.style.transform = `scaleY(${seg(t, 4.35, 0.5).toFixed(3)})`;

    const land = seg(t, 5.0, 0.22);
    head.style.opacity = seg(t, 5.0, 0.1).toFixed(3);
    head.style.transform = `scale(${lerp(1.25, 1, outCubic(land)).toFixed(3)})`;
    key.style.opacity = seg(t, 5.25, 0.15).toFixed(3);
    key.style.transform = bob(m, 2, 0, pop(seg(t, 5.25, 0.45)));
  };
}

/* 10. The app drafts a removal email: a loader, then the draft card types itself. */
const DRAFT_TO = "privacy@lakeviewhigh.example";
const DRAFT_SUBJECT = "Request to remove my personal information (Alex Rivera)";
const DRAFT_BODY = [
  "Hello,",
  "",
  "I am the person named on the page below.",
  "https://lakeviewhigh.example/alumni/class-of-2014",
  "",
  "Details to remove:",
  "High school: Lakeview High School",
  "",
  "Please confirm by reply once it is done.",
  "",
  "Thank you,",
  "Alex Rivera",
].join("\n");
const LOGS: [number, string][] = [
  [0.8, "Found contact page"],
  [1.35, "Found privacy policy"],
  [1.9, "Address: privacy@lakeviewhigh.example"],
];
const TICK = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${GREEN}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function sceneDraft(web: Web, hud: HTMLElement) {
  const dur = DURATIONS[10]!;
  const centre = "inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;";

  // Beat 1: turning rings, as on the app's scan loader.
  const loader = mk(hud, "pv-abs", centre);
  const rings = mk(loader, "", "position:relative;width:230px;height:230px;");
  const ring = (css: string, html?: string) => mk(rings, "pv-abs", "border-radius:50%;" + css, html);
  const dot = (s: number, o: number) => `<i style="position:absolute;top:${-s / 2}px;left:50%;width:${s}px;height:${s}px;margin-left:${-s / 2}px;border-radius:50%;background:#fff;opacity:${o}"></i>`;
  const spins: [HTMLElement, number][] = [
    [ring("inset:0;border:2px solid transparent;border-top-color:#fff;border-right-color:rgba(255,255,255,.35);"), 1.5],
    [ring("inset:9%;border:1.5px dashed rgba(255,255,255,.45);"), -9],
    [ring("inset:-7%;border:1.5px solid rgba(255,255,255,.14);border-left-color:rgba(255,255,255,.6);"), 4.2],
    [ring("inset:0;", dot(10, 1)), 2.6],
    [ring("inset:9%;", dot(7, 0.7)), -3.8],
  ];
  const mail = icon(rings, "mail", 104, "position:absolute;left:63px;top:63px;");
  mk(loader, "font-mono", "margin-top:56px;font-size:22px;color:rgba(255,255,255,.82);white-space:nowrap;", "Reading lakeviewhigh.example for its contact address and removal policy");
  const logBox = mk(loader, "font-mono", `margin-top:26px;width:520px;height:120px;font-size:19px;line-height:38px;color:${MUTED};`);
  const logs = LOGS.map(([at, text]) => ({ at, el: mk(logBox, "", "display:flex;align-items:center;gap:14px;white-space:nowrap;", `${TICK}<span>${text}</span>`) }));

  // Beat 2: the draft card, laid out like the app's own.
  const col = mk(hud, "pv-abs", centre + "gap:22px;perspective:1800px;");
  const tilt = mk(col, "", "position:relative;width:1000px;transform-style:preserve-3d;will-change:transform;");
  const panel = mk(tilt, "", PANEL + "border-radius:26px;padding:32px 38px;display:flex;flex-direction:column;gap:16px;background:rgba(11,11,11,.93);");
  const pill = "flex:none;padding:0 18px;height:44px;line-height:42px;border:1px solid rgba(255,255,255,.22);border-radius:999px;font-size:18px;";
  mk(
    panel,
    "",
    "display:flex;justify-content:space-between;align-items:flex-start;gap:20px;",
    `<div><div class="font-display" style="font-size:32px;font-weight:600;line-height:1.15">Removal request for lakeviewhigh.example</div>` +
      `<div style="margin-top:6px;font-size:20px;color:${MUTED}">Ready to send from your own email. Nothing is sent from here.</div></div>` +
      `<div style="flex:none;font-size:18px;color:${MUTED};padding-top:6px">Close</div>`,
  );
  const field = (label: string, body: boolean) => {
    const row = mk(panel, "", "display:flex;align-items:flex-end;gap:12px;");
    const wrap = mk(row, "", "flex:1;min-width:0;font-size:18px;", label);
    const box = mk(
      wrap,
      body ? "font-mono" : "",
      "margin-top:6px;box-sizing:border-box;border:1px solid rgba(255,255,255,.16);background:#151515;border-radius:12px;white-space:pre-wrap;" +
        (body ? "padding:14px 18px;height:342px;font-size:16.5px;line-height:26px;" : "padding:0 18px;height:50px;line-height:48px;font-size:21px;"),
    );
    const text = document.createElement("span");
    const caret = document.createElement("span");
    caret.style.cssText = "display:inline-block;width:2px;height:1.15em;margin-left:2px;vertical-align:text-bottom;background:#fff;";
    box.append(text, caret);
    if (!body) mk(row, "", pill + "margin-bottom:3px;", "Copy");
    return { text, caret };
  };
  const to = field("To", false);
  const subject = field("Subject", false);
  const message = field("Message", true);
  mk(panel, "", `font-size:18px;color:${MUTED};`, "Send it from alex.rivera@mail.example so the site can reply to you.");
  const actions = mk(panel, "", "display:flex;align-items:center;gap:12px;");
  const btn = "flex:none;padding:0 22px;height:52px;line-height:50px;border-radius:12px;font-size:19px;font-weight:500;";
  const open = mk(actions, "", btn + "background:#fff;color:#000;border:1px solid #fff;", "Open in my email app");
  mk(actions, "", btn + "border:1px solid rgba(255,255,255,.22);", "Copy message");
  mk(actions, "", btn + "border:1px solid rgba(255,255,255,.22);", "Copy all");
  mk(actions, "", btn + `color:${MUTED};border:1px solid transparent;`, "I sent it");
  const ready = mk(actions, "", `margin-left:auto;display:flex;align-items:center;gap:10px;font-size:20px;font-weight:500;color:${GREEN};`, `${TICK}<span>Ready</span>`);
  const shield = icon(tilt, "shield", 150, "position:absolute;right:-66px;top:-50px;");
  const note = mk(col, "font-mono pv-mono", "font-size:19px;", "Based on the site’s own privacy policy");

  const type = (f: { text: HTMLElement; caret: HTMLElement }, full: string, t: number, start: number, len: number, blinkAfter = 0) => {
    const p = seg(t, start, len);
    const next = full.slice(0, Math.floor(full.length * p));
    if (f.text.textContent !== next) f.text.textContent = next;
    const active = t >= start - 0.15 && (p < 1 || (t < start + len + blinkAfter && Math.floor((t - start - len) * 2.5) % 2 === 1));
    f.caret.style.opacity = active ? "1" : "0";
  };

  return (t: number) => {
    const m = ambient(t, dur);
    web.hubs.forEach((h) => (h.pop = h.grow = 1));
    web.facts.forEach((f) => (f.pop = f.grow = 1));
    web.targets.forEach((tg, i) => {
      tg.pop = 1;
      tg.spin = m * 0.4 + i;
      tg.pulse = 0;
      tg.ringP = 0;
    });
    web.arcs.forEach((a) => {
      a.from = 0;
      a.to = 1;
      a.gap = 0;
      a.green = 0;
      a.opacity = 1;
      web.facts[a.fact]!.red = 1;
    });
    const turn = cruise(seg(t, 0.3, dur - 1.3), 0.1, 0.25);
    web.render(orbit(200 + 36 * turn, 11, 64 - 6 * turn), new THREE.Vector3(0, 0, 0));

    // Loader.
    const spin = Math.max(0, t - 0.3);
    const out = seg(t, 2.4, 0.3);
    loader.style.opacity = (1 - out).toFixed(3);
    loader.style.transform = `scale(${lerp(1, 0.94, inCubic(out)).toFixed(3)})`;
    spins.forEach(([el, period]) => (el.style.transform = `rotate(${((spin / period) * 360).toFixed(1)}deg)`));
    mail.style.transform = `translateY(${(5 * Math.sin(spin * 2.2)).toFixed(1)}px) rotate(${(4 * Math.sin(spin * 1.6)).toFixed(2)}deg)`;
    logs.forEach((l) => {
      const p = outCubic(seg(t, l.at, 0.3));
      l.el.style.opacity = p.toFixed(3);
      l.el.style.transform = `translateY(${((1 - p) * 10).toFixed(1)}px)`;
    });

    // Card.
    const enter = outCubic(seg(t, 2.55, 0.55));
    col.style.opacity = seg(t, 2.55, 0.3).toFixed(3);
    tilt.style.transform = `translate3d(0,${(5 * Math.sin(m * 0.9)).toFixed(1)}px,0) rotateY(${(-7 + 4 * turn).toFixed(2)}deg) rotateX(${(4 - 2 * turn).toFixed(2)}deg) scale(${lerp(0.95, 1, enter).toFixed(3)})`;
    type(to, DRAFT_TO, t, 3.05, 0.4);
    type(subject, DRAFT_SUBJECT, t, 3.6, 0.95);
    type(message, DRAFT_BODY, t, 4.7, 2.7, 0.8);
    const done = t >= 7.4;
    open.style.opacity = done ? "1" : "0.4";
    const press = seg(t, 8.0, 0.36);
    const dip = press > 0 && press < 1 ? Math.sin(press * Math.PI) : 0;
    open.style.transform = `scale(${(1 - 0.045 * dip).toFixed(3)})`;
    open.style.boxShadow = `0 0 0 ${(6 * dip).toFixed(1)}px rgba(255,255,255,${(0.28 * dip).toFixed(3)})`;
    const np = outCubic(seg(t, 7.6, 0.4));
    note.style.opacity = np.toFixed(3);
    note.style.transform = `translateY(${((1 - np) * 12).toFixed(1)}px)`;
    shield.style.opacity = seg(t, 8.35, 0.12).toFixed(3);
    shield.style.transform = bob(m, 1, 110, lerp(1.9, 1, outCubic(seg(t, 8.35, 0.35))));
    const rp = seg(t, 8.8, 0.3);
    ready.style.opacity = rp.toFixed(3);
    ready.style.transform = `scale(${pop(rp).toFixed(3)})`;
  };
}

/* 11. Outro: the web calms to green behind the logo, the tagline and the address. */
const SITE = "howtheygot.us";

function sceneOutro(web: Web, hud: HTMLElement, logo: HTMLElement | null, long: boolean) {
  const col = mk(hud, "pv-abs", "inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:20px;");
  mk(hud, "pv-abs", "inset:0;background:radial-gradient(900px 560px at 50% 50%,rgba(0,0,0,.72),transparent 75%);z-index:-1;");
  const lockup = mk(col, "", "display:flex;align-items:center;gap:44px;");
  const mark = mk(lockup, "", "flex:none;width:160px;height:160px;");
  if (logo?.firstElementChild) mark.appendChild(logo.firstElementChild.cloneNode(true));
  const word = mk(lockup, "font-display pv-display", "font-size:136px;white-space:nowrap;", "Scammer’s View");
  const tag = mk(col, "", "margin-top:44px;font-size:42px;font-weight:500;color:rgba(255,255,255,.78);white-space:nowrap;", "See yourself the way a scammer does. Then fix it.");
  const pill = mk(
    col,
    "",
    "margin-top:64px;display:flex;align-items:center;gap:18px;box-sizing:border-box;height:92px;padding:0 48px 0 40px;border-radius:999px;background:#fff;color:#000;font-size:40px;font-weight:600;white-space:nowrap;",
    `<svg width="30" height="34" viewBox="0 0 30 34" fill="none" style="flex:none"><rect x="2" y="14" width="26" height="18" rx="4.5" fill="#000"/><path d="M8 14V10a7 7 0 0 1 14 0v4" stroke="#000" stroke-width="3.6"/></svg>`,
  );
  const text = document.createElement("span");
  const caret = document.createElement("span");
  caret.style.cssText = "display:inline-block;width:3px;height:42px;background:#000;";
  text.textContent = SITE;
  const line = document.createElement("span");
  line.style.cssText = "display:flex;align-items:center;white-space:nowrap;";
  line.append(text, caret);
  pill.append(line);
  // Fix the pill at its full width so it does not grow as the address types in.
  pill.style.width = `${Math.ceil(pill.getBoundingClientRect().width) + 6}px`;
  const floats = [
    { el: icon(hud, "lock", 150, "position:absolute;left:190px;top:570px;"), at: 4.4 },
    { el: icon(hud, "shield", 190, "position:absolute;left:1470px;top:170px;"), at: 4.55 },
    { el: icon(hud, "key", 140, "position:absolute;left:1380px;top:730px;"), at: 4.7 },
  ];

  return (t: number) => {
    // All idle motion comes to rest at 5.5 s, so the last 1.5 s is one still frame.
    // The long cut keeps the same pace but only comes to rest at 14 s, with a highlight running the green paths.
    const turn = cruise(seg(t, 0.3, 5.2), 0.1, 0.3);
    const span = 13.7;
    const ease: [number, number] = [0.52 / span, 1.2 / span];
    const run = span * (1 - ease[0] / 2 - ease[1] / 2) * cruise(seg(t, 0.3, span), ease[0], ease[1]);
    const m = long ? 1.25 * run : 5.2 * turn;
    const angle = long ? (50 / 5.2) * run : 40 * turn;
    const calm = cruise(seg(t, 0.3, 1.5), 0.2, 0.4);
    web.hubs.forEach((h) => (h.pop = h.grow = 1));
    web.facts.forEach((f) => (f.pop = f.grow = 1));
    web.targets.forEach((tg, i) => {
      tg.pop = 1;
      tg.spin = m * 0.4 + i;
      tg.pulse = 0;
      tg.ringP = 0;
      tg.calm = calm;
    });
    web.arcs.forEach((a) => {
      a.from = 0;
      a.to = 1;
      a.gap = 0;
      a.green = calm;
      a.opacity = 1 - 0.35 * calm;
      web.facts[a.fact]!.red = 1 - calm;
    });
    web.arcs.forEach((a, k) => {
      const since = t - 5.6 - k * 0.22;
      const lap = since - Math.floor(since / 3) * 3;
      a.spark = long && since > 0 && t - lap + 1.7 < 13.9 ? lap / 1.7 : -1;
    });
    web.render(orbit(-30 + angle, 12, 66 - 6 * turn), new THREE.Vector3(0, 0, 0));

    const lp = seg(t, 0.4, 0.7);
    mark.style.opacity = seg(t, 0.4, 0.3).toFixed(3);
    mark.style.transform = `scale(${pop(lp).toFixed(3)})`;
    const wp = outCubic(seg(t, 0.7, 0.9));
    word.style.opacity = seg(t, 0.7, 0.5).toFixed(3);
    word.style.transform = `translateY(${((1 - wp) * 36).toFixed(1)}px)`;
    const tp = outCubic(seg(t, 1.8, 0.9));
    tag.style.opacity = seg(t, 1.8, 0.6).toFixed(3);
    tag.style.transform = `translateY(${((1 - tp) * 22).toFixed(1)}px)`;

    const pp = outCubic(seg(t, 3.0, 0.45));
    const press = seg(t, 4.75, 0.4);
    const dip = press > 0 && press < 1 ? Math.sin(press * Math.PI) : 0;
    pill.style.opacity = seg(t, 3.0, 0.25).toFixed(3);
    pill.style.transform = `translateY(${((1 - pp) * 20).toFixed(1)}px) scale(${(lerp(0.9, 1, pp) - 0.035 * dip).toFixed(3)})`;
    pill.style.boxShadow = `0 0 0 ${(9 * dip).toFixed(1)}px rgba(255,255,255,${(0.3 * dip).toFixed(3)})`;
    const typed = SITE.slice(0, Math.floor(SITE.length * seg(t, 3.4, 0.75)));
    if (text.textContent !== typed) text.textContent = typed;
    caret.style.opacity = t >= 3.2 && t < 4.6 && (t < 4.15 || Math.floor((t - 4.15) * 4) % 2 === 1) ? "1" : "0";

    floats.forEach((f, i) => {
      f.el.style.opacity = seg(t, f.at, 0.2).toFixed(3);
      f.el.style.transform = bob(m, i, 0, pop(seg(t, f.at, 0.5)));
    });
  };
}

export function Promo3D({ scene }: { scene: number }) {
  const stageRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let cleanup = () => {};
    const dur = DURATIONS[scene] ?? 8;
    const fonts = ['700 80px "Clash Display"', '600 80px "Clash Display"', '500 40px "Switzer"', '400 40px "Fragment Mono"'];

    Promise.all(fonts.map((f) => document.fonts.load(f)))
      .then(() => document.fonts.ready)
      .then(() => {
        const stage = stageRef.current;
        const inner = innerRef.current;
        const canvas = canvasRef.current;
        if (!alive || !stage || !inner || !canvas) return;
        const labels = mk(inner, "pv-abs", "inset:0;overflow:hidden;");
        const hud = mk(inner, "pv-abs", "inset:0;overflow:hidden;");
        // In scene 7 the web sits left of centre, leaving the right for the card.
        const web = createWeb(canvas, labels, scene === 7 ? 300 : 0);
        let frame: (t: number) => void;
        if (scene === 8) {
          labels.style.display = "none";
          canvas.style.filter = "blur(5px) brightness(0.6)";
          frame = sceneChips(web, hud);
        } else if (scene === 11 || scene === 12) {
          labels.style.display = "none";
          canvas.style.filter = "blur(4px) brightness(0.5)";
          frame = sceneOutro(web, hud, logoRef.current, scene === 12);
        } else if (scene === 10) {
          labels.style.display = "none";
          canvas.style.filter = "blur(5px) brightness(0.5)";
          frame = sceneDraft(web, hud);
        } else {
          frame = scene === 9 ? sceneTakedown(web, hud) : sceneWeb(web, hud);
        }
        cleanup = () => {
          web.dispose();
          labels.remove();
          hud.remove();
        };
        return Promise.all(pending).then(() => {
          if (!alive) return;
          window.__dur = dur;
          window.__renderAt = (t: number) => frame(Math.min(Math.max(t, 0), dur));
          window.__renderAt(0);
          stage.setAttribute("data-go", "");

          // Live preview. The recorder sets __capture and steps the clock itself.
          const start = performance.now();
          const tick = () => {
            if (!alive || window.__capture) return;
            window.__renderAt?.(((performance.now() - start) / 1000) % (dur + 1));
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        });
      });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      delete window.__renderAt;
      cleanup();
    };
  }, [scene]);

  return (
    <main ref={stageRef} className="pv-stage" data-scene={scene}>
      <style>{"nextjs-portal{display:none!important}"}</style>
      <div ref={innerRef} className="pv-abs" style={{ inset: 0 }}>
        <canvas ref={canvasRef} width={W} height={H} className="pv-abs" style={{ inset: 0, width: W, height: H }} />
      </div>
      {/* Source for the outro logo: the scene clones it into its own layout. */}
      <div ref={logoRef} aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <LogoMark size={160} title="" />
      </div>
    </main>
  );
}
