"use client";

import { useEffect, useState } from "react";
import { clearScanCache, deleteServerScan } from "@/hooks/scanCache";
import { clearSession } from "@/state/sessionPersist";
import { clearFaceData } from "@/features/face";
import { clearVoiceData } from "@/lib/voice-exposure/store";
import { useSession } from "@/state/session";

/**
 * Owner only: wipe every saved copy of the scan and start over from a clean
 * slate, so a demo shows a real scan running live instead of saved results.
 * The button renders only when the server confirms the signed-in person is
 * the owner (the same check that guards the kill switch).
 */
export function OwnerReset() {
  const { mock } = useSession();
  const [owner, setOwner] = useState(false);
  const [state, setState] = useState<"idle" | "confirm" | "working" | "failed">("idle");

  useEffect(() => {
    if (mock) return;
    let off = false;
    fetch("/api/admin/kill", { cache: "no-store" })
      .then((r) => {
        if (!off && r.ok) setOwner(true);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [mock]);

  if (!owner) return null;

  const reset = async () => {
    setState("working");
    // Server copy first: if it cannot be deleted, keep everything so nothing is half-cleared.
    const gone = await deleteServerScan();
    if (!gone) {
      setState("failed");
      return;
    }
    clearScanCache();
    clearSession();
    clearFaceData();
    clearVoiceData();
    // A full reload drops every in-memory result and starts the flow again; with no saved copy left, the scan runs live.
    window.location.assign("/scan");
  };

  if (state === "confirm" || state === "working" || state === "failed") {
    return (
      <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-edge-strong pl-3 pr-1 text-sm max-md:hidden">
        <span className={state === "failed" ? "text-danger-fg" : "text-muted"}>
          {state === "failed" ? "Could not delete the saved scan" : state === "working" ? "Clearing" : "Delete saved scans and run fresh?"}
        </span>
        {state !== "working" && (
          <>
            <button type="button" className="sv-press min-h-7 rounded-full bg-fg px-2.5 font-medium text-canvas" onClick={() => void reset()}>
              {state === "failed" ? "Retry" : "Yes"}
            </button>
            <button type="button" className="sv-press min-h-7 rounded-full border border-edge-strong px-2.5 font-medium hover:border-fg" onClick={() => setState("idle")}>
              No
            </button>
          </>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="sv-press inline-flex min-h-8 items-center gap-2 rounded-full border border-edge-strong px-3 text-sm font-medium hover:border-fg max-md:hidden"
      onClick={() => setState("confirm")}
      title="Owner only: delete saved scans and start a fresh live scan"
    >
      <span aria-hidden className="size-2 rounded-full bg-warn" />
      Fresh demo
    </button>
  );
}
