"use client";

import { CalendarPlus, Check, Fingerprint, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/design/Button";
import { Card, Divider } from "@/design/Card";
import { Chip } from "@/design/Badge";
import { riskColor } from "@/design/risk";
import { diffSnapshots, toSnapshot, type Snapshot, type WatchDiff } from "@/lib/watch/diff";
import { hashFindings, newSalt } from "@/lib/watch/fingerprint";
import { buildReminderIcs } from "@/lib/watch/ics";
import { MAX_HISTORY, appendSnapshot, clearWatch, freshStore, loadWatch, saveWatch, sparklinePath, sparklinePoints, type WatchStore } from "@/lib/watch/store";
import type { Finding, FindingCategory } from "@/lib/types";

const CATEGORY_NAME: Record<FindingCategory, string> = {
  school: "School",
  employer: "Work",
  email: "Email",
  phone: "Phone",
  location: "Location",
  relative: "Family",
  pet: "Pets",
  birthday: "Birthday",
  handle: "Handles",
  photo: "Photos",
  schedule: "Routine",
  interest: "Interests",
  other: "Other",
  video: "Videos",
};

const DAY = 86_400_000;

function ago(at: string, now: number): string {
  const days = Math.max(0, Math.round((now - Date.parse(at)) / DAY));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * Compares this scan with a fingerprint kept on this device. The fingerprint is salted
 * hashes only, so facts that disappeared can be counted but never read back.
 */
export function ChangeWatch({
  findings,
  score,
  className,
}: {
  findings: Finding[];
  score: number | { score: number };
  className?: string;
}) {
  const scoreNum = Math.round(typeof score === "number" ? score : score.score);
  const [store, setStore] = useState<WatchStore | null>(null);
  const [baseline, setBaseline] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(0);
  const [diff, setDiff] = useState<WatchDiff | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    (async () => {
      const s = loadWatch(window.localStorage);
      setStore(s);
      setBaseline(s ? (s.history[s.history.length - 1] ?? null) : null);
      setNow(Date.now());
      setLoaded(true);
    })();
  }, []);

  const salt = store?.salt;
  useEffect(() => {
    if (!salt || !baseline) return;
    let cancelled = false;
    (async () => {
      const hashed = await hashFindings(salt, findings);
      if (!cancelled) setDiff(diffSnapshots(baseline, hashed, scoreNum));
    })();
    return () => {
      cancelled = true;
    };
  }, [salt, baseline, findings, scoreNum]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const base = store ?? freshStore(newSalt());
      const hashed = await hashFindings(base.salt, findings);
      const next = appendSnapshot(base, toSnapshot(hashed, scoreNum));
      if (saveWatch(window.localStorage, next)) {
        setStore(next);
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  }, [store, findings, scoreNum]);

  function clear() {
    clearWatch(window.localStorage);
    setStore(null);
    setBaseline(null);
    setDiff(null);
    setSaved(false);
    setConfirmClear(false);
  }

  function downloadReminder() {
    const ics = buildReminderIcs({ appUrl: `${window.location.origin}/` });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "rescan-reminder.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const series = useMemo(() => {
    const past = (store?.history ?? []).map((s) => s.score);
    // Unsaved: the current scan is the newest point.
    return (saved ? past : [...past, scoreNum]).slice(-MAX_HISTORY);
  }, [store, saved, scoreNum]);

  if (!loaded) return <Card className={className} aria-busy="true"><div className="sv-skeleton h-24 rounded-control" aria-hidden /></Card>;

  return (
    <Card className={className} aria-labelledby="watch-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="watch-title" className="sv-display text-lg">
          Change watch
        </h3>
        {store && <Chip>Fingerprint on this device</Chip>}
      </div>

      {!store ? (
        <div className="mt-5">
          <Button onClick={save} disabled={busy || findings.length === 0}>
            <Fingerprint className="size-5" aria-hidden /> Remember a fingerprint on this device
          </Button>
          <p className="mt-3 text-sm text-subtle">Kept here only: scrambled hashes, your score and the date. Nothing readable. Nothing sent.</p>
        </div>
      ) : (
        <>
          {baseline && diff ? (
            <Changes diff={diff} baseline={baseline} now={now} score={scoreNum} />
          ) : baseline ? (
            <div className="sv-skeleton mt-5 h-24 rounded-control" aria-hidden />
          ) : null}

          <Trend series={series} />

          <Divider className="my-5" />
          <div className="flex flex-wrap items-center gap-3">
            {saved ? (
              <span role="status" className="inline-flex min-h-11 items-center gap-2 text-sm">
                <Check className="size-4" aria-hidden /> Saved. Your next scan will show what changed.
              </span>
            ) : (
              <Button size="sm" onClick={save} disabled={busy}>
                <Fingerprint className="size-4" aria-hidden /> Save this scan
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={downloadReminder}>
              <CalendarPlus className="size-4" aria-hidden /> Add a reminder to re-scan
            </Button>
            {confirmClear ? (
              <span className="inline-flex items-center gap-2">
                <Button size="sm" variant="destructive" onClick={clear}>
                  Clear history
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                <Trash2 className="size-4" aria-hidden /> Clear history
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function Changes({ diff, baseline, now, score }: { diff: WatchDiff; baseline: Snapshot; now: number; score: number }) {
  const d = diff.scoreDelta;
  const tone = d < 0 ? "text-safe-fg" : d > 0 ? "text-danger-fg" : "text-muted";
  return (
    <div className="mt-5 grid gap-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm text-muted">Since your scan {ago(baseline.at, now)}</span>
        <span className="sv-num text-lg">
          {baseline.score} to {score}
        </span>
        <span data-testid="score-delta" className={`sv-num text-lg font-semibold ${tone}`}>
          {d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : "no change"}
        </span>
        <span className="text-sm text-muted">{d < 0 ? "less exposed" : d > 0 ? "more exposed" : ""}</span>
      </div>

      <div>
        <p className="text-sm font-semibold">New ({diff.added.length})</p>
        {diff.added.length === 0 ? (
          <p className="mt-1 text-muted">Nothing new.</p>
        ) : (
          <ul className="mt-2 grid gap-2" data-testid="added">
            {diff.added.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-edge px-3 py-2">
                <Chip>{CATEGORY_NAME[f.category]}</Chip>
                <span className="font-medium break-words">{f.label}</span>
                <span className="min-w-0 break-words text-muted">{f.value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold">Gone ({diff.removedCount})</p>
        {diff.removed.length === 0 ? (
          <p className="mt-1 text-muted">Nothing disappeared.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="removed">
            {diff.removed.map((r) => (
              <li key={r.category}>
                <Chip>
                  {CATEGORY_NAME[r.category]} <span className="sv-num text-fg">{r.count}</span>
                </Chip>
              </li>
            ))}
          </ul>
        )}
        {diff.removedCount > 0 && <p className="mt-2 text-sm text-subtle">Only counts are shown. The old values were never kept.</p>}
      </div>

      <p className="text-sm text-muted">{diff.unchangedCount} unchanged</p>
    </div>
  );
}

const W = 240;
const H = 56;

function Trend({ series }: { series: number[] }) {
  const pts = sparklinePoints(series, W, H);
  const last = series[series.length - 1];
  return (
    <div className="mt-6">
      <p className="text-sm text-muted">Last {series.length} {series.length === 1 ? "scan" : "scans"}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-14 w-full max-w-sm" role="img" aria-label={`Exposure over your last scans: ${series.join(", ")}`}>
        <line x1="0" x2={W} y1={H - 3} y2={H - 3} stroke="var(--chart-grid)" strokeWidth="1" />
        <path d={sparklinePath(series, W, H)} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4 : 2.5} fill={i === pts.length - 1 ? riskColor(last) : "var(--text)"} />
        ))}
      </svg>
    </div>
  );
}
