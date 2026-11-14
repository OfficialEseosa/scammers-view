"use client";

import { scroll } from "motion";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { LiquidField } from "../backgrounds/LiquidField";
import { Icon3D, type Icon3DName } from "../Icon3D";
import { RedactedValue } from "../RedactedValue";
import { RiskDot } from "../Badge";
import { usePrefersReducedMotion } from "../motion";
import { useScrollTimelines } from "./ScrollFx";

const ROWS: { icon: Icon3DName; label: string; value: string; level: "danger" | "warn" | "safe" }[] = [
  { icon: "mail", label: "Email", value: "alex.rivera@example.com", level: "warn" },
  { icon: "pet", label: "Dog's name", value: "Biscuit", level: "danger" },
  { icon: "file", label: "School", value: "Fairview High", level: "danger" },
  { icon: "gift", label: "Birthday", value: "14 March", level: "danger" },
  { icon: "pin", label: "Hometown", value: "Maple Falls", level: "warn" },
];

const TILT = { stiffness: 140, damping: 18, mass: 0.7 };
const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/** Landing hero: headline, CTA slot, and the 3D dossier specimen. */
export function Hero({ cta }: { cta: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const sda = useScrollTimelines();
  const ref = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Fallback only: without CSS scroll timelines, motion's scroll() drives the same exit
  // by writing styles directly (no React renders).
  useEffect(() => {
    const section = ref.current;
    const copy = copyRef.current;
    const card = cardRef.current;
    if (sda || reduced || !section || !copy || !card) return;
    const stop = scroll(
      (p: number) => {
        const k = Math.min(1, p / 0.9);
        copy.style.opacity = String(1 - 0.9 * k);
        copy.style.transform = `translate3d(0, ${20 * k}vh, 0) scale(${1 - 0.07 * k})`;
        card.style.opacity = String(1 - 0.9 * p);
        card.style.transform = `perspective(1400px) translate3d(0, ${14 * p}vh, ${-160 * p}px) rotateX(${32 * p}deg) rotateZ(${-5 * p}deg)`;
      },
      { target: section, offset: ["end end", "end start"] },
    );
    return () => {
      stop();
      copy.style.cssText = "";
      card.style.cssText = "";
    };
  }, [sda, reduced]);

  return (
    <section ref={ref} className="sv-hero relative isolate overflow-clip">
      <LiquidField className="-z-10" />
      <div className="mx-auto grid w-full max-w-7xl items-center gap-20 px-4 pb-20 pt-8 sm:px-8 lg:min-h-[calc(100svh-5rem)] lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:pb-24">
        <div ref={copyRef} className="sv-hero-copy min-w-0">
          <h1 className="sv-intro sv-display text-[clamp(2.6rem,7.4vw,6rem)] leading-[0.95] font-semibold">
            See yourself the way a scammer does.
            <span className="mt-2 block text-muted">Then fix it.</span>
          </h1>
          <div className="sv-intro mt-10" style={d(150)}>
            {cta}
          </div>
        </div>

        <div ref={cardRef} className="sv-hero-card sv-stage relative mx-auto w-full min-w-0 max-w-md lg:max-w-none">
          <Subject reduced={reduced} />
        </div>
      </div>
    </section>
  );
}

/** Pointer (or device) tilt in -1..1 for the card, sprung. Zero when reduced. */
function useTilt(ref: React.RefObject<HTMLElement | null>, reduced: boolean) {
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const x = useSpring(px, TILT);
  const y = useSpring(py, TILT);

  useEffect(() => {
    const el = ref.current;
    if (reduced || !el) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    let on = false;

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const reach = Math.max(r.width, 520);
      px.set(Math.max(-1, Math.min(1, (e.clientX - cx) / reach)));
      py.set(Math.max(-1, Math.min(1, (e.clientY - cy) / reach)));
    };
    const reset = () => {
      px.set(0);
      py.set(0);
    };

    // Phones: follow the device only where no permission prompt is needed (Android).
    let base: [number, number] | null = null;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) {
        base = [e.beta, e.gamma];
        el.dataset.gyro = "";
      }
      px.set(Math.max(-1, Math.min(1, (e.gamma - base[1]) / 25)));
      py.set(Math.max(-1, Math.min(1, (e.beta - base[0]) / 25)));
    };
    type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
    const gyroFree =
      !fine && typeof window.DeviceOrientationEvent !== "undefined" && typeof (window.DeviceOrientationEvent as DOE).requestPermission !== "function";

    const listen = (next: boolean) => {
      if (next === on) return;
      on = next;
      if (fine) {
        if (on) {
          window.addEventListener("pointermove", onMove, { passive: true });
          document.documentElement.addEventListener("pointerleave", reset);
        } else {
          window.removeEventListener("pointermove", onMove);
          document.documentElement.removeEventListener("pointerleave", reset);
          reset();
        }
      } else if (gyroFree) {
        if (on) window.addEventListener("deviceorientation", onTilt, { passive: true });
        else window.removeEventListener("deviceorientation", onTilt);
      }
    };
    // Only track while the card is on screen.
    const io = new IntersectionObserver(([e]) => listen(e.isIntersecting));
    io.observe(el);
    return () => {
      io.disconnect();
      listen(false);
      delete el.dataset.gyro;
    };
  }, [ref, reduced, px, py]);

  return { x, y };
}

function Subject({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { x, y } = useTilt(ref, reduced);
  const rotateY = useTransform(x, (v) => v * 14);
  const rotateX = useTransform(y, (v) => v * -11);
  const sheenX = useTransform(x, (v) => `${v * 22}%`);
  const sheenY = useTransform(y, (v) => `${v * 22}%`);

  return (
    <div ref={ref} className="sv-intro sv-3d" style={d(200)}>
      <div className="sv-idle sv-3d">
        <motion.div className="sv-3d relative" style={reduced ? undefined : { rotateX, rotateY }}>
          <Floating name="lock" size={88} className="-left-[6%] -top-[10%] max-sm:hidden" z={70} delay={350} />
          <Floating name="shield" size={112} className="left-[82%] -top-[14%]" z={110} delay={500} />
          <Floating name="key" size={76} className="left-[88%] top-[78%]" z={90} delay={650} />

          <figure
            aria-label="Example file on a fictional person"
            className="sv-3d relative rounded-frame border border-edge-strong bg-canvas/95 p-5 shadow-pop sm:p-7"
          >
            <div aria-hidden className="sv-sheen">
              <motion.span style={reduced ? undefined : { x: sheenX, y: sheenY }} />
            </div>
            <div aria-hidden className="sv-edge">
              <motion.span style={reduced ? undefined : { x: sheenX, y: sheenY }} />
            </div>

            <div className="sv-3d sv-z-2 relative flex items-baseline justify-between gap-4 border-b border-edge pb-4">
              <div>
                <p className="text-sm text-muted">Subject</p>
                <p className="font-display text-2xl font-semibold tracking-tight">Alex Rivera</p>
              </div>
              <div className="sv-z-3 text-right">
                <p className="sv-num text-5xl leading-none text-danger">78</p>
                <p className="mt-1 text-sm text-muted">exposure</p>
              </div>
            </div>
            <ul className="sv-3d relative divide-y divide-edge">
              {ROWS.map((r, i) => (
                <li key={r.label} className="sv-icon-host sv-z-1 flex min-h-16 items-center gap-3 py-2">
                  <span className="sv-intro flex min-w-0 flex-1 items-center gap-3" style={d(450 + i * 70)}>
                    <Icon3D name={r.icon} size={40} />
                    <span className="w-24 shrink-0 text-sm text-muted sm:w-28">{r.label}</span>
                    <span className="min-w-0 flex-1 truncate text-lg">
                      <RedactedValue value={r.value} redacted peek label={r.label} />
                    </span>
                    <RiskDot level={r.level} label={r.level === "danger" ? "High risk" : "Medium risk"} />
                  </span>
                </li>
              ))}
            </ul>
            <figcaption className="sv-z-1 relative mt-4 flex items-center justify-between text-sm text-muted">
              <span>Fictional</span>
              <span className="max-sm:hidden">Hover a bar</span>
              <span className="sm:hidden">Tap a bar</span>
            </figcaption>
          </figure>
        </motion.div>
      </div>
    </div>
  );
}

function Floating({ name, size, className, z, delay }: { name: Icon3DName; size: number; className: string; z: number; delay: number }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute ${className}`} style={{ translate: `0 0 ${z}px` }}>
      <div className="sv-intro" style={d(delay)}>
        <Icon3D name={name} size={size} motion="float" priority />
      </div>
    </div>
  );
}
