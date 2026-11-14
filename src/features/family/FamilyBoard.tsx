"use client";

import { Check, Copy, Share2, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/design/Button";
import { Card, Divider } from "@/design/Card";
import { RiskBadge } from "@/design/Badge";
import { ScoreArc } from "@/design/ScoreArc";
import { daysLeft, isExpired, type FamilyCard } from "@/lib/family/card";
import {
  EMPTY_BOARD,
  addInvite,
  clearBoard,
  familyAverage,
  loadBoard,
  parseFragment,
  pendingInvites,
  removeCard,
  removeInvite,
  saveBoard,
  upsertCard,
  type BoardState,
} from "@/lib/family/board";
import { generateSafeWord } from "@/lib/family/safeword";
import { useShare } from "./useShare";

type VerifyResult = { ok: true; card: FamilyCard } | { ok: false; reason: "malformed" | "signature" | "expired" };

const REASON: Record<string, string> = {
  signature: "A link was changed or is not from this app. It was ignored.",
  malformed: "A link was not a valid card. It was ignored.",
  expired: "A card had expired. Ask them to share a new one.",
  unconfigured: "Cards cannot be checked right now.",
  network: "Could not check a card. Open the link again.",
};

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

/**
 * The family's cards on this device. Cards come from the URL fragment, are checked by the
 * server (signature and expiry), and live only in this browser's localStorage.
 */
export function FamilyBoard({ className }: { className?: string }) {
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const boardRef = useRef(board);

  const commit = useCallback((next: BoardState) => {
    boardRef.current = next;
    setBoard(next);
    saveBoard(window.localStorage, next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let current = loadBoard(window.localStorage);
      const tokens = parseFragment(window.location.hash);
      const problems: string[] = [];
      if (tokens.length) {
        try {
          const res = await fetch("/api/family/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tokens }),
          });
          const data = (await res.json().catch(() => null)) as { results?: VerifyResult[]; reason?: string } | null;
          if (data?.results) {
            data.results.forEach((r, i) => {
              if (r.ok) current = { ...current, cards: upsertCard(current.cards, { token: tokens[i], card: r.card }) };
              else problems.push(REASON[r.reason] ?? REASON.malformed);
            });
          } else {
            problems.push(REASON[data?.reason ?? "network"] ?? REASON.network);
          }
        } catch {
          problems.push(REASON.network);
        }
        if (cancelled) return;
        saveBoard(window.localStorage, current);
        // Keep the card out of the address bar once it is read, so a refresh or a copied URL does not repeat it.
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      if (cancelled) return;
      boardRef.current = current;
      setBoard(current);
      setNotices([...new Set(problems)]);
      setNow(Date.now());
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const average = familyAverage(board.cards, now);
  const pending = pendingInvites(board.invited, board.cards, now);
  const live = board.cards.filter((c) => !isExpired(c.card, now));

  return (
    <div className={className}>
      <section aria-labelledby="family-board-title" className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="family-board-title" className="sr-only">
            Family board
          </h2>
          {ready && board.cards.length + board.invited.length > 0 && (
            <ClearAll
              confirming={confirmClear}
              onAsk={() => setConfirmClear(true)}
              onCancel={() => setConfirmClear(false)}
              onConfirm={() => {
                clearBoard(window.localStorage);
                boardRef.current = EMPTY_BOARD;
                setBoard(EMPTY_BOARD);
                setConfirmClear(false);
              }}
            />
          )}
        </div>

        {notices.length > 0 && (
          <div role="status" className="grid gap-1 rounded-control border border-edge-strong px-4 py-3 text-sm">
            {notices.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        )}

        {!ready ? (
          <div className="sv-skeleton h-40 rounded-card" aria-hidden />
        ) : (
          <>
            <Card className="flex flex-wrap items-center gap-6">
              <ScoreArc score={average} size={120} label="average" numberClassName="font-display" />
              <dl className="grid flex-1 grid-cols-3 gap-6">
                <div>
                  <dt className="text-muted">Joined</dt>
                  <dd className="sv-num mt-1 text-4xl leading-none">{live.length}</dd>
                </div>
                <div>
                  <dt className="text-muted">Not joined yet</dt>
                  <dd className="sv-num mt-1 text-4xl leading-none">{pending.length}</dd>
                </div>
                <div>
                  <dt className="text-muted">Highest exposure</dt>
                  <dd className="sv-num mt-1 text-4xl leading-none">{live.length ? Math.max(...live.map((c) => c.card.score)) : "0"}</dd>
                </div>
              </dl>
            </Card>

            {board.cards.length === 0 ? (
              <Card className="text-muted">No cards yet. Each person makes theirs after their own scan, then sends you the link.</Card>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {board.cards.map((s) => (
                  <li key={s.card.id}>
                    <Tile
                      card={s.card}
                      now={now}
                      onRemove={() => commit({ ...boardRef.current, cards: removeCard(boardRef.current.cards, s.card.id) })}
                    />
                  </li>
                ))}
              </ul>
            )}

            <Invites
              pending={pending}
              onAdd={(name) => commit({ ...boardRef.current, invited: addInvite(boardRef.current.invited, name) })}
              onRemove={(name) => commit({ ...boardRef.current, invited: removeInvite(boardRef.current.invited, name) })}
            />
          </>
        )}
      </section>

      <SafeWord className="mt-8" />
    </div>
  );
}

function ClearAll({ confirming, onAsk, onCancel, onConfirm }: { confirming: boolean; onAsk: () => void; onCancel: () => void; onConfirm: () => void }) {
  return confirming ? (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted">Remove every card from this device?</span>
      <Button size="sm" variant="destructive" onClick={onConfirm}>
        Clear all
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  ) : (
    <Button size="sm" variant="ghost" onClick={onAsk}>
      <Trash2 className="size-4" aria-hidden /> Clear all
    </Button>
  );
}

function Tile({ card, now, onRemove }: { card: FamilyCard; now: number; onRemove: () => void }) {
  const expired = isExpired(card, now);
  return (
    <Card className={expired ? "opacity-60" : undefined} aria-label={`${card.firstName}, exposure ${card.score}`}>
      <div className="flex items-start gap-4">
        <ScoreArc score={card.score} size={88} label="" numberClassName="font-display" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-display text-lg leading-tight break-words">{card.firstName}</p>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${card.firstName}`}
              className="sv-press -mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-muted hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="mt-1">
            {expired ? (
              <span className="inline-flex rounded-chip border border-edge px-2 py-0.5 text-sm text-muted">Expired</span>
            ) : (
              <RiskBadge level={card.level} />
            )}
          </div>
        </div>
      </div>
      <Divider className="my-4" />
      {expired ? (
        <p className="text-sm text-muted">Ask {card.firstName} to share a new card.</p>
      ) : (
        <>
          <p className="text-sm text-muted">Top fix</p>
          <p className="mt-0.5 text-base">{card.topFixTitle || "None"}</p>
          {card.chainsTotal > 0 && (
            <p className="mt-2 text-sm text-muted">
              {card.chainsBroken} of {card.chainsTotal} attack paths closed
            </p>
          )}
        </>
      )}
      <p className="mt-2 text-sm text-subtle">
        {expired ? "Expired" : `${daysLeft(card, now)} days left`} · made {dateFmt.format(card.issuedAt)}
      </p>
    </Card>
  );
}

function Invites({ pending, onAdd, onRemove }: { pending: string[]; onAdd: (name: string) => void; onRemove: (name: string) => void }) {
  const [name, setName] = useState("");
  const { canShare, copied, copy, share } = useShare();
  const appUrl = () => `${window.location.origin}/`;
  const msg = { title: "Scammer's View", text: "Scan yourself with Scammer's View and add your card to our family board." };

  return (
    <Card aria-labelledby="family-invite-title">
      <h3 id="family-invite-title" className="sv-display text-lg">
        Not joined yet
      </h3>
      {pending.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {pending.map((n) => (
            <li key={n} className="inline-flex items-center gap-1 rounded-chip border border-edge py-0.5 pl-3 pr-1">
              {n}
              <button
                type="button"
                onClick={() => onRemove(n)}
                aria-label={`Remove ${n} from invites`}
                className="sv-press inline-flex size-9 items-center justify-center rounded-control text-muted hover:text-fg"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-4 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(name);
          setName("");
        }}
      >
        <label className="sr-only" htmlFor="invite-name">
          First name to invite
        </label>
        <input
          id="invite-name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          placeholder="First name, e.g. Mom"
          className="min-h-11 min-w-0 flex-1 rounded-control border border-edge bg-sunken px-3 text-base text-fg placeholder:text-subtle"
        />
        <Button size="sm" variant="secondary" type="submit" disabled={!name.trim()}>
          <UserPlus className="size-4" aria-hidden /> Add
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap gap-3">
        {canShare && (
          <Button size="sm" onClick={() => share({ ...msg, url: appUrl() })}>
            <Share2 className="size-4" aria-hidden /> Invite with the app link
          </Button>
        )}
        <Button size="sm" variant={canShare ? "secondary" : "primary"} onClick={() => copy(appUrl())}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copied" : "Copy app link"}
        </Button>
      </div>
    </Card>
  );
}

const STEPS = [
  "Tell everyone the phrase in person. Not by text, not by email.",
  "Do not save it in notes or a chat.",
  "A call says a relative is in trouble and needs money? Hang up. Call them back on the number you already have.",
  "Ask for the safe word. No word, no money. Voices can be cloned. Gift cards, crypto and wire transfers are scam payments.",
];

function SafeWord({ className }: { className?: string }) {
  const [word, setWord] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  return (
    <Card className={className} aria-labelledby="safe-word-title">
      <h2 id="safe-word-title" className="sv-display text-xl">
        Family safe word
      </h2>

      <div className="mt-4">
        {word && !hidden ? (
          <div>
            <p className="text-sm text-muted">Shown once. Say it out loud to your family.</p>
            <p data-testid="safe-word" className="mt-2 break-words font-display text-2xl tracking-tight sm:text-3xl">
              {word.replaceAll("-", " ")}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                size="sm"
                onClick={() => {
                  setHidden(true);
                  setWord(null);
                }}
              >
                <Check className="size-4" aria-hidden /> I have memorised it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setWord(generateSafeWord())}>
                New phrase
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                setWord(generateSafeWord());
                setHidden(false);
              }}
            >
              {hidden ? "Make a new safe word" : "Make a safe word"}
            </Button>
            {hidden && <span className="text-sm text-muted">Hidden. It is not stored anywhere.</span>}
          </div>
        )}
      </div>

      <Divider className="my-6" />
      <h3 className="text-base font-semibold">If a relative calls in trouble</h3>
      <ol className="mt-3 grid gap-3">
        {STEPS.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span aria-hidden className="sv-num inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-edge-strong text-sm">
              {i + 1}
            </span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
