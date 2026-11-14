import { z } from "zod";
import { isExpired, type FamilyCard } from "./card";

/** What a device keeps about the family: signed cards (score and top fix only) and invited names. */
export interface StoredCard {
  token: string;
  card: FamilyCard;
}
export interface BoardState {
  cards: StoredCard[];
  invited: string[];
}

export const BOARD_KEY = "sv.family.board.v1";
export const EMPTY_BOARD: BoardState = { cards: [], invited: [] };

const CardSchema = z.object({
  id: z.string().max(32),
  firstName: z.string().max(100),
  score: z.number().min(0).max(100),
  level: z.enum(["safe", "warn", "danger"]),
  topFixTitle: z.string().max(240),
  chainsBroken: z.number(),
  chainsTotal: z.number(),
  issuedAt: z.number(),
  expiresAt: z.number(),
});
const BoardSchema = z.object({
  cards: z.array(z.object({ token: z.string().max(1200), card: CardSchema })).max(40),
  invited: z.array(z.string().max(40)).max(40),
});

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadBoard(storage: KV): BoardState {
  try {
    const raw = storage.getItem(BOARD_KEY);
    if (!raw) return EMPTY_BOARD;
    const parsed = BoardSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_BOARD;
  } catch {
    return EMPTY_BOARD;
  }
}

export function saveBoard(storage: KV, board: BoardState): void {
  try {
    storage.setItem(BOARD_KEY, JSON.stringify(board));
  } catch {
    /* storage full or blocked: the board just won't persist */
  }
}

export function clearBoard(storage: KV): void {
  try {
    storage.removeItem(BOARD_KEY);
  } catch {
    /* ignore */
  }
}

/** Add a card, or replace the same member's older one. An older card never replaces a newer one. */
export function upsertCard(cards: StoredCard[], entry: StoredCard): StoredCard[] {
  const existing = cards.find((c) => c.card.id === entry.card.id);
  if (existing && existing.card.issuedAt >= entry.card.issuedAt) return cards;
  const rest = cards.filter((c) => c.card.id !== entry.card.id);
  return [...rest, entry].sort((a, b) => a.card.firstName.localeCompare(b.card.firstName));
}

export function removeCard(cards: StoredCard[], id: string): StoredCard[] {
  return cards.filter((c) => c.card.id !== id);
}

/** Average of cards that have not expired. Null when there are none. */
export function familyAverage(cards: StoredCard[], now: number = Date.now()): number | null {
  const live = cards.filter((c) => !isExpired(c.card, now));
  if (!live.length) return null;
  return Math.round(live.reduce((n, c) => n + c.card.score, 0) / live.length);
}

const norm = (s: string) => s.trim().toLowerCase();

/** Invited names with no live card yet. */
export function pendingInvites(invited: string[], cards: StoredCard[], now: number = Date.now()): string[] {
  const have = new Set(cards.filter((c) => !isExpired(c.card, now)).map((c) => norm(c.card.firstName)));
  return invited.filter((n) => !have.has(norm(n)));
}

export function addInvite(invited: string[], name: string): string[] {
  const clean = name.replace(/[<>`\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
  if (!clean || invited.some((n) => norm(n) === norm(clean)) || invited.length >= 20) return invited;
  return [...invited, clean];
}

export function removeInvite(invited: string[], name: string): string[] {
  return invited.filter((n) => norm(n) !== norm(name));
}

/** Tokens in a URL fragment such as `#card=abc&card=def`. */
export function parseFragment(hash: string): string[] {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!body) return [];
  return new URLSearchParams(body)
    .getAll("card")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 1200 && /^[A-Za-z0-9_.-]+$/.test(t))
    .slice(0, 10);
}

export function buildShareUrl(origin: string, path: string, token: string): string {
  return `${origin}${path}#card=${token}`;
}
