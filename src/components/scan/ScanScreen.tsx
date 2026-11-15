"use client";

import { SessionProvider, useSession } from "@/state/session";
import { SessionBar } from "@/components/session/SessionBar";
import { FaceStep } from "@/components/session/FaceStep";
import { LiveStage } from "@/components/session/LiveStage";
import { Results } from "@/components/session/Results";
import { NotMeUndoToast } from "@/components/scan/NotMe";

export function ScanScreen({ name, email = "", mock }: { name: string; email?: string; mock: boolean }) {
  return (
    <SessionProvider mock={mock} subjectName={name} subjectEmail={email}>
      <SessionBar />
      <Flow />
      <NotMeUndoToast />
    </SessionProvider>
  );
}

function Flow() {
  const { stage } = useSession();
  if (stage === "face") return <FaceStep />;
  if (stage === "live") return <LiveStage />;
  if (stage === "results") return <Results />;
  return (
    <div className="grid flex-1 place-items-center p-8 text-center" role="status">
      <div className="flex flex-col items-center gap-6">
        <span aria-hidden className="flex flex-col items-center gap-2">
          <span className="sv-bar h-4 w-56" />
          <span className="sv-bar h-4 w-40" />
          <span className="sv-bar h-4 w-48" />
        </span>
        <p className="sv-display text-3xl">Session deleted</p>
      </div>
    </div>
  );
}
