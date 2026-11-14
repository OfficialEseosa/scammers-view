"use client";

import { useState } from "react";
import { ScamQuiz, type QuizResult } from "@/features/quiz";
import { QUIZ_LAB_FINDINGS } from "@/features/quiz/fixtures";

/** Dev harness: the spot-the-scam quiz with fictional findings (Alex Rivera, example.com). */
export default function QuizLabPage() {
  const [masked, setMasked] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 sm:px-8 py-10 flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>Lab: spot-the-scam quiz with fictional findings</span>
        <label className="ml-auto inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} className="accent-[var(--amber)]" />
          Mask for projector
        </label>
      </div>
      <ScamQuiz findings={QUIZ_LAB_FINDINGS} masked={masked} onComplete={setResult} />
      {result && (
        <p className="text-sm text-muted" data-testid="onComplete">
          onComplete fired: {result.score}/{result.total}, missed: {result.missedCategories.join(", ") || "none"}
        </p>
      )}
    </main>
  );
}
