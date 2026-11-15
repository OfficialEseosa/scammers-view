import { notFound } from "next/navigation";
import { LogoMark } from "@/design/brand/Logo";

export const metadata = { title: "Thumbnail" };

const W = 1500;
const H = 1000;

/** Spokes of the web: [angle in degrees, length, facts hanging off the hub]. */
const HUBS: [number, number, number][] = [
  [-150, 230, 5],
  [-95, 210, 4],
  [-35, 240, 6],
  [20, 215, 3],
  [75, 235, 5],
  [140, 220, 4],
];

const CX = 1110;
const CY = 520;

function polar(angle: number, r: number, ox = CX, oy = CY): [number, number] {
  const a = (angle * Math.PI) / 180;
  return [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
}

/** Devpost thumbnail, 3:2. Dev only: open at 1500x1000 and take a screenshot. */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  const target = polar(-35, 240);
  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        width: W,
        height: H,
        overflow: "hidden",
        background: "#000",
        color: "#fff",
      }}
    >
      {/* Hide the dev-tools badge so it stays out of the screenshot. */}
      <style>{"nextjs-portal{display:none!important}"}</style>
      {/* Soft light behind the web, and a dot grid fading out from it. */}
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(620px 520px at ${CX}px ${CY}px, rgba(255,255,255,0.13), transparent 70%)` }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.22) 1.2px, transparent 1.6px)",
          backgroundSize: "30px 30px",
          maskImage: `radial-gradient(760px 640px at ${CX}px ${CY}px, #000, transparent 78%)`,
          WebkitMaskImage: `radial-gradient(760px 640px at ${CX}px ${CY}px, #000, transparent 78%)`,
        }}
      />

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
        <defs>
          <radialGradient id="orb" cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.6" stopColor="#cfcfcf" />
            <stop offset="1" stopColor="#6f6f6f" />
          </radialGradient>
          <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        <ellipse cx={CX} cy={CY} rx="330" ry="118" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" transform={`rotate(-18 ${CX} ${CY})`} />
        <ellipse cx={CX} cy={CY} rx="96" ry="34" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" transform={`rotate(-18 ${CX} ${CY})`} />

        {HUBS.map(([angle, len, facts], h) => {
          const [hx, hy] = polar(angle, len);
          const hot = h === 2;
          return (
            <g key={h}>
              <line x1={CX} y1={CY} x2={hx} y2={hy} stroke={hot ? "#ff5a4f" : "rgba(255,255,255,0.42)"} strokeWidth={hot ? 2.5 : 1.5} />
              {!hot &&
                Array.from({ length: facts }, (_, i) => {
                  const spread = 78;
                  const a = angle - spread / 2 + (spread / Math.max(1, facts - 1)) * i;
                  const [fx, fy] = polar(a, 70 + ((i * 37) % 46), hx, hy);
                  return (
                    <g key={i}>
                      <line x1={hx} y1={hy} x2={fx} y2={fy} stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
                      <circle cx={fx} cy={fy} r={i % 3 === 0 ? 6 : 4.5} fill="rgba(255,255,255,0.75)" />
                    </g>
                  );
                })}
              {!hot && <circle cx={hx} cy={hy} r="15" fill="url(#orb)" />}
            </g>
          );
        })}

        {/* The account at risk. */}
        <circle cx={target[0]} cy={target[1]} r="46" fill="#ff5a4f" opacity="0.55" filter="url(#glow)" />
        <rect x={target[0] - 21} y={target[1] - 21} width="42" height="42" rx="5" fill="#ff5a4f" transform={`rotate(45 ${target[0]} ${target[1]})`} />
        <rect
          x={target[0] - 34}
          y={target[1] - 34}
          width="68"
          height="68"
          rx="7"
          fill="none"
          stroke="#ff5a4f"
          strokeWidth="1.5"
          opacity="0.7"
          transform={`rotate(45 ${target[0]} ${target[1]})`}
        />

        {/* You. */}
        <circle cx={CX} cy={CY} r="70" fill="#fff" opacity="0.35" filter="url(#glow)" />
        <circle cx={CX} cy={CY} r="42" fill="url(#orb)" />
      </svg>

      {/* Exposure score, top right. */}
      <div style={{ position: "absolute", right: 84, top: 70, textAlign: "right" }}>
        <div className="font-display" style={{ fontSize: 148, fontWeight: 700, lineHeight: 0.85, color: "#ff5a4f", letterSpacing: "-0.03em" }}>
          78
        </div>
        <div className="font-mono" style={{ marginTop: 12, fontSize: 22, letterSpacing: "0.16em", color: "rgba(255,255,255,0.6)" }}>
          EXPOSURE
        </div>
      </div>

      {/* Brand. */}
      <div style={{ position: "absolute", left: 84, top: 76, display: "flex", alignItems: "center", gap: 20 }}>
        <LogoMark size={76} title="" />
        <span className="font-display" style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.01em" }}>
          Scammer&apos;s View
        </span>
      </div>

      {/* Headline. */}
      <div style={{ position: "absolute", left: 84, bottom: 150, width: 700 }}>
        <h1 className="font-display" style={{ margin: 0, fontSize: 110, fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.015em" }}>
          See yourself the way a scammer does.
        </h1>
      </div>
      <div className="font-mono" style={{ position: "absolute", left: 88, bottom: 76, fontSize: 26, letterSpacing: "0.06em", color: "rgba(255,255,255,0.62)" }}>
        howtheygot.us
      </div>
    </main>
  );
}
