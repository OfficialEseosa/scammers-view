"use client";

import { useState } from "react";
import { PracticeAttacks } from "@/features/practice";
import { LAB_FINDINGS } from "@/features/practice/fixtures";

/** Dev harness: exercises Practice Attacks with fictional findings ("Alex Rivera", example.com, 555 numbers). */
export default function PracticeLabPage() {
  const [masked, setMasked] = useState(false);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 sm:px-8 py-10 flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>Lab: practice attacks with fictional findings</span>
        <label className="ml-auto inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} className="accent-[var(--amber)]" />
          Mask for projector
        </label>
      </div>
      <PracticeAttacks findings={LAB_FINDINGS} masked={masked} />
    </main>
  );
}
