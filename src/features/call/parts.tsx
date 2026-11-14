"use client";

import { useEffect, useRef } from "react";
import type { Finding } from "@/lib/types";
import type { CallScenarioId, TranscriptLine } from "@/lib/call/schema";
import { maskIn } from "@/components/scan/mask";
import { cn } from "@/design/utils";

export const LABEL: Record<CallScenarioId, string> = {
  "fake-recruiter": "Internship recruiter",
  "professor-gift-cards": "Boss needs gift cards",
  "family-voice-clone": "Family emergency",
};

export const POLL_MS = 1500;

export function Transcript({ lines, findings, masked }: { lines: TranscriptLine[]; findings: Finding[]; masked: boolean }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);
  return (
    <ol className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto" aria-live="polite">
      {lines.map((l, i) => (
        <li
          key={i}
          ref={i === lines.length - 1 ? end : undefined}
          className={cn("max-w-[85%] rounded-card px-4 py-3", l.speaker === "scammer" ? "self-start bg-surface" : "self-end border border-edge-strong")}
        >
          <span className="sr-only">{l.speaker === "scammer" ? "Caller: " : "You: "}</span>
          {maskIn(l.text, findings, masked)}
        </li>
      ))}
    </ol>
  );
}
