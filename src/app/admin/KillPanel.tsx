"use client";

import { useState } from "react";
import { Button } from "@/design/Button";

export function KillPanel({ initialOn, initialAt, configured, env }: { initialOn: boolean; initialAt: string | null; configured: boolean; env: string }) {
  const [on, setOn] = useState(initialOn);
  const [at, setAt] = useState(initialAt);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: next }) });
      const data = (await res.json()) as { on?: boolean; at?: string; error?: string };
      if (!res.ok || typeof data.on !== "boolean") throw new Error(data.error ?? "Could not save.");
      setOn(data.on);
      setAt(data.at ?? null);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card border border-edge-strong bg-surface p-6 sm:p-8">
      <p className="text-muted">Owner controls · {env}</p>
      <h1 className="sv-display mt-2 text-[clamp(2.2rem,6vw,3.75rem)] leading-[0.95]">Kill switch</h1>

      <p className="mt-6 flex items-center gap-3 text-xl">
        <span aria-hidden className={`size-3 rounded-full ${on ? "bg-danger" : "bg-safe"}`} />
        <span className="font-semibold">{on ? "Activated. The site is down." : "Off. The site is running."}</span>
      </p>
      {at && <p className="mt-1 text-muted">Last changed {new Date(at).toLocaleString()}</p>}

      {!configured && <p className="mt-6 text-warn-fg">Needs APIFY_TOKEN and ADMIN_EMAIL to be set.</p>}
      {error && (
        <p role="alert" className="mt-6 text-danger-fg">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        {on ? (
          <Button variant="primary" size="lg" disabled={busy || !configured} onClick={() => void set(false)}>
            {busy ? "Restoring" : "Bring the site back"}
          </Button>
        ) : confirming ? (
          <>
            <Button variant="destructive" size="lg" disabled={busy} onClick={() => void set(true)}>
              {busy ? "Killing" : "Yes, take it down now"}
            </Button>
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="destructive" size="lg" disabled={!configured} onClick={() => setConfirming(true)}>
            Activate kill switch
          </Button>
        )}
      </div>
      <p className="mt-6 text-muted">Takes effect within about 10 seconds. Pages show the unavailable screen and every API call is refused.</p>
    </section>
  );
}
