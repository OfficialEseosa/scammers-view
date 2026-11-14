"use client";

import { useState } from "react";
import { ScamCheck } from "@/features/check";
import type { CallScenarioId } from "@/lib/call/schema";

/** Dev harness: the "Is this a scam?" checker on its own (reference data only, no sign-in). */
export default function CheckLabPage() {
  const [picked, setPicked] = useState<CallScenarioId | null>(null);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 sm:px-8 py-10 flex flex-col gap-6">
      <p className="text-sm text-muted">Lab: scam checker (Typesense when TYPESENSE_HOST is set, otherwise the built-in matcher)</p>
      <ScamCheck onPractise={setPicked} />
      {picked && (
        <p className="text-sm text-muted" data-testid="onPractise">
          onPractise fired: {picked}
        </p>
      )}
    </main>
  );
}
