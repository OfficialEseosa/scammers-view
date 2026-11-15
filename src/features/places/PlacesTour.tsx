"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./places-map.css";
import type { Finding } from "@/lib/types";
import { KIND_LABEL, summarise, type TourStop } from "@/lib/places/extract";
import { Button, buttonClass } from "@/design/Button";
import { RiskBadge } from "@/design/Badge";
import { EmptyState } from "@/design/states";
import { cn } from "@/design/utils";
import { usePlaces, type PlacesState } from "./usePlaces";
import { GLYPH, type EngineStop, type MapEngine, type Theme } from "./engines/types";

const STEP_MS = 4000;
const FLY_MS = 2400;

export type EngineKind = "google" | "gl" | "leaflet";

/** Best first. Each engine that fails hands over to the next one. */
const CHAIN: EngineKind[] = ["google", "gl", "leaflet"];
const nextEngine = (k: EngineKind): EngineKind | null => CHAIN[CHAIN.indexOf(k) + 1] ?? null;

function loadEngine(k: EngineKind) {
  if (k === "google") return import("./engines/google3d").then((m) => m.createGoogle3dEngine);
  if (k === "gl") return import("./engines/gl").then((m) => m.createGlEngine);
  return import("./engines/leaflet").then((m) => m.createLeafletEngine);
}

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function safeHref(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.href : null;
  } catch {
    return null;
  }
}

function Glyph({ kind, className }: { kind: TourStop["kind"]; className?: string }) {
  // Static SVG strings from GLYPH, never user data.
  return <span aria-hidden className={cn("sv-glyph", className)} dangerouslySetInnerHTML={{ __html: GLYPH[kind] }} />;
}

function placeName(s: TourStop, masked: boolean): string {
  if (masked) return KIND_LABEL[s.kind];
  if (s.kind === "home_area") return s.place?.displayName.split(",")[0] ?? s.name;
  return s.name;
}

export default function PlacesTour({
  findings,
  masked = false,
  engine = "google",
}: {
  findings: Finding[];
  masked?: boolean;
  /** First engine to try (the chain continues below it on failure). */
  engine?: EngineKind;
}) {
  const places = usePlaces(findings, masked);
  // The map mounts only when there is something to show, and remounts cleanly if findings go and come back.
  if (places.stops.length === 0) return <EmptyState>No places in what was found</EmptyState>;
  return <TourView {...places} masked={masked} firstEngine={engine} />;
}

function TourView({
  stops,
  pending,
  authError,
  retry,
  masked,
  firstEngine,
}: PlacesState & { masked: boolean; firstEngine: EngineKind }) {
  const found = useMemo(() => stops.filter((s) => s.status === "found"), [stops]);
  const summary = useMemo(() => summarise(stops), [stops]);

  const rootRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLOListElement>(null);
  const engine = useRef<MapEngine | null>(null);

  const [engineKind, setEngineKind] = useState<EngineKind>(firstEngine);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(true);
  const [bleed, setBleed] = useState<{ left: number; width: number } | null>(null);
  const touched = useRef(false);
  const prevActive = useRef<string | null>(null);
  const env = useRef({ reduced: false, coarse: false });

  const activeIdx = activeId ? found.findIndex((s) => s.id === activeId) : -1;
  const active = activeIdx >= 0 ? found[activeIdx] : null;

  /* ---------- full-bleed hero: escape the page container without a horizontal scrollbar ---------- */
  useLayoutEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      setBleed((b) => (b && b.left === -r.left && b.width === width ? b : { left: -r.left, width }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  /* ---------- engine lifecycle ---------- */
  const onSelectRef = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    const host = mapRef.current;
    if (!host) return;
    // Each engine gets its own element: a late-resolving instance never shares a container with the next one.
    const el = document.createElement("div");
    el.className = "sv-places-engine";
    host.append(el);
    env.current = {
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      coarse: window.matchMedia("(pointer: coarse)").matches,
    };
    let alive = true;
    let made: MapEngine | null = null;
    setReady(false);
    const next = nextEngine(engineKind);
    const fallback = () => {
      if (!alive || !next) return;
      alive = false;
      made?.destroy();
      made = null;
      engine.current = null;
      el.remove();
      setEngineKind(next);
    };
    loadEngine(engineKind)
      .then((factory) =>
        factory({
          container: el,
          theme: readTheme(),
          reduced: env.current.reduced,
          coarse: env.current.coarse,
          padding: () => {
            const desk = window.matchMedia("(min-width: 768px)").matches;
            const p = panelRef.current?.getBoundingClientRect();
            return desk && p ? { top: 24, right: 72, bottom: 24, left: p.width + 32 } : { top: 24, right: 24, bottom: 24, left: 24 };
          },
          onSelect: (id) => onSelectRef.current(id),
          onUserInteract: () => {
            touched.current = true;
          },
          onFail: () => fallback(),
          onReady: () => {
            if (alive) setReady(true);
          },
        }),
      )
      .then((m) => {
        if (!alive) return m.destroy();
        made = m;
        engine.current = m;
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!next || !alive) return;
        console.warn(`[places] ${engineKind} map unavailable (${err instanceof Error ? err.message : "error"}); trying ${next}`);
        fallback();
      });
    return () => {
      alive = false;
      made?.destroy();
      engine.current = null;
      el.remove();
    };
  }, [engineKind]);

  /* ---------- theme ---------- */
  useEffect(() => {
    const mo = new MutationObserver(() => engine.current?.setTheme(readTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  /* ---------- pause everything off-screen or in a hidden tab ---------- */
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    let onScreen = true;
    const apply = () => setVisible(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      apply();
    });
    io.observe(hero);
    document.addEventListener("visibilitychange", apply);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", apply);
    };
  }, []);
  useEffect(() => {
    engine.current?.setActive(visible);
  }, [visible, ready]);

  /* ---------- pins ---------- */
  const engineStops: EngineStop[] = useMemo(
    () =>
      found.map((s) => ({
        id: s.id,
        kind: s.kind,
        lat: s.lat!,
        lng: s.lng!,
        precision: s.place!.precision,
        approximate: !!s.place?.approximate,
        label: masked ? KIND_LABEL[s.kind] : s.kind === "home_area" ? "Home area" : placeName(s, false),
      })),
    [found, masked],
  );
  useEffect(() => {
    if (!ready) return;
    engine.current?.setStops(engineStops);
  }, [engineStops, ready]);

  // Fit as pins arrive, until the person takes over or the tour starts.
  useEffect(() => {
    if (!ready || !engineStops.length || touched.current || playing || activeId) return;
    const t = window.setTimeout(() => engine.current?.fitAll(true), 500);
    return () => window.clearTimeout(t);
  }, [engineStops.length, ready, playing, activeId]);

  useEffect(() => {
    engine.current?.setIdle(!playing && !activeId);
  }, [playing, activeId, ready]);

  /* ---------- selection and camera ---------- */
  useEffect(() => {
    if (!ready) return;
    const e = engine.current;
    e?.select(activeId);
    if (activeId) {
      e?.goTo(activeId, { duration: FLY_MS, from: playing ? prevActive.current : null });
    }
    prevActive.current = activeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, ready]);

  /* ---------- the tour clock ---------- */
  useEffect(() => {
    if (!playing || !visible) return;
    const t = window.setTimeout(() => {
      if (activeIdx < found.length - 1) setActiveId(found[activeIdx + 1].id);
      else {
        setPlaying(false);
        setActiveId(null);
        engine.current?.fitAll(true);
      }
    }, activeIdx < 0 ? 0 : STEP_MS);
    return () => window.clearTimeout(t);
  }, [playing, visible, activeIdx, found]);

  const play = useCallback(() => {
    if (!found.length) return;
    touched.current = true;
    if (activeIdx < 0 || activeIdx >= found.length - 1) {
      prevActive.current = null;
      setActiveId(found[0].id);
    }
    setPlaying(true);
  }, [found, activeIdx]);

  const stop = useCallback((fit: boolean) => {
    setPlaying(false);
    if (fit) {
      setActiveId(null);
      engine.current?.fitAll(true);
    }
  }, []);

  const jump = useCallback(
    (id: string) => {
      touched.current = true;
      setPlaying(false);
      setActiveId((cur) => (cur === id ? cur : id));
    },
    [],
  );
  useEffect(() => {
    onSelectRef.current = jump;
  }, [jump]);

  const step = useCallback(
    (d: 1 | -1) => {
      if (!found.length) return;
      setPlaying(false);
      touched.current = true;
      const i = activeIdx < 0 ? (d > 0 ? 0 : found.length - 1) : Math.min(found.length - 1, Math.max(0, activeIdx + d));
      setActiveId(found[i].id);
    },
    [found, activeIdx],
  );

  /* ---------- keys: arrows step, Esc stops ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const root = rootRef.current;
      if (!root) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const within = !!t && root.contains(t);
      const onBody = !t || t === document.body;
      if (!within && !(onBody && visible)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        step(e.key === "ArrowRight" ? 1 : -1);
      } else if (e.key === "Escape" && (playing || activeId)) {
        e.preventDefault();
        stop(!playing);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, stop, playing, activeId, visible]);

  /* ---------- rail follows the tour ---------- */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !activeId) return;
    const item = rail.querySelector<HTMLElement>(`[data-stop="${CSS.escape(activeId)}"]`);
    if (!item) return;
    const left = item.offsetLeft - rail.clientWidth / 2 + item.clientWidth / 2;
    rail.scrollTo({ left, behavior: env.current.reduced ? "auto" : "smooth" });
  }, [activeId]);


  const locating = stops.length - pending;
  const status =
    pending > 0 ? `Pinning ${Math.min(locating + 1, stops.length)} of ${stops.length}` : `${found.length} of ${stops.length} pinned`;

  return (
    <section ref={rootRef} aria-label="Where you can be found" className="sv-places" data-engine={engineKind}>
      <div
        ref={heroRef}
        className="sv-places-hero"
        style={bleed ? { marginLeft: bleed.left, width: bleed.width } : undefined}
      >
        <div className="sv-places-stage">
          <div ref={mapRef} className="sv-places-map" role="region" aria-label="Map of your places" />
          {!ready && <div className="sv-places-mapload" role="status" aria-label="Loading map"><span className="sv-skeleton absolute inset-0 rounded-none" /></div>}
          <p className="sv-places-status" aria-live="polite">
            {pending > 0 && <span className="sv-places-status-dot" aria-hidden />}
            {status}
          </p>
          {authError && (
            <div className="sv-places-auth">
              <div className="sv-places-auth-card" role="alert">
                <p className="font-display text-xl font-semibold">Sign in to map your places</p>
                <Link href="/consent" className={buttonClass("primary", "md", "mt-4")}>Sign in</Link>
              </div>
            </div>
          )}
        </div>

        <div ref={panelRef} className="sv-places-panel">
          <Caption stop={active} index={activeIdx} total={found.length} masked={masked} summary={summary} pending={pending} />
          <div className="sv-places-controls">
            {playing ? (
              <Button size="md" onClick={() => stop(false)} aria-label="Pause the tour" className="sv-play">
                <PauseIcon /> Pause
                <span key={activeId ?? "x"} className={cn("sv-play-progress", !visible && "is-paused")} style={{ animationDuration: `${STEP_MS}ms` }} aria-hidden />
              </Button>
            ) : (
              <Button size="md" onClick={play} disabled={!found.length || !ready} className="sv-play">
                <PlayIcon /> {activeIdx >= 0 && activeIdx < found.length - 1 ? "Resume" : "Play the week"}
              </Button>
            )}
            <Button variant="secondary" size="md" className="w-12 px-0" aria-label="Previous place" onClick={() => step(-1)} disabled={!found.length || !ready}>
              <Chevron dir="left" />
            </Button>
            <Button variant="secondary" size="md" className="w-12 px-0" aria-label="Next place" onClick={() => step(1)} disabled={!found.length || !ready}>
              <Chevron dir="right" />
            </Button>
            <Button variant="ghost" size="md" className="ml-auto px-3" onClick={() => stop(true)} disabled={!found.length || !ready}>
              Show all
            </Button>
          </div>
        </div>
      </div>

      <ol ref={railRef} className="sv-places-rail" aria-label="Stops">
        {stops.map((s) => {
          const n = found.findIndex((f) => f.id === s.id);
          const isActive = s.id === activeId;
          return (
            <li key={s.id} data-stop={s.id} className="sv-places-railitem">
              {s.status === "missing" ? (
                <div className="sv-stop is-missing">
                  <Glyph kind={s.kind} className="sv-stop-glyph" />
                  <span className="min-w-0">
                    <span className="sv-stop-name">{placeName(s, masked)}</span>
                    <span className="sv-stop-meta">Not found on the map</span>
                  </span>
                  <button type="button" className="sv-stop-retry" onClick={() => retry(s.id)}>
                    Retry
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={cn("sv-stop", s.status === "pending" && "is-pending", isActive && "is-active", s.kind === "home_area" && "is-home")}
                  disabled={s.status !== "found" || !ready}
                  aria-current={isActive ? "step" : undefined}
                  onClick={() => jump(s.id)}
                >
                  <span className="sv-stop-num" aria-hidden>{n >= 0 ? String(n + 1).padStart(2, "0") : "--"}</span>
                  <Glyph kind={s.kind} className="sv-stop-glyph" />
                  <span className="min-w-0">
                    <span className="sv-stop-name">{placeName(s, masked)}</span>
                    <span className="sv-stop-meta">
                      {s.status === "pending" ? "Locating" : s.when ?? (s.kind === "home_area" ? (masked ? "Approximate" : "Home area, approximate") : masked ? "Pinned" : KIND_LABEL[s.kind])}
                    </span>
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <div className="sv-places-summary">
        <dl className="sv-places-counts">
          <div>
            <dt>places</dt>
            <dd>{summary.pinned}</dd>
          </div>
          <div>
            <dt>with a time</dt>
            <dd>{summary.timed}</dd>
          </div>
          <div>
            <dt>exact venues</dt>
            <dd>{summary.venues}</dd>
          </div>
          {summary.homeExposed && (
            <div className="sv-places-home">
              <RiskBadge level="danger">Home area exposed</RiskBadge>
            </div>
          )}
        </dl>
        {summary.fixes.length > 0 && (
          <ul className="sv-places-fixes" aria-label="Fixes">
            {summary.fixes.map((f) => (
              <li key={f.text}>
                <button type="button" className="sv-fix" onClick={() => found.some((s) => s.id === f.stopIds[0]) && jump(f.stopIds[0])}>
                  <CheckIcon />
                  <span>{f.text}</span>
                  {f.stopIds.length > 1 && <span className="sv-fix-n">{f.stopIds.length}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Caption({
  stop,
  index,
  total,
  masked,
  summary,
  pending,
}: {
  stop: TourStop | null;
  index: number;
  total: number;
  masked: boolean;
  summary: ReturnType<typeof summarise>;
  pending: number;
}) {
  if (!stop) {
    return (
      <div className="sv-caption" key="intro">
        <p className="sv-caption-kind">A week in your life</p>
        <p className="sv-caption-title">
          {total ? `${total} ${total === 1 ? "stop" : "stops"} a stranger can visit` : pending ? "Pinning your places" : "Nothing pinned yet"}
        </p>
        <p className="sv-caption-why">
          {summary.homeExposed ? "Home area, then school, work and your routine, in order." : "School, work and your routine, in order."}
        </p>
      </div>
    );
  }
  const href = masked ? null : safeHref(stop.finding.sourceUrl);
  const p = stop.place;
  return (
    <div className="sv-caption" key={stop.id}>
      <p className="sv-caption-kind">
        <Glyph kind={stop.kind} className={cn("sv-caption-glyph", stop.kind === "home_area" && "is-home")} />
        <span>{KIND_LABEL[stop.kind]}</span>
        <span className="sv-caption-count">
          {index + 1}/{total}
        </span>
      </p>
      <p className="sv-caption-title">{placeName(stop, masked)}</p>
      {!masked && p && (
        <p className="sv-caption-where">{stop.kind === "home_area" ? `${p.displayName}, city only` : p.displayName}</p>
      )}
      {stop.when && (
        <p className="sv-caption-when">
          <Glyph kind="hangout" className="sv-caption-when-glyph" />
          {stop.when}
        </p>
      )}
      <p className="sv-caption-why">{stop.why}</p>
      <p className="sv-caption-source">
        From{" "}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {stop.finding.sourceTitle || stop.source}
          </a>
        ) : (
          stop.source
        )}
        {stop.fix && <span className="sv-caption-fix">Fix: {stop.fix.charAt(0).toLowerCase() + stop.fix.slice(1)}</span>}
      </p>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" />
    </svg>
  );
}
function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d={dir === "left" ? "M11 3.5 5.5 9l5.5 5.5" : "M7 3.5 12.5 9 7 14.5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <path d="m3 8.5 3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
