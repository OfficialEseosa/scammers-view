"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { LogoMark } from "@/design/brand/Logo";
import "./promo.css";

const W = 1920;
const H = 1080;
const RED = "#ff5a4f";
const GREEN = "#3ddc97";

/** Start time of an entrance, in seconds from the first frame. */
function at(t: number, extra?: CSSProperties): CSSProperties {
  return { animationDelay: `${t}s`, ...extra };
}

function vars(v: Record<string, string>): CSSProperties {
  return v as CSSProperties;
}

/** Soft grey light and a dot grid fading out from (cx, cy). */
function Backdrop({ cx = W / 2, cy = H / 2, strength = 0.1 }: { cx?: number; cy?: number; strength?: number }) {
  const mask = `radial-gradient(900px 700px at ${cx}px ${cy}px, #000, transparent 78%)`;
  return (
    <>
      <div className="pv-abs" style={{ inset: 0, background: `radial-gradient(760px 600px at ${cx}px ${cy}px, rgba(255,255,255,${strength}), transparent 70%)` }} />
      <div
        className="pv-abs"
        style={{
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.2) 1.3px, transparent 1.7px)",
          backgroundSize: "36px 36px",
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
    </>
  );
}

/* 1. Title sting. */
function Title() {
  return (
    <>
      <Backdrop />
      <div className="pv-abs" style={{ inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          <div className="pv-rise" style={at(0.5)}>
            <LogoMark size={170} title="" />
          </div>
          <div className="font-display pv-display pv-rise" style={at(0.75, { fontSize: 136 })}>
            Scammer&apos;s View
          </div>
        </div>
        <div className="pv-rise" style={at(1.7, { marginTop: 56, fontSize: 46, fontWeight: 500, color: "rgba(255,255,255,0.72)" })}>
          See yourself the way a scammer does.
        </div>
      </div>
    </>
  );
}

/* 2. Three posts, one account. */
const POSTS: [string, string][] = [
  ["Dog’s name", "Biscuit"],
  ["High school", "Lakeview High"],
  ["Birthday", "March 14"],
];
const POST_X = 180;
const POST_Y = [130, 345, 560];
const TARGET: [number, number] = [1420, 430];

function Posts() {
  const [tx, ty] = TARGET;
  return (
    <>
      <Backdrop cx={tx} cy={ty} strength={0.08} />
      <svg className="pv-abs" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ inset: 0 }} aria-hidden="true">
        <defs>
          <filter id="pv-glow" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
        </defs>
        {POST_Y.map((y, i) => {
          const d = `M${POST_X + 440},${y + 85} C${POST_X + 820},${y + 85} ${tx - 420},${ty} ${tx - 62},${ty}`;
          return (
            <g key={i} fill="none">
              <path className="pv-draw" style={at(1 + i * 0.8)} d={d} pathLength={1} stroke="rgba(255,255,255,0.45)" strokeWidth="2" />
              <path className="pv-fade" style={at(3.7)} d={d} stroke={RED} strokeWidth="2.5" />
            </g>
          );
        })}

        {/* The account: a grey outline first, red once all three lines land. */}
        <g className="pv-fade" style={at(0.5)}>
          <rect x={tx - 44} y={ty - 44} width="88" height="88" rx="9" fill="#000" stroke="rgba(255,255,255,0.5)" strokeWidth="2" transform={`rotate(45 ${tx} ${ty})`} />
        </g>
        <g className="pv-fade" style={at(3.7, { animationDuration: "0.5s" })}>
          <circle cx={tx} cy={ty} r="70" fill={RED} opacity="0.5" filter="url(#pv-glow)" />
          <rect x={tx - 44} y={ty - 44} width="88" height="88" rx="9" fill="#000" stroke={RED} strokeWidth="2" transform={`rotate(45 ${tx} ${ty})`} />
          <rect x={tx - 27} y={ty - 27} width="54" height="54" rx="6" fill={RED} transform={`rotate(45 ${tx} ${ty})`} />
        </g>
        <g transform={`rotate(45 ${tx} ${ty})`}>
          <rect className="pv-ring" style={at(3.7)} x={tx - 44} y={ty - 44} width="88" height="88" rx="9" fill="none" stroke={RED} strokeWidth="2" />
        </g>
      </svg>

      {POSTS.map(([label, value], i) => (
        <div key={label} className="pv-abs pv-card pv-rise" style={at(0.5 + i * 0.8, { left: POST_X, top: POST_Y[i] })}>
          <div className="font-mono pv-mono" style={{ fontSize: 17 }}>
            Public post
          </div>
          <div style={{ marginTop: 14, fontSize: 25, color: "rgba(255,255,255,0.6)" }}>{label}</div>
          <div className="font-display pv-display" style={{ marginTop: 8, fontSize: 44, fontWeight: 600 }}>
            {value}
          </div>
        </div>
      ))}

      <div className="pv-abs pv-fade" style={at(0.5, { left: tx - 300, top: ty + 104, width: 600, textAlign: "center" })}>
        <div className="font-display pv-display" style={{ fontSize: 40, fontWeight: 600 }}>
          Your email account
        </div>
      </div>

      <div className="pv-abs font-display pv-display pv-rise" style={at(5, { left: POST_X, top: 850, fontSize: 104 })}>
        Three posts. One account.
      </div>
    </>
  );
}

/* 3. The scan. */
const CX = 900;
const CY = 560;
/** [name, angle in degrees, facts]. Hubs sit on an ellipse around "You". */
const SOURCES: [string, number, number][] = [
  ["Instagram", -150, 6],
  ["TikTok", -90, 5],
  ["LinkedIn", -30, 6],
  ["GitHub", 30, 5],
  ["Web search", 90, 6],
  ["Data brokers", 150, 7],
];

function rad(deg: number) {
  return (deg * Math.PI) / 180;
}

function Scan() {
  return (
    <>
      <Backdrop cx={CX} cy={CY} strength={0.12} />
      <svg className="pv-abs" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ inset: 0 }} aria-hidden="true">
        <defs>
          <radialGradient id="pv-orb" cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.6" stopColor="#cfcfcf" />
            <stop offset="1" stopColor="#6f6f6f" />
          </radialGradient>
          <filter id="pv-soft" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="20" />
          </filter>
        </defs>
        <ellipse className="pv-fade" style={at(0.5)} cx={CX} cy={CY} rx="470" ry="300" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />

        {SOURCES.map(([name, angle, facts], h) => {
          const t = 1 + h * 0.45;
          const hx = CX + Math.cos(rad(angle)) * 470;
          const hy = CY + Math.sin(rad(angle)) * 300;
          const side = Math.cos(rad(angle));
          // Labels sit away from both the spoke and the fan of facts.
          const label =
            Math.abs(side) < 0.1
              ? { x: hx + 34, y: hy + 9, anchor: "start" as const }
              : { x: hx + (side < 0 ? 12 : -12), y: angle < 0 ? hy + 56 : hy - 36, anchor: side < 0 ? ("end" as const) : ("start" as const) };
          return (
            <g key={name}>
              <line className="pv-draw" style={at(t, { animationDuration: "0.6s" })} x1={CX} y1={CY} x2={hx} y2={hy} pathLength={1} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
              {Array.from({ length: facts }, (_, i) => {
                const spread = 72;
                const a = angle - spread / 2 + (spread / (facts - 1)) * i;
                const r = 92 + ((i * 37 + h * 11) % 64);
                const dx = Math.round(Math.cos(rad(a)) * r);
                const dy = Math.round(Math.sin(rad(a)) * r);
                const ft = t + 0.45 + i * 0.13;
                return (
                  <g key={i}>
                    <line className="pv-draw" style={at(ft, { animationDuration: "0.6s" })} x1={hx} y1={hy} x2={hx + dx} y2={hy + dy} pathLength={1} stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
                    <circle className="pv-dot" style={at(ft, vars({ "--dx": `${dx}px`, "--dy": `${dy}px` }))} cx={hx} cy={hy} r={i % 3 === 0 ? 7 : 5} fill="rgba(255,255,255,0.8)" />
                  </g>
                );
              })}
              <circle className="pv-pop" style={at(t + 0.3)} cx={hx} cy={hy} r="17" fill="url(#pv-orb)" />
              <text className="font-display pv-fade" style={at(t + 0.35)} x={label.x} y={label.y} textAnchor={label.anchor} fill="#fff" fontSize="30" fontWeight="600">
                {name}
              </text>
            </g>
          );
        })}

        <g className="pv-pop" style={at(0.5)}>
          <circle cx={CX} cy={CY} r="96" fill="#fff" opacity="0.3" filter="url(#pv-soft)" />
          <circle cx={CX} cy={CY} r="62" fill="url(#pv-orb)" />
          <text className="font-display" x={CX} y={CY + 12} textAnchor="middle" fill="#000" fontSize="34" fontWeight="700">
            You
          </text>
        </g>
      </svg>

      <div className="pv-abs pv-fade" style={at(0.8, { right: 110, top: 90, textAlign: "right" })}>
        <div className="font-display pv-display pv-num pv-facts" style={{ fontSize: 150 }} />
        <div className="font-mono pv-mono" style={{ marginTop: 10, fontSize: 24 }}>
          facts
        </div>
        <div className="font-display pv-display pv-num pv-seconds" style={{ marginTop: 44, fontSize: 84, fontWeight: 600, color: "rgba(255,255,255,0.72)" }} />
        <div className="font-mono pv-mono" style={{ marginTop: 10, fontSize: 24 }}>
          seconds
        </div>
      </div>
    </>
  );
}

/* 4. The score. */
const FIXES = ["Hide your birthday", "Make your friends list private", "Remove a data broker listing"];

function Score() {
  return (
    <>
      <Backdrop cx={520} cy={520} strength={0.08} />
      <div className="pv-abs pv-fade" style={at(0.5, { left: 180, top: 250, animationDuration: "0.5s" })}>
        <div className="font-display pv-display pv-num pv-score" style={{ fontSize: 460, lineHeight: 0.85, letterSpacing: "-0.03em" }} />
        <div className="font-mono pv-mono" style={{ marginTop: 40, marginLeft: 12, fontSize: 34, letterSpacing: "0.18em" }}>
          exposure
        </div>
      </div>

      <div className="pv-abs" style={{ left: 960, top: 330, width: 800 }}>
        {FIXES.map((fix, i) => {
          const done = 3.4 + i * 0.6;
          return (
            <div
              key={fix}
              className="pv-rise"
              style={at(2.3 + i * 0.2, { display: "flex", alignItems: "center", gap: 28, padding: "38px 0", borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.14)" })}
            >
              <div className="pv-box" style={at(done, { width: 48, height: 48, flex: "none", boxSizing: "border-box", borderRadius: 12, borderWidth: 2, borderStyle: "solid" })}>
                <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
                  <path className="pv-tick" style={at(done + 0.1)} d="M6 12.5l4 4 8-9" pathLength={1} fill="none" stroke="#000" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ flex: 1, fontSize: 40, fontWeight: 500 }}>{fix}</div>
              <div className="font-mono pv-fade" style={at(done, { fontSize: 30, color: GREEN, animationDuration: "0.4s" })}>
                -14
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* 5. Safety. */
const PROMISES = ["Only you.", "Only public.", "Nothing is sent."];

function Safety() {
  return (
    <>
      <Backdrop cx={700} cy={540} strength={0.07} />
      <div className="pv-abs" style={{ left: 200, top: 0, height: H, display: "flex", flexDirection: "column", justifyContent: "center", gap: 46 }}>
        {PROMISES.map((line, i) => (
          <div key={line} style={{ display: "flex", alignItems: "center", gap: 44 }}>
            <div className="pv-wide" style={at(0.5 + i * 1.2, { width: 56, height: 8, borderRadius: 4, background: GREEN })} />
            <div className="font-display pv-display pv-rise" style={at(0.6 + i * 1.2, { fontSize: 150 })}>
              {line}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* 6. End card. */
function End() {
  return (
    <>
      <Backdrop />
      <div className="pv-abs" style={{ inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div className="pv-rise" style={at(0.5)}>
          <LogoMark size={210} title="" />
        </div>
        <div className="font-display pv-display pv-rise" style={at(0.8, { marginTop: 44, fontSize: 128 })}>
          Scammer&apos;s View
        </div>
        <div className="font-mono pv-rise" style={at(1.4, { marginTop: 44, fontSize: 44, letterSpacing: "0.06em", color: "rgba(255,255,255,0.66)" })}>
          howtheygot.us
        </div>
      </div>
    </>
  );
}

const SCENES: Record<number, () => ReactNode> = { 1: Title, 2: Posts, 3: Scan, 4: Score, 5: Safety, 6: End };

/** One clip on a fixed 1920x1080 stage. Animations wait for the fonts, then run once. */
export function PromoStage({ scene }: { scene: number }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    let alive = true;
    document.fonts.ready.then(() => {
      if (alive) ref.current?.setAttribute("data-go", "");
    });
    return () => {
      alive = false;
    };
  }, []);

  const Scene = SCENES[scene] ?? Title;
  return (
    <main ref={ref} className="pv-stage" data-scene={scene}>
      {/* Hide the dev-tools badge so it stays out of the recording. */}
      <style>{"nextjs-portal{display:none!important}"}</style>
      <Scene />
    </main>
  );
}
