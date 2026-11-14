import { analyzeMessage } from "@/lib/check/analyze";
import { MAX_CHECK_CHARS } from "@/lib/check/shared";
import { getMessage, listMessageIds } from "./api";
import { toEmailText, type EmailText } from "./message";
import { revokeToken } from "./oauth";
import { failInboxCheck, finishInboxCheck, type EmailVerdict, type InboxResults } from "./store";

export const PER_FOLDER = 25;
const PARALLEL = 6;

const LEVEL_ORDER = { high: 0, some: 1, low: 2 } as const;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function verdict(email: EmailText, folder: EmailVerdict["folder"]): Promise<EmailVerdict> {
  const text = `${email.subject}\n${email.body}`.slice(0, MAX_CHECK_CHARS);
  const r = await analyzeMessage(text, 1);
  const best = r.matches[0];
  return {
    id: email.id,
    folder,
    from: email.from,
    subject: email.subject,
    date: email.date,
    level: r.level,
    signs: [...new Set(r.spans.map((s) => s.why))],
    match: best && r.level !== "low" ? { name: best.name, action: best.action, report: best.report } : undefined,
    reported: r.reported,
  };
}

async function checkFolder(token: string, folder: "INBOX" | "SPAM", fetchImpl: typeof fetch): Promise<EmailVerdict[]> {
  const ids = await listMessageIds(token, folder, PER_FOLDER, fetchImpl);
  const verdicts = await mapLimit(ids, PARALLEL, async (id) => {
    try {
      const email = toEmailText(await getMessage(token, id, fetchImpl), MAX_CHECK_CHARS);
      return await verdict(email, folder === "INBOX" ? "inbox" : "spam");
    } catch {
      return null;
    }
  });
  return verdicts.filter((v): v is EmailVerdict => v !== null);
}

/**
 * Reads up to 25 inbox and 25 spam emails once, checks each, then revokes the token. Email
 * text lives only in local variables of this function; the store gets the verdicts alone.
 */
export async function runInboxCheck(token: string, owner: string, run: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  let inbox: EmailVerdict[] = [];
  let spam: EmailVerdict[] = [];
  let failed = false;
  try {
    [inbox, spam] = await Promise.all([checkFolder(token, "INBOX", fetchImpl), checkFolder(token, "SPAM", fetchImpl)]);
  } catch {
    failed = true;
  }
  const revoked = await revokeToken(token, fetchImpl);
  if (failed) {
    failInboxCheck(owner, run, "Couldn't read your Gmail. Try again in a minute.");
    return;
  }
  inbox.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const results: InboxResults = { inbox, spam, revoked, checkedAt: Date.now() };
  finishInboxCheck(owner, run, results);
}
