"use client";

import type { AgentAction, CleanupTask, Details } from "@/lib/cleanup/types";
import type { Hands } from "./hands";

export type RunOutcome = "done" | "not_found" | "needs_user" | "stopped" | "failed";

export type RunEvent =
  | { type: "say"; text: string }
  | { type: "image"; src: string }
  | { type: "waiting"; text: string }
  | { type: "log"; text: string; ok: boolean };

const MAX_STEPS = 30;
/** The step route rejects longer history lines. */
const HISTORY_MAX = 300;
const CONTINUE = "I did it, continue";

function describe(a: AgentAction): string {
  if (a.action === "type") return `Typed an approved detail into field ${a.index}`;
  if (a.action === "select") return `Chose "${a.text}" in field ${a.index}`;
  if (a.action === "goto") return `Opened ${a.url}`;
  return `${a.action} ${a.index ?? ""}: ${a.say}`;
}

async function askStep(details: Details, task: CleanupTask, page: unknown, history: string[], signal: AbortSignal): Promise<AgentAction> {
  const res = await fetch("/api/cleanup/step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: task.id, details, page, history }),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { action?: AgentAction; error?: string };
  if (!res.ok || !data.action) return { action: "needs_user", say: data.error || "I couldn't work out the next step.", submits: false };
  return data.action;
}

/**
 * Runs one site. Broker removals ask before anything that submits; the account co-pilot
 * ("copilot") asks before every single click. Robot checks and anything unclear go to the student.
 */
export async function runTask(opts: {
  task: CleanupTask;
  details: Details;
  hands: Hands;
  copilot: boolean;
  signal: AbortSignal;
  onEvent: (e: RunEvent) => void;
}): Promise<{ outcome: RunOutcome; say: string }> {
  const { task, details, hands, copilot, signal, onEvent } = opts;
  const history: string[] = [];
  const remember = (line: string) => history.push(line.slice(0, HISTORY_MAX));
  let last = "";
  const pushStatus = async (text: string, detail?: string) => {
    onEvent({ type: "say", text });
    await hands.status(text, detail).catch(() => {});
  };
  try {
    await pushStatus(`Opening ${task.site} in a new Chrome tab…`);
    await hands.open(task, details.listingUrl);
    if (signal.aborted) return { outcome: "stopped", say: "Stopped." };
    await pushStatus(`Opened ${task.site}. Reading the page…`);
    for (let i = 0; i < MAX_STEPS; i++) {
      if (signal.aborted) return { outcome: "stopped", say: "Stopped." };
      const snap = await hands.snapshot();
      if ("away" in snap) {
        // Sign-in pages often live on another address. Wait for the student instead of giving up.
        const text = `The tab is on ${snap.away}, not ${task.site}. Finish there (for example signing in), go back to ${task.site} in that tab, then press "${CONTINUE}".`;
        onEvent({ type: "waiting", text });
        const choice = await hands.ask(text, [
          { id: "continue", label: CONTINUE, primary: true },
          { id: "stop", label: "Stop this site" },
        ]);
        if (signal.aborted) return { outcome: "stopped", say: "Stopped." };
        if (choice !== "continue") return { outcome: "needs_user", say: text };
        remember(`The tab left ${task.site} for ${snap.away}; the student brought it back.`);
        continue;
      }
      if (snap.image) onEvent({ type: "image", src: snap.image });
      await pushStatus(`Deciding the next step on ${task.site}…`);
      const a = await askStep(details, task, snap.page, history, signal);
      last = a.say;
      await pushStatus(a.say);

      if (a.action === "done" || a.action === "not_found") {
        await pushStatus(a.say, a.say);
        return { outcome: a.action, say: a.say };
      }
      if (a.action === "fail") {
        await pushStatus(a.say, a.say);
        return { outcome: "failed", say: a.say };
      }
      if (a.action === "needs_user") {
        onEvent({ type: "waiting", text: a.say });
        await hands.status(`Waiting for you: ${a.say}`).catch(() => {});
        const choice = await hands.ask(a.say, [
          { id: "continue", label: CONTINUE, primary: true },
          { id: "stop", label: "Stop this site" },
        ]);
        if (signal.aborted) return { outcome: "stopped", say: "Stopped." };
        if (choice !== "continue") return { outcome: "needs_user", say: a.say };
        remember(`The student handled this themselves: ${a.say}`);
        continue;
      }

      if (copilot || a.submits) {
        await hands.highlight(a.index);
        onEvent({ type: "waiting", text: a.say });
        await hands.status(`Waiting for Do it: ${a.say}`, a.say).catch(() => {});
        const choice = await hands.ask(`${a.say} Okay?`, [
          { id: "ok", label: copilot ? "Do it" : "Okay", primary: true },
          { id: "skip", label: "Skip" },
          { id: "stop", label: "Stop" },
        ]);
        await hands.highlight(undefined);
        if (signal.aborted) return { outcome: "stopped", say: "Stopped." };
        if (choice === "skip") {
          remember(`The student said no to: ${a.say}`);
          await hands.status("Skipped that step.", `Skipped: ${a.say}`).catch(() => {});
          continue;
        }
        // Only an explicit yes goes ahead. No answer (the page changed under the question) counts as stop.
        if (choice !== "ok") return { outcome: "stopped", say: "You stopped it." };
      }

      await pushStatus(`Doing: ${a.say}`, a.say);
      const r = await hands.act(a);
      remember(`${describe(a).slice(0, 220)} -> ${r.ok ? "ok" : `failed (${r.error})`}`);
      onEvent({ type: "log", text: a.say, ok: r.ok });
      await hands.status(r.ok ? `Done: ${a.say}` : `Failed: ${a.say}`, r.ok ? a.say : `Failed: ${a.say}`).catch(() => {});
    }
    return { outcome: "needs_user", say: "This took too many steps. Please finish it yourself." };
  } catch (e) {
    if (signal.aborted) return { outcome: "stopped", say: "Stopped." };
    return { outcome: "failed", say: e instanceof Error ? e.message : last || "Something went wrong." };
  }
}
