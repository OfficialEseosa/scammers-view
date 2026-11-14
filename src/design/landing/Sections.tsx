"use client";

import { animate } from "motion";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Icon3D, type Icon3DName } from "../Icon3D";
import { LogoMark } from "../brand/Logo";
import { cn } from "../utils";
import { Words } from "./Words";
import { CAMPUS_STATS } from "@/lib/campus/patterns";

const vars = (v: Record<string, number | string>) => v as CSSProperties;

/** Section heading: the redaction rule draws, then the words rise out of their slots. */
export function SectionHead({ children, className }: { children: string; className?: string }) {
  return (
    <div data-reveal className={cn("sv-head mb-10 flex flex-col gap-5", className)}>
      <div aria-hidden className="sv-rule flex items-center gap-2">
        <span className="sv-bar h-2 w-16" />
        <span className="sv-bar h-2 w-6 opacity-60" />
        <span className="h-px flex-1 bg-edge" />
      </div>
      <h2 aria-label={children} className="sv-display max-w-[18ch] text-[clamp(2rem,4.6vw,3.75rem)] leading-[1]">
        <Words text={children} />
      </h2>
    </div>
  );
}

type Cell = "yes" | "no" | string;
const ROWS: { label: string; us: Cell; them: Cell }[] = [
  { label: "Shows how facts chain into a takeover", us: "yes", them: "no" },
  { label: "Practice scams written from your facts", us: "yes", them: "no" },
  { label: "Fixes ranked by how much they cut", us: "yes", them: "no" },
  { label: "Data-broker removal", us: "Drafts the requests", them: "yes" },
  { label: "Contacts anyone for you", us: "Never", them: "Brokers, in your name" },
  { label: "Keeps your data", us: "Wiped when you leave", them: "To keep removing it" },
  { label: "Cost", us: "Free", them: "Yearly subscription" },
];

function Mark({ v }: { v: Cell }) {
  if (v === "yes")
    return (
      <span className="inline-flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden>
          <path d="M4 10.5 8 14.5 16 5.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">Yes</span>
      </span>
    );
  if (v === "no")
    return (
      <span className="text-subtle">
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
          <path d="M5 10h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="sr-only">No</span>
      </span>
    );
  return <span>{v}</span>;
}

export function Compare() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col justify-center px-4 py-16 sm:px-8 sm:py-24 lg:min-h-svh">
      <SectionHead>Not another removal service</SectionHead>
      <div className="sv-table overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <thead>
            <tr data-reveal className="sv-row border-b border-edge-strong" style={vars({ "--k": 0 })}>
              <th scope="col" className="py-4 pr-4 font-normal text-muted" style={vars({ "--c": 0 })}>
                <span className="sr-only">Feature</span>
              </th>
              <th scope="col" className="w-[30%] py-4 pr-4" style={vars({ "--c": 1 })}>
                <span className="inline-block rounded-chip bg-accent px-2.5 py-1 font-display text-lg font-semibold text-on-accent">Scammer&apos;s View</span>
              </th>
              <th scope="col" className="w-[30%] py-4 font-display text-lg font-semibold text-muted" style={vars({ "--c": 2 })}>
                Removal services
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, k) => (
              <tr key={r.label} data-reveal className="sv-row border-b border-edge" style={vars({ "--k": k + 1 })}>
                <th scope="row" className="py-4 pr-4 text-lg font-normal" style={vars({ "--c": 0 })}>
                  {r.label}
                </th>
                <td className="py-4 pr-4 text-lg font-semibold" style={vars({ "--c": 1 })}>
                  <Mark v={r.us} />
                </td>
                <td className="py-4 text-lg text-muted" style={vars({ "--c": 2 })}>
                  <Mark v={r.them} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FEATURES: { icon: Icon3DName; title: string; stat: string }[] = [
  { icon: "target", title: "Attack map", stat: "Every way in, step by step" },
  { icon: "shield", title: "Fix list", stat: "Score falls as you tick" },
  { icon: "chat", title: "Practice texts", stat: "Tells highlighted" },
  { icon: "mic", title: "Cloned voicemail", stat: "Your voice, deleted after" },
  { icon: "tick", title: "Real or scam?", stat: "Six messages" },
  { icon: "camera", title: "Photo match", stat: "On this device only" },
  { icon: "pin", title: "Places", stat: "Where you can be found" },
];

export function FeatureStrip() {
  return (
    <section aria-label="What you get" className="flex flex-col justify-center py-16 sm:py-24 lg:min-h-svh">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-8">
        <SectionHead>What you get</SectionHead>
      </div>
      <ul className="sv-deck sv-scroll-x flex scroll-px-4 gap-4 px-4 pb-4 sm:scroll-px-8 sm:px-8 lg:mx-auto lg:grid lg:w-full lg:max-w-7xl lg:grid-cols-4 lg:overflow-visible">
        {FEATURES.map((f, i) => (
          <li
            key={f.title}
            data-reveal
            className="sv-deal sv-icon-host sv-card relative flex min-h-56 w-64 shrink-0 flex-col justify-between overflow-hidden p-6 lg:w-auto"
            style={vars({ "--i": i })}
          >
            <Icon3D name={f.icon} size={84} motion="hover" />
            <div>
              <h3 className="font-display text-xl font-semibold">{f.title}</h3>
              <p className="mt-1 text-muted">{f.stat}</p>
            </div>
          </li>
        ))}
        <li data-reveal className="sv-deal sv-card flex min-h-56 w-64 shrink-0 flex-col justify-end gap-2 bg-accent p-6 text-on-accent lg:w-auto" style={vars({ "--i": 7 })}>
          <span className="sv-num text-6xl leading-none">0</span>
          <span className="font-semibold">Messages sent on your behalf</span>
        </li>
      </ul>
    </section>
  );
}

export function FinalCta({ cta }: { cta: ReactNode }) {
  return (
    <div className="sv-cta mx-auto flex w-full max-w-7xl flex-col justify-center px-4 pb-24 pt-8 sm:px-8 lg:min-h-[80svh]">
      <div data-reveal className="sv-cta-panel relative overflow-hidden rounded-frame bg-accent px-6 py-14 text-on-accent sm:px-12 sm:py-20">
        <div aria-hidden className="absolute inset-y-0 right-0 hidden w-1/2 flex-col justify-center gap-4 pr-12 md:flex">
          {[92, 64, 80, 48, 72].map((w, i) => (
            <span
              key={i}
              className="sv-cta-bar block h-5 rounded-[2px] bg-[var(--on-accent)]"
              style={vars({ width: `${w}%`, marginLeft: "auto", opacity: 0.9 - i * 0.12, "--i": i })}
            />
          ))}
        </div>
        <LogoMark size={72} title="" className="sv-cta-logo relative mb-8 sm:size-24" />
        <h2 className="sv-display relative max-w-[14ch] text-[clamp(2.2rem,5vw,4rem)] leading-[0.98]">Read your own file first.</h2>
        <div className="relative mt-8">{cta}</div>
      </div>
    </div>
  );
}

/** Job-scam losses reported to the FTC (see CAMPUS_STATS "ftc-jobs"), in $M. */
const JOB_LOSSES = [
  { year: "2020", value: 90 },
  { year: "2024", value: 501 },
];

/**
 * When `ref` first scrolls in, mark it `data-in` and run `onEnter`. Only arms (hides)
 * things when JS runs, the viewer allows motion, and the element is still below the fold.
 */
function useEnterOnce(
  ref: React.RefObject<HTMLElement | null>,
  { onArm, onEnter, hide = true }: { onArm?: () => void; onEnter?: () => void; hide?: boolean },
) {
  const cbs = useRef({ onArm, onEnter });
  useEffect(() => {
    cbs.current = { onArm, onEnter };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return;
    if (hide) el.dataset.armed = "";
    cbs.current.onArm?.();
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        el.dataset.in = "";
        io.disconnect();
        cbs.current.onEnter?.();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      delete el.dataset.armed;
      delete el.dataset.in;
    };
  }, [ref, hide]);
}

/** Splits "$540.1M" into prefix / number / suffix so it can count up. */
function parseFigure(s: string) {
  const m = s.match(/^([^\d]*)([\d.,]+)(.*)$/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  const decimals = m[2].split(".")[1]?.length ?? 0;
  return { pre: m[1], n, decimals, post: m[3] };
}

/** The headline number, and the one trend it sits in, drawn as a real bar chart. */
export function StatBand() {
  const head = CAMPUS_STATS.find((s) => s.id === "ic3-20s") ?? CAMPUS_STATS[0];
  const jobs = CAMPUS_STATS.find((s) => s.id === "ftc-jobs");
  const fig = useRef<HTMLParagraphElement>(null);
  const num = useRef<HTMLSpanElement>(null);
  const bars = useRef<HTMLElement>(null);
  const parsed = head ? parseFigure(head.figure) : null;

  // Count up by writing text directly: no React render per frame. The server HTML
  // already holds the final figure, so without JS (or with reduced motion) it just shows.
  useEnterOnce(fig, {
    hide: false,
    onArm: () => {
      if (num.current && parsed) num.current.textContent = (0).toFixed(parsed.decimals);
    },
    onEnter: () => {
      const el = num.current;
      if (!el || !parsed) return;
      animate(0, parsed.n, {
        duration: 1.4,
        ease: [0.23, 1, 0.32, 1],
        onUpdate: (v) => {
          el.textContent = v.toFixed(parsed.decimals);
        },
      });
    },
  });
  useEnterOnce(bars, {});

  if (!head) return null;
  const max = Math.max(...JOB_LOSSES.map((d) => d.value));
  return (
    <section aria-label="Why it matters" className="relative flex flex-col justify-center border-y border-edge bg-canvas/85 lg:min-h-svh">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-8 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:gap-16">
        <div data-reveal className="sv-figure min-w-0">
          <p ref={fig} aria-label={head.figure} className="sv-num pt-[0.08em] text-[clamp(3.6rem,10.5vw,8.5rem)] leading-[0.9]">
            <span aria-hidden className="sv-word">
              <span>
                {parsed ? (
                  <>
                    {parsed.pre}
                    <span ref={num}>{parsed.n.toFixed(parsed.decimals)}</span>
                    {parsed.post}
                  </>
                ) : (
                  head.figure
                )}
              </span>
            </span>
          </p>
          <div className="sv-after">
            <p className="mt-5 max-w-[28ch] text-xl sm:text-2xl">{head.label}</p>
            <a href={head.source.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-muted underline underline-offset-4 hover:text-fg">
              {head.source.title}
            </a>
          </div>
        </div>
        {jobs && (
          <figure ref={bars} className="sv-rise sv-bars sv-card min-w-0 p-5 sm:p-7">
            <figcaption className="font-display text-xl font-semibold leading-tight [text-wrap:balance]">Job scam losses reported to the FTC</figcaption>
            <ul className="mt-6 flex flex-col gap-4">
              {JOB_LOSSES.map((d, i) => (
                <li key={d.year} className="grid grid-cols-[3.25rem_1fr] items-center gap-3">
                  <span className="sv-num text-lg text-muted">{d.year}</span>
                  <span className="relative flex h-12 items-center">
                    <span
                      className="sv-bar-grow absolute inset-y-0 left-0 rounded-r-[4px] bg-fg"
                      style={vars({ width: `${(d.value / max) * 100}%`, opacity: i === JOB_LOSSES.length - 1 ? 1 : 0.45, "--i": i })}
                    />
                    <span
                      className={cn("sv-num relative pl-3 text-2xl", d.value / max > 0.5 ? "text-canvas" : "")}
                      style={d.value / max > 0.5 ? undefined : { marginLeft: `${(d.value / max) * 100}%` }}
                    >
                      ${d.value}M
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 flex items-baseline justify-between gap-4 text-muted">
              <span>
                <span className="sv-num text-fg">5.6×</span> in four years
              </span>
              <a href={jobs.source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-fg">
                {jobs.source.title}
              </a>
            </p>
          </figure>
        )}
      </div>
    </section>
  );
}
