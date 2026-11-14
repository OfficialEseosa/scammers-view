"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { Icon3D, type Icon3DName } from "../Icon3D";
import { usePrefersReducedMotion } from "../motion";

const FACTS: { icon: Icon3DName; label: string; from: string }[] = [
  { icon: "pet", label: "Dog's name", from: "Instagram caption" },
  { icon: "gift", label: "Birthday", from: "Birthday post" },
  { icon: "file", label: "School", from: "Team roster" },
];
const STEPS = ["Guess the security answer", "Reset the password"];
const ROWS = [70, 190, 310];
const curve = (y: number) => `M300 ${y} C 380 ${y}, 380 190, 444 190`;
const range = (r: string, extra?: CSSProperties) => ({ "--r": r, ...extra }) as CSSProperties;

/**
 * Mini attack map: three public facts chain into one account. On capable browsers
 * the chain is drawn in step with scroll (CSS view timeline) and ends on the red
 * target; elsewhere it is simply drawn. A signal then runs along the chain while
 * it is on screen.
 */
export function ChainDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const reduced = usePrefersReducedMotion();

  // SMIL signals only tick while the diagram is on screen.
  useEffect(() => {
    const el = svg.current;
    if (!el || reduced) return;
    el.pauseAnimations();
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? el.unpauseAnimations() : el.pauseAnimations()));
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <div
      ref={ref}
      data-reveal
      className="sv-chain relative"
      aria-label="A scammer chains three public facts into your school email"
      role="img"
    >
      {/* desktop: left-to-right diagram */}
      <div className="relative hidden aspect-[1000/380] w-full md:block">
        <svg ref={svg} viewBox="0 0 1000 380" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          {ROWS.map((y, i) => (
            <path
              key={y}
              d={curve(y)}
              pathLength={1}
              className="sv-draw"
              style={range(`cover ${22 + i * 3}% cover ${33 + i * 3}%`)}
              fill="none"
              stroke="var(--muted)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ))}
          <path d="M492 190 L 664 190" pathLength={1} className="sv-draw" style={range("cover 35% cover 43%")} fill="none" stroke="var(--text)" strokeWidth="2.5" />
          <path d="M712 190 L 856 190" pathLength={1} className="sv-draw" style={range("cover 42% cover 49%")} fill="none" stroke="var(--danger)" strokeWidth="3" />
          {!reduced && (
            <g className="sv-chain-signals">
              {ROWS.map((y, i) => (
                <circle key={y} r="5" fill="var(--text)" opacity="0">
                  <animateMotion dur="2.6s" begin={`${0.4 + i * 0.85}s`} repeatCount="indefinite" path={`${curve(y)} L 856 190`} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.2 1" />
                  <animate attributeName="opacity" dur="2.6s" begin={`${0.4 + i * 0.85}s`} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.08;0.9;1" />
                </circle>
              ))}
            </g>
          )}
        </svg>
        {FACTS.map((f, i) => (
          <div
            key={f.label}
            className="absolute left-0 w-[30%] -translate-y-1/2"
            style={{ top: `${(ROWS[i] / 380) * 100}%` }}
          >
            <div
              className="sv-chain-fact sv-icon-host flex items-center gap-3 rounded-card border border-edge bg-surface px-3 py-2.5 shadow-card"
              style={{ "--i": i } as CSSProperties}
            >
              <Icon3D name={f.icon} size={48} />
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold">{f.label}</span>
                <span className="block truncate text-muted">{f.from}</span>
              </span>
            </div>
          </div>
        ))}
        {STEPS.map((s, i) => (
          <div
            key={s}
            className="sv-chain-step absolute top-1/2 flex w-[17%] -translate-y-5 flex-col items-start gap-3"
            style={range(i === 0 ? "cover 31% cover 37%" : "cover 39% cover 45%", { left: `${(i === 0 ? 452 : 672) / 10}%` })}
          >
            <span className="grid size-10 place-items-center rounded-full bg-accent font-display text-lg font-semibold text-on-accent ring-8 ring-canvas">{i + 1}</span>
            <span className="text-xl font-semibold leading-snug">{s}</span>
          </div>
        ))}
        <div className="absolute right-0 top-1/2 w-[15%] -translate-y-1/2">
          <div className="sv-chain-target flex flex-col items-center gap-2 rounded-card border-2 border-danger bg-surface px-2 py-5 text-center shadow-pop">
            <Icon3D name="mail" size={60} motion="float" />
            <span className="font-display text-lg font-semibold leading-tight lg:text-xl">School email</span>
            <span className="sv-chain-taken text-danger-fg">Taken over</span>
          </div>
        </div>
      </div>

      {/* phone: vertical chain */}
      <ol className="relative flex flex-col gap-3 md:hidden">
        <span aria-hidden className="sv-spine absolute bottom-8 left-[1.95rem] top-8 w-px bg-edge-strong" />
        {FACTS.map((f) => (
          <li key={f.label} className="sv-link relative flex items-center gap-3 rounded-card border border-edge bg-surface px-3 py-2.5">
            <Icon3D name={f.icon} size={40} />
            <span className="min-w-0">
              <span className="block font-semibold">{f.label}</span>
              <span className="block text-muted">{f.from}</span>
            </span>
          </li>
        ))}
        {STEPS.map((s, i) => (
          <li key={s} className="sv-link relative flex items-center gap-3 pl-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent font-display font-semibold text-on-accent ring-4 ring-canvas">{i + 1}</span>
            <span className="text-lg font-semibold">{s}</span>
          </li>
        ))}
        <li className="sv-link-target relative flex items-center gap-3 rounded-card border-2 border-danger bg-surface px-3 py-3">
          <Icon3D name="mail" size={44} />
          <span className="font-display text-lg font-semibold">School email</span>
          <span className="ml-auto text-danger-fg">Taken over</span>
        </li>
      </ol>
    </div>
  );
}
