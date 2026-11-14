"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { RiskBadge } from "@/design/Badge";
import { ScoreArc } from "@/design/ScoreArc";
import { FAMILY_PATH, daysLeft, type FamilyCard } from "@/lib/family/card";
import { buildShareUrl } from "@/lib/family/board";
import { QrCode } from "./QrCode";
import { useShare } from "./useShare";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; token: string; card: FamilyCard; forKey: string };

/**
 * Mint and share your own family card. The card holds a first name, a score, a risk level
 * and one fix title. Your findings never leave this device.
 */
export function FamilyShare({
  score,
  topFixTitle,
  chainsBroken,
  chainsTotal,
  className,
}: {
  score: number;
  topFixTitle: string;
  chainsBroken: number;
  chainsTotal: number;
  className?: string;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const { canShare, copied, copy, share } = useShare();
  const key = `${Math.round(score)}|${topFixTitle}|${chainsBroken}|${chainsTotal}`;

  async function mint() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/family/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, topFixTitle, chainsBroken, chainsTotal }),
      });
      if (res.status === 401) return setState({ kind: "error", message: "Sign in to make your card." });
      if (!res.ok) return setState({ kind: "error", message: "Could not make the card. Try again." });
      const data = (await res.json()) as { token: string; card: FamilyCard };
      setState({ kind: "ready", token: data.token, card: data.card, forKey: key });
    } catch {
      setState({ kind: "error", message: "Could not reach the server. Try again." });
    }
  }

  const ready = state.kind === "ready" ? state : null;
  const stale = ready ? ready.forKey !== key : false;
  const url = ready && typeof window !== "undefined" ? buildShareUrl(window.location.origin, FAMILY_PATH, ready.token) : "";

  return (
    <Card className={className} aria-labelledby="family-share-title">
      <h3 id="family-share-title" className="sv-display text-lg">
        Share your score with family
      </h3>

      <ul className="mt-4 flex flex-wrap gap-2 text-sm text-muted" aria-label="What your card shows">
        {["First name", "Score", "Risk level", "Top fix"].map((t) => (
          <li key={t} className="rounded-chip border border-edge px-2 py-0.5">
            {t}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-subtle">Never your findings.</p>

      {!ready || stale ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={mint} disabled={state.kind === "loading"}>
            {state.kind === "loading" ? "Making card" : stale ? "Make a new card" : "Make my family card"}
          </Button>
          {state.kind === "error" && (
            <span role="alert" className="text-sm text-danger-fg">
              {state.message}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
          <div className="flex flex-col items-center gap-3">
            <QrCode value={url} label={`QR code for ${ready.card.firstName}'s family card`} />
            <span className="text-sm text-muted">Scan on their phone</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-4">
              <ScoreArc score={ready.card.score} size={72} label="" numberClassName="font-display" />
              <div className="min-w-0">
                <p className="font-display text-lg leading-tight">{ready.card.firstName}</p>
                <RiskBadge level={ready.card.level} className="mt-1" />
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">Top fix</p>
            <p className="text-base">{ready.card.topFixTitle}</p>
            <p className="mt-1 text-sm text-subtle">Expires in {daysLeft(ready.card)} days</p>

            <label className="mt-4 block text-sm text-muted" htmlFor="family-link">
              Your link
            </label>
            <input
              id="family-link"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 min-h-11 w-full rounded-control border border-edge bg-sunken px-3 font-mono text-xs text-fg"
            />
            <div className="mt-3 flex flex-wrap gap-3">
              {canShare && (
                <Button
                  size="sm"
                  onClick={() => share({ title: "My Scammer's View score", text: "Here is my security score. Open it to add me to our family board.", url })}
                >
                  <Share2 className="size-4" aria-hidden /> Share
                </Button>
              )}
              <Button size="sm" variant={canShare ? "secondary" : "primary"} onClick={() => copy(url)}>
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <p className="mt-3 text-sm text-subtle">You send it yourself. This app sends nothing.</p>
          </div>
        </div>
      )}
    </Card>
  );
}
