"use client";

import { useState } from "react";
import { AddToRoom, CampusScams } from "@/features/campus";
import { CAMPUS_LAB_FINDINGS, CAMPUS_LAB_SCHOOL, CAMPUS_LAB_SCORE } from "@/features/campus/fixtures";

/** Dev harness: campus scams and the room share, with fictional findings (Jordan Lee, example.com). */
export default function CampusLabPage() {
  const [masked, setMasked] = useState(false);
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-8">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>Lab: campus mode with fictional findings</span>
        <a href="/lab/campus/room" className="underline underline-offset-4 hover:text-fg">Presenter view</a>
        <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Mask for projector
        </label>
      </div>
      <CampusScams findings={CAMPUS_LAB_FINDINGS} school={CAMPUS_LAB_SCHOOL} masked={masked} />
      <AddToRoom score={CAMPUS_LAB_SCORE} findings={CAMPUS_LAB_FINDINGS} />
    </main>
  );
}
