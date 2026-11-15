"use client";

import { useState } from "react";
import { FixList } from "@/features/fixes/FixList";
import { FIXTURE_CHAINS, FIXTURE_FINDINGS, FIXTURE_SCORE } from "@/lib/fixes/fixture";
import { SessionProvider } from "@/state/session";

/** Dev harness: a fictional scan (Alex Rivera) driving the lock-down list. */
export default function FixesLab() {
  const [masked, setMasked] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  return (
    <SessionProvider mock subjectName="Alex Rivera" subjectEmail="alex@example.edu">
      <main className="mx-auto w-full max-w-3xl pb-24 sm:px-6">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 text-sm text-muted sm:px-0">
          <span>Lab: fictional scan for Alex Rivera</span>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} className="size-5" />
            Mask values
          </label>
        </div>
        <FixList
          findings={FIXTURE_FINDINGS}
          chains={FIXTURE_CHAINS}
          score={FIXTURE_SCORE}
          masked={masked}
          onRemovedChange={setRemoved}
        />
        <p data-testid="removed" className="mt-10 px-4 font-mono text-xs text-muted sm:px-0">
          removedFindingIds: {removed.join(", ") || "none"}
        </p>
      </main>
    </SessionProvider>
  );
}
