"use client";

import { useMemo, useState } from "react";
import QRCode from "qrcode";
import type { Finding } from "@/lib/types";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { Chip } from "@/design/Badge";
import { matchPatterns } from "@/lib/campus/match";
import { BAND_LABEL_PUBLIC } from "./labels";
import { PATTERN_BY_ID } from "@/lib/campus/patterns";
import { useRoomSeed } from "./roomHash";

export type AddToRoomProps = {
  /** The student's own exposure score, 0..100. */
  score: number;
  findings: Finding[];
};

type State =
  | { t: "idle" }
  | { t: "busy" }
  | { t: "error"; message: string }
  | { t: "done"; code: string; qr: string };

/**
 * Shows the student a 6-character code with only their score band and top scam type.
 * Nothing else leaves the device: the request body is a score and a scam id.
 */
export function AddToRoom({ score, findings }: AddToRoomProps) {
  const top = useMemo(() => matchPatterns(findings)[0]?.pattern, [findings]);
  const [state, setState] = useState<State>({ t: "idle" });
  const room = useRoomSeed();
  const band = score >= 70 ? 2 : score >= 40 ? 1 : 0;

  async function add() {
    if (!top) return;
    setState({ t: "busy" });
    try {
      const res = await fetch("/api/campus/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ score, patternId: top.id }),
      });
      const json = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !json.code) {
        setState({ t: "error", message: json.error ?? "Could not get a code." });
        return;
      }
      const qr = await QRCode.toDataURL(json.code, { margin: 1, width: 192, color: { dark: "#000000", light: "#ffffff" } });
      setState({ t: "done", code: json.code, qr });
    } catch {
      setState({ t: "error", message: "Could not get a code." });
    }
  }

  return (
    <Card as="section" aria-labelledby="room-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="room-h" className="sv-display text-xl">Add my score to the room</h2>
        {room && <Chip>Room {room}</Chip>}
      </div>

      {state.t !== "done" && (
        <>
          <p className="text-muted">
            The code holds two things: your score band ({BAND_LABEL_PUBLIC[band]}) and your top scam type{top ? ` (${top.name})` : ""}. No name, email or finding.
          </p>
          <Button onClick={add} disabled={!top || state.t === "busy"} className="self-start">
            {state.t === "busy" ? "Getting code" : "Get my code"}
          </Button>
          {state.t === "error" && <p role="alert" className="text-danger-fg">{state.message}</p>}
          {!top && <p className="text-muted">No scam matched your findings, so there is nothing to add.</p>}
        </>
      )}

      {state.t === "done" && top && (
        <div className="flex flex-wrap items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.qr} alt={`QR code for room code ${state.code}`} width={144} height={144} className="rounded-control bg-white" />
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted">Read this to the presenter</span>
            <span data-testid="room-code" className="sv-evidence text-4xl font-semibold tracking-[0.1em] sm:text-5xl sm:tracking-[0.18em]">{state.code}</span>
            <span className="text-sm text-muted">{BAND_LABEL_PUBLIC[band]} · {PATTERN_BY_ID[top.id].name}</span>
          </div>
        </div>
      )}
    </Card>
  );
}
