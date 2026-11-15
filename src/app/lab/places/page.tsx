"use client";

import { useState } from "react";
import { PlacesMap } from "@/features/places/PlacesMap";
import { JORDAN, NOWHERE, SAM } from "./fixture";

const SETS = { sam: SAM, jordan: JORDAN, empty: NOWHERE } as const;

export default function Page() {
  const [masked, setMasked] = useState(false);
  const [set, setSet] = useState<keyof typeof SETS>("sam");
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="sv-display text-[clamp(2rem,4vw,2.75rem)] leading-[1]">Where you can be found</h1>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex min-h-11 items-center gap-2">
            <select className="min-h-11 rounded-control border border-edge-strong bg-canvas px-3" value={set} onChange={(e) => setSet(e.target.value as keyof typeof SETS)}>
              <option value="sam">Sam, UK (12 findings)</option>
              <option value="jordan">Jordan, Atlanta (10 findings, duplicates)</option>
              <option value="empty">No places</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="size-5" checked={masked} onChange={(e) => setMasked(e.target.checked)} />
            Masked
          </label>
        </div>
      </div>
      <PlacesMap findings={SETS[set]} masked={masked} />
    </main>
  );
}
