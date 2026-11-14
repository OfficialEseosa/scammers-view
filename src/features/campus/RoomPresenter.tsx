"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { PATTERN_BY_ID, PATTERNS, type PatternId } from "@/lib/campus/patterns";
import { BAND_LABEL_PUBLIC } from "./labels";
import { randomSeed, useRoomSeed } from "./roomHash";

/** Where the QR sends students: their scan, then "Add my score to the room". */
const JOIN_PATH = "/scan";

type Entry = { code: string; band: 0 | 1 | 2; patternId: PatternId };
type Notice = { tone: "ok" | "warn" | "bad"; text: string } | null;

const BAND_NAME = ["Low", "Medium", "High"] as const;
const BAND_VAR = ["var(--safe)", "var(--warn)", "var(--danger)"] as const;

function normalize(raw: string) {
  return raw.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/**
 * Presenter view. Tallies live only in this tab's memory: no storage, no server state.
 * Codes are checked against the server's signature but are never stored there.
 */
export function RoomPresenter() {
  const seed = useRoomSeed();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // First visit: mint a random seed into the fragment (it never goes to a server).
  useEffect(() => {
    if (!seed) window.location.hash = `room=${randomSeed()}`;
  }, [seed]);

  useEffect(() => {
    if (!seed) return;
    const url = `${window.location.origin}${JOIN_PATH}#room=${seed}`;
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#000000", light: "#ffffff" } }).then((d) => {
      if (live) {
        setQr(d);
        setJoinUrl(url);
      }
    });
    return () => {
      live = false;
    };
  }, [seed]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const code = normalize(value);
    if (code.length !== 6) {
      setNotice({ tone: "bad", text: "Codes have 6 characters." });
      return;
    }
    if (entries.some((x) => x.code === code)) {
      setNotice({ tone: "warn", text: "Already counted." });
      setValue("");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/campus/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setNotice({ tone: "bad", text: res.status === 422 ? "Not a valid code. Check it and try again." : "Could not check the code." });
      } else {
        const d = (await res.json()) as { band: 0 | 1 | 2; patternId: PatternId };
        setEntries((prev) => [...prev, { code, band: d.band, patternId: d.patternId }]);
        setNotice({ tone: "ok", text: "Added." });
        setValue("");
      }
    } catch {
      setNotice({ tone: "bad", text: "Could not check the code." });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const bands = useMemo(() => [0, 1, 2].map((b) => entries.filter((e) => e.band === b).length), [entries]);
  const scams = useMemo(() => {
    const counts = new Map<PatternId, number>();
    for (const e of entries) counts.set(e.patternId, (counts.get(e.patternId) ?? 0) + 1);
    return PATTERNS.map((p) => ({ p, n: counts.get(p.id) ?? 0 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
  }, [entries]);
  const total = entries.length;
  const maxBand = Math.max(1, ...bands);
  const maxScam = Math.max(1, ...scams.map((s) => s.n));
  const noticeColor = notice?.tone === "bad" ? "var(--danger-fg)" : notice?.tone === "warn" ? "var(--warn-fg)" : notice?.tone === "ok" ? "var(--safe-fg)" : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <Card as="section" aria-labelledby="join-h" className="flex flex-col gap-4 self-start">
        <h2 id="join-h" className="sv-display text-xl">Join</h2>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR code to join this room" width={280} height={280} className="w-full max-w-72 rounded-control bg-white" />
        ) : (
          <div className="sv-skeleton aspect-square w-full max-w-72" aria-hidden />
        )}
        <div className="flex flex-col gap-1">
          <span className="text-muted">Room code</span>
          <span data-testid="room-seed" className="sv-evidence text-4xl font-semibold tracking-[0.18em]">{seed || "······"}</span>
        </div>
        {joinUrl && <span className="sv-evidence break-all text-sm text-muted">{joinUrl}</span>}
      </Card>

      <div className="flex flex-col gap-6">
        <Card as="section" aria-labelledby="enter-h" className="flex flex-col gap-4">
          <h2 id="enter-h" className="sv-display text-xl">Enter a student code</h2>
          <form onSubmit={submit} className="flex flex-wrap items-start gap-3">
            <label className="sr-only" htmlFor="code-in">Student code</label>
            <input
              ref={inputRef}
              id="code-in"
              value={value}
              onChange={(e) => setValue(e.target.value.toUpperCase().slice(0, 8))}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Code"
              className="sv-evidence min-h-14 w-full rounded-control border border-edge-strong bg-transparent px-4 text-2xl uppercase tracking-[0.18em] focus:border-fg focus:outline-none sm:w-56"
            />
            <Button type="submit" size="lg" disabled={busy || !value.trim()}>Add</Button>
            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setEntries([]);
                  setNotice(null);
                }}
              >
                Clear tally
              </Button>
            )}
          </form>
          <p role="status" aria-live="polite" className="min-h-6" style={{ color: noticeColor }}>
            {notice?.text}
          </p>
        </Card>

        <Card as="section" aria-labelledby="tally-h" className="flex flex-col gap-6">
          <div className="flex items-baseline gap-3">
            <h2 id="tally-h" className="sv-display text-2xl">In the room</h2>
            <span data-testid="total" className="sv-num text-4xl">{total}</span>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="font-display text-lg font-semibold">Exposure score band</h3>
            <ul className="flex flex-col gap-3">
              {[2, 1, 0].map((b) => (
                <Bar key={b} label={`${BAND_NAME[b]}, ${BAND_LABEL_PUBLIC[b]}`} n={bands[b]} pct={(bands[b] / maxBand) * 100} color={BAND_VAR[b]} />
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="font-display text-lg font-semibold">Top scam type</h3>
            {scams.length === 0 ? (
              <p className="text-muted">Waiting for the first code.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {scams.map(({ p, n }) => (
                  <Bar key={p.id} label={PATTERN_BY_ID[p.id].name} n={n} pct={(n / maxScam) * 100} color="var(--text)" />
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Bar({ label, n, pct, color }: { label: string; n: number; pct: number; color: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="min-w-0 text-base">{label}</span>
      <span className="sv-num text-xl">{n}</span>
      <div className="col-span-2 h-3 rounded-[4px] bg-[var(--border)]" aria-hidden>
        <div className="h-3 rounded-[4px] transition-[width] duration-300" style={{ width: `${n ? Math.max(pct, 3) : 0}%`, background: color }} />
      </div>
    </li>
  );
}
