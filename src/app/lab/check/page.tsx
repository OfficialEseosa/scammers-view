"use client";

import { ScamCheck } from "@/features/check";

/** Dev harness: the "Is this a scam?" checker on its own (reference data only, no sign-in). */
export default function CheckLabPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 sm:px-8 py-10 flex flex-col gap-6">
      <p className="text-sm text-muted">Lab: scam checker</p>
      <ScamCheck />
    </main>
  );
}
