"use client";

import { useState } from "react";
import { ChangeWatch } from "@/features/watch";
import { Button } from "@/design/Button";
import { WATCH_SCAN_A, WATCH_SCAN_B } from "@/lib/watch/fixture";

/** Dev harness: two fictional scans of the same fictional person, a week apart. */
export default function WatchLab() {
  const [which, setWhich] = useState<"A" | "B">("A");
  const scan = which === "A" ? WATCH_SCAN_A : WATCH_SCAN_B;
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 pb-24 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">Lab: fictional scans for Alex Rivera</span>
        <Button size="sm" variant={which === "A" ? "primary" : "secondary"} onClick={() => setWhich("A")} aria-pressed={which === "A"}>
          Scan A (week 1)
        </Button>
        <Button size="sm" variant={which === "B" ? "primary" : "secondary"} onClick={() => setWhich("B")} aria-pressed={which === "B"}>
          Scan B (week 2)
        </Button>
      </div>
      {/* key: a new scan is a new page load in the real app, so the baseline is re-read. */}
      <ChangeWatch key={which} findings={scan.findings} score={scan.score} />
    </main>
  );
}
