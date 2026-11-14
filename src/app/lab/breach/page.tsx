"use client";

import { useMemo, useState } from "react";
import { BreachCheck } from "@/features/breach";
import { FIXTURE_BREACHES, FIXTURE_CLEAN } from "@/lib/breach/fixture";
import type { BreachOutcome } from "@/lib/breach/types";

type Scenario = "breached" | "clean" | "not_configured" | "rate_limited" | "error";

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "breached", label: "Breached" },
  { id: "clean", label: "Clean" },
  { id: "not_configured", label: "Not set up" },
  { id: "rate_limited", label: "Rate limited" },
  { id: "error", label: "Error" },
];

function outcome(s: Scenario): BreachOutcome {
  switch (s) {
    case "breached":
      return { status: "ok", result: FIXTURE_BREACHES };
    case "clean":
      return { status: "ok", result: FIXTURE_CLEAN };
    case "not_configured":
      return { status: "not_configured" };
    case "rate_limited":
      return { status: "rate_limited", retryAfterSeconds: 42 };
    case "error":
      return { status: "error", message: "Could not reach the breach service." };
  }
}

/** Dev harness: fictional fixture (no key, no network) or the live signed-in check. */
export default function BreachLab() {
  const [fixtureOn, setFixtureOn] = useState(true);
  const [scenario, setScenario] = useState<Scenario>("breached");
  const [masked, setMasked] = useState(false);
  const fixture = useMemo(() => (fixtureOn ? outcome(scenario) : undefined), [fixtureOn, scenario]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
        <label className="flex min-h-10 items-center gap-2">
          <input type="checkbox" checked={fixtureOn} onChange={(e) => setFixtureOn(e.target.checked)} className="size-5" />
          Fixture mode
        </label>
        <label className="flex min-h-10 items-center gap-2">
          <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} className="size-5" />
          Mask email
        </label>
        {fixtureOn && (
          <label className="flex min-h-10 items-center gap-2">
            State
            <select value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)} className="min-h-10 rounded-control border border-edge-strong bg-bg px-3 text-fg">
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <BreachCheck key={`${fixtureOn}-${scenario}`} masked={masked} email={fixtureOn ? "alex.rivera@example.com" : undefined} fixture={fixture} />
    </main>
  );
}
