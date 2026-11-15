"use client";

import type { AgentAction, CleanupTask, PageSnapshot } from "@/lib/cleanup/types";

/*
 * "Hands" carry out the agent's steps. Same interface for both modes:
 * - extension: a real tab in the student's Chrome (they watch; robot checks are solved in place);
 * - server: an invisible browser on our server (screenshots stream back to the page).
 */

export type AskButton = { id: string; label: string; primary?: boolean };

export interface Hands {
  kind: "extension" | "server";
  open(task: CleanupTask, listingUrl?: string): Promise<void>;
  /** `away` (a host name) means the tab is on another website right now, e.g. a sign-in page. */
  snapshot(): Promise<{ page: PageSnapshot; image?: string } | { away: string }>;
  act(step: AgentAction): Promise<{ ok: boolean; error?: string }>;
  highlight(index?: number): Promise<void>;
  /** Live step text in the working tab (extension) or a no-op (server). */
  status(text: string, detail?: string): Promise<void>;
  /** Asks the student; resolves with the id of the button they pressed. */
  ask(text: string, buttons: AskButton[]): Promise<string>;
  /** Answers the question currently shown in the working tab from the app page (extension only). */
  answer?(choice: string): Promise<void>;
  visit(url: string): Promise<boolean>;
  finish(): Promise<void>;
}

/* ------------------------------- extension bridge ------------------------------- */

let seq = 0;

export function callExtension<T = unknown>(type: string, payload: unknown, timeoutMs = 15 * 60 * 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `svx-${Date.now()}-${++seq}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("The extension didn't answer."));
    }, timeoutMs);
    function onMsg(e: MessageEvent) {
      if (e.source !== window || e.data?.svx !== "res" || e.data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (e.data.ok) resolve(e.data.data as T);
      else reject(new Error(e.data.error || "The extension couldn't do that."));
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ svx: "req", id, type, payload }, window.location.origin);
  });
}

/** Resolves with the extension's version, or null when the bridge isn't in this tab. */
export function detectExtension(waitMs = 900): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      resolve(null);
    }, waitMs);
    function onMsg(e: MessageEvent) {
      if (e.source !== window || e.data?.svx !== "hello") return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      resolve(String(e.data.version ?? "1"));
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ svx: "ping" }, window.location.origin);
  });
}

/**
 * Keeps listening for the content-script bridge (and pings once).
 * Useful when the extension was installed/reloaded after this tab opened — a page
 * reload injects the bridge; until then hello never arrives.
 */
export function onExtensionHello(cb: (version: string) => void): () => void {
  function onMsg(e: MessageEvent) {
    if (e.source !== window || e.data?.svx !== "hello") return;
    cb(String(e.data.version ?? "1"));
  }
  window.addEventListener("message", onMsg);
  window.postMessage({ svx: "ping" }, window.location.origin);
  return () => window.removeEventListener("message", onMsg);
}

export function extensionHands(): Hands {
  let tabId: number | null = null;
  const need = () => {
    if (tabId === null) throw new Error("No tab open.");
    return tabId;
  };
  return {
    kind: "extension",
    async open(task) {
      const res = await callExtension<{ tabId: number }>("open", { url: task.startUrl, hosts: task.hosts }, 60_000);
      tabId = res.tabId;
      await callExtension("status", { tabId, text: `Opened ${task.site}. Working…` }, 5_000).catch(() => {});
    },
    async snapshot() {
      const res = await callExtension<{ page?: PageSnapshot; away?: string }>("snapshot", { tabId: need() }, 60_000);
      if (res.away) return { away: res.away };
      if (!res.page) throw new Error("I couldn't read the page. Press Try again.");
      return { page: res.page };
    },
    async act(step) {
      try {
        await callExtension("act", { tabId: need(), step }, 60_000);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "That step didn't work." };
      }
    },
    async highlight(index) {
      await callExtension("highlight", { tabId: need(), index: index ?? null }, 20_000).catch(() => {});
    },
    async status(text, detail) {
      if (tabId === null) return;
      await callExtension("status", { tabId, text, detail: detail ?? null }, 5_000).catch(() => {});
    },
    async ask(text, buttons) {
      // The extension answers within a few minutes even when nobody pressed a button
      // (Chrome ends longer waits), so keep asking until there is a choice.
      for (let again = false; ; again = true) {
        const res = await callExtension<{ choice?: string; again?: boolean }>("ask", { tabId: need(), text, buttons, again }, 6 * 60 * 1000);
        if (typeof res?.choice === "string") return res.choice;
        if (!res?.again) return "stop";
      }
    },
    async answer(choice) {
      if (tabId === null) return;
      await callExtension("answer", { tabId, choice }, 10_000).catch(() => {});
    },
    async visit(url) {
      return callExtension("visit", { tabId: need(), url }, 60_000).then(
        () => true,
        () => false,
      );
    },
    async finish() {
      if (tabId !== null) {
        await callExtension("status", { tabId, text: "Finished on this site." }, 5_000).catch(() => {});
        // Do not steal focus back to the app — stay on WayUp / the work tab.
        await callExtension("finish", { tabId, backToApp: false }, 20_000).catch(() => {});
      }
      tabId = null;
    },
  };
}

/* ------------------------------- server browser ------------------------------- */

async function browserOp<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/cleanup/browser", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "The server browser didn't respond.");
  return data;
}

export async function serverBrowserAvailable(): Promise<boolean> {
  try {
    return (await browserOp<{ available: boolean }>({ op: "status" })).available;
  } catch {
    return false;
  }
}

/** `askUi` shows the question on the app page (there is no tab to show it in). */
export function serverHands(askUi: (text: string, buttons: AskButton[]) => Promise<string>): Hands {
  let id: string | null = null;
  const need = () => {
    if (!id) throw new Error("No browser session.");
    return id;
  };
  return {
    kind: "server",
    async open(task, listingUrl) {
      id = (await browserOp<{ id: string }>({ op: "open", taskId: task.id, listingUrl })).id;
    },
    snapshot: () => browserOp<{ page: PageSnapshot; image: string }>({ op: "snapshot", id: need() }),
    act: (step) => browserOp<{ ok: boolean; error?: string }>({ op: "act", id: need(), step }).catch((e: Error) => ({ ok: false, error: e.message })),
    async highlight() {},
    async status() {},
    ask: askUi,
    visit: (url) => browserOp<{ ok: boolean }>({ op: "visit", id: need(), url }).then((r) => r.ok, () => false),
    async finish() {
      if (id) await browserOp({ op: "close", id }).catch(() => {});
      id = null;
    },
  };
}
