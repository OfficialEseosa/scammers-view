import { MAX_CHARS, agentAllowed, getSettings, isTransientUrl } from "./shared.js";

async function setCleanupLive(patch) {
  const { cleanupLive = {} } = await chrome.storage.session.get("cleanupLive");
  await chrome.storage.session.set({
    cleanupLive: {
      site: "",
      text: "",
      log: [],
      ...cleanupLive,
      ...patch,
      at: Date.now(),
    },
  });
}

async function openCleanupPanel(tabId, windowId) {
  try {
    if (tabId !== undefined) await chrome.sidePanel.open({ tabId });
    else if (windowId !== undefined) await chrome.sidePanel.open({ windowId });
  } catch {
    /* needs a user gesture in some Chrome builds — ignore if blocked */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "check-selection", title: "Check with Scammer's View", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "check-link", title: "Check this link with Scammer's View", contexts: ["link"] });
  });
  // The Gmail banner was removed: drop its script and access if an earlier version turned them on.
  void chrome.scripting.unregisterContentScripts({ ids: ["gmail"] }).catch(() => {});
  void chrome.permissions.remove({ origins: ["https://mail.google.com/*"] }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const text = info.menuItemId === "check-link" ? [info.selectionText, info.linkUrl].filter(Boolean).join("\n") : info.selectionText ?? "";
  // Open the panel first: it must happen inside the click, before any await.
  if (tab?.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id });
  void checkAndShow(text);
});

/** Runs a check and puts the result where the side panel reads it. */
async function checkAndShow(text) {
  const body = text.trim().slice(0, MAX_CHARS);
  if (!body) return;
  await chrome.storage.session.set({ last: { status: "loading", text: body } });
  const result = await runCheck(body);
  await chrome.storage.session.set({ last: { ...result, text: body } });
  return result;
}

async function runCheck(text) {
  const { appUrl } = await getSettings();
  try {
    const res = await fetch(`${appUrl}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.status === 429) return { status: "error", message: "That's a lot of checks. Try again in a little while." };
    if (!res.ok) return { status: "error", message: "The check didn't run." };
    return { status: "ready", data: await res.json() };
  } catch {
    return { status: "error", message: `Couldn't reach ${appUrl}. Check the app address in the extension's settings.` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === "agent") {
    // Only the app page's bridge may drive the cleanup agent.
    void (async () => {
      const { appUrl } = await getSettings();
      const from = sender.tab?.url ? new URL(sender.tab.url).origin : "";
      const ok = sender.id === chrome.runtime.id && [new URL(appUrl).origin, "http://localhost:3000", "http://127.0.0.1:3000"].includes(from);
      if (!ok) return { ok: false, error: "Not allowed" };
      return agentOp(msg.op, msg.payload ?? {}, sender.tab?.id);
    })()
      .then(reply)
      .catch((e) => reply({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
  if (msg?.type === "check-in-panel") {
    void checkAndShow(String(msg.text ?? ""));
  }
  return false;
});

/* ------------------------- cleanup agent: hands in your Chrome ------------------------- */

// Tabs the agent opened, with the hosts each one may stay on. Lost if the worker restarts,
// which simply ends the run (the app page then offers to try again).
const agentTabs = new Map();
const ASK_SLICE_MS = 4 * 60 * 1000;

function awayHost(url) {
  try {
    return new URL(url).hostname || "another page";
  } catch {
    return "another page";
  }
}

function waitForTab(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(t);
      resolve();
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    const t = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && done(), done);
  });
}

async function inTab(tabId, func, args = []) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["agent-page.js"] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

const TAB_GONE = "The agent's tab was closed or the extension restarted, so I stopped. Press Try again to start over.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Where the agent's tab is: on the task's site ({ entry }) or on another website
 * ({ entry, away: host }), e.g. a sign-in page. Blank pages while loading are waited out.
 */
async function tabState(tabId) {
  const entry = agentTabs.get(tabId);
  if (!entry) throw new Error(TAB_GONE);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error(TAB_GONE);
    const url = tab.url ?? "";
    if (agentAllowed(url, entry.hosts)) return { entry };
    if (url && !isTransientUrl(url)) return { entry, away: awayHost(url) };
    await sleep(250);
  }
  throw new Error("That page didn't finish loading. Check the tab, then press Try again.");
}

/** The tab's entry, or an error when the tab is not on the task's site. */
async function agentTab(tabId) {
  const { entry, away } = await tabState(tabId);
  if (away) throw new Error(`The tab is on ${away}, not ${entry.hosts[0]}. Go back to ${entry.hosts[0]} in that tab.`);
  return entry;
}

async function focusAgentTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function agentOp(op, p, appTabId) {
  switch (op) {
    case "beginCleanup": {
      // First call from the Start click — best chance to open the side panel with a user gesture.
      const site = String(p.site ?? "Cleanup");
      await setCleanupLive({
        site,
        text: "Starting… Open this popup anytime to watch live steps.",
        log: [`Started cleanup on ${site}`],
        running: true,
      });
      await openCleanupPanel(appTabId, undefined);
      // Prefer side panel for the rest of the run when Chrome allows it.
      try {
        await chrome.sidePanel.setOptions({ enabled: true, path: "sidepanel.html" });
      } catch {
        /* ignore */
      }
      return { ok: true, data: { version: chrome.runtime.getManifest().version } };
    }
    case "canOpen": {
      const hosts = Array.isArray(p.hosts) ? p.hosts.map(String) : [];
      if (!p.url || !agentAllowed(p.url, hosts)) {
        return {
          ok: false,
          error: "That site isn't on this extension yet. On chrome://extensions, click Reload on Scammer's View (need v0.2.1+ for WayUp/Devpost), then refresh the app tab.",
        };
      }
      return { ok: true, data: { version: chrome.runtime.getManifest().version } };
    }
    case "open": {
      const hosts = Array.isArray(p.hosts) ? p.hosts.map(String) : [];
      if (!p.url || !agentAllowed(p.url, hosts)) {
        return {
          ok: false,
          error: "That site isn't on this extension yet. On chrome://extensions, click Reload on Scammer's View (need v0.2.1+ for WayUp/Devpost), then refresh the app tab.",
        };
      }
      let tab;
      try {
        tab = await chrome.tabs.create({ url: p.url, active: true });
      } catch (e) {
        // Optional catch-all permission (e.g. enterprise blocks until granted).
        const origin = `${new URL(p.url).origin}/*`;
        const wild = hosts[0] ? `https://*.${hosts[0]}/*` : origin;
        const granted = await chrome.permissions.request({ origins: [origin, wild] }).catch(() => false);
        if (!granted) {
          return {
            ok: false,
            error: e?.message || "Chrome blocked opening that site. Reload the extension, then try again.",
          };
        }
        tab = await chrome.tabs.create({ url: p.url, active: true });
      }
      if (!tab?.id) return { ok: false, error: "Chrome didn't open a tab." };
      agentTabs.set(tab.id, { hosts, appTabId });
      await focusAgentTab(tab.id);
      await openCleanupPanel(tab.id, tab.windowId);
      await setCleanupLive({ site: hosts[0] || "site", text: `Opened ${hosts[0] || "site"}. Waiting for the page…`, running: true });
      // Wait until the tab has a real URL (not about:blank). A redirect to another website
      // (a sign-in page) is not an error here: the next snapshot reports it and the run waits.
      try {
        await tabState(tab.id);
      } catch (e) {
        return { ok: false, error: e?.message || "Couldn't open that site." };
      }
      return { ok: true, data: { tabId: tab.id } };
    }
    case "snapshot": {
      if (!agentTabs.has(p.tabId)) throw new Error(TAB_GONE);
      await waitForTab(p.tabId, 10000);
      await sleep(600);
      const { away } = await tabState(p.tabId);
      if (away) {
        await setCleanupLive({ text: `Waiting for you: the tab is on ${away}.`, running: true });
        return { ok: true, data: { away } };
      }
      try {
        const page = await inTab(p.tabId, () => window.__svxAgent.snapshot());
        return { ok: true, data: { page } };
      } catch (e) {
        return {
          ok: false,
          error:
            e?.message?.includes("Cannot access") || e?.message?.includes("host permission")
              ? "Chrome blocked reading that page. Reload Scammer's View on chrome://extensions so WayUp/Devpost are allowed, then try again."
              : e?.message || "Couldn't read the page.",
        };
      }
    }
    case "act": {
      const entry = await agentTab(p.tabId);
      const step = p.step ?? {};
      if (step.action === "goto") {
        if (!agentAllowed(step.url, entry.hosts)) return { ok: false, error: "Refused: another website." };
        await chrome.tabs.update(p.tabId, { url: step.url });
        await waitForTab(p.tabId);
        return { ok: true };
      }
      const res = await inTab(p.tabId, (s) => window.__svxAgent.act(s), [step]);
      await sleep(400);
      await waitForTab(p.tabId, 8000);
      return res?.ok ? { ok: true } : { ok: false, error: res?.error ?? "That step didn't work." };
    }
    case "highlight": {
      await agentTab(p.tabId);
      await inTab(p.tabId, (i) => window.__svxAgent.highlight(i), [p.index ?? null]);
      return { ok: true };
    }
    case "status": {
      await agentTab(p.tabId);
      await focusAgentTab(p.tabId);
      const text = String(p.text ?? "");
      const detail = p.detail ? String(p.detail) : null;
      const { cleanupLive = {} } = await chrome.storage.session.get("cleanupLive");
      const log = Array.isArray(cleanupLive.log) ? cleanupLive.log.slice() : [];
      const line = (detail || text).slice(0, 160);
      if (line && log[log.length - 1] !== line) {
        log.push(line);
        while (log.length > 10) log.shift();
      }
      await setCleanupLive({ text: text.slice(0, 240), log, running: true });
      await inTab(
        p.tabId,
        (t, d, lines) => window.__svxAgent.status(t, d, lines),
        [text, detail, log],
      ).catch(() => {});
      return { ok: true };
    }
    case "ask": {
      const entry = agentTabs.get(p.tabId);
      if (!entry) throw new Error(TAB_GONE);
      const text = String(p.text ?? "");
      const buttons = Array.isArray(p.buttons) ? p.buttons.slice(0, 3) : [{ id: "ok", label: "Okay", primary: true }];
      if (entry.early) {
        // Answered from the app page just before this question went up (Stop).
        const choice = entry.early;
        entry.early = null;
        return { ok: true, data: { choice } };
      }
      if (!p.again) {
        await focusAgentTab(p.tabId);
        await setCleanupLive({ text, running: true });
      }
      // The app page can answer too (its own buttons, or Stop).
      const answered = new Promise((resolve) => {
        entry.answer = resolve;
      });
      // Chrome ends a worker event after five minutes, so answer "again" before that and let the app re-ask.
      const until = Date.now() + ASK_SLICE_MS;
      const sliceOver = sleep(ASK_SLICE_MS).then(() => undefined);
      let quickFails = 0;
      try {
        while (Date.now() < until) {
          const tab = await chrome.tabs.get(p.tabId).catch(() => null);
          if (!tab) throw new Error(TAB_GONE);
          let choice;
          if (agentAllowed(tab.url ?? "", entry.hosts)) {
            // The bar lives in the page. If the page reloads or moves on while the question is up
            // (a robot check, a sign-in), the bar is lost: show it again instead of guessing an answer.
            const shownAt = Date.now();
            const shown = inTab(p.tabId, (t, b) => window.__svxAgent.ask(t, b), [text, buttons]).then(
              (c) => (typeof c === "string" ? c : null),
              () => null,
            );
            choice = await Promise.race([shown, answered, sliceOver]);
            if (choice === null) quickFails = Date.now() - shownAt < 1500 ? quickFails + 1 : 0;
            if (quickFails >= 20) throw new Error("I couldn't show my question on that page. Reload the tab, then press Try again.");
          } else {
            // On another website (signing in): nothing can be shown there. Wait for the tab to come back.
            choice = await Promise.race([sleep(700).then(() => null), answered, sliceOver]);
          }
          if (typeof choice === "string") return { ok: true, data: { choice } };
          if (choice === undefined) break;
          await sleep(500);
        }
        return { ok: true, data: { again: true } };
      } finally {
        entry.answer = null;
      }
    }
    case "answer": {
      const entry = agentTabs.get(p.tabId);
      const choice = String(p.choice ?? "stop");
      await inTab(p.tabId, (c) => window.__svxAgent.answer?.(c), [choice]).catch(() => {});
      if (entry?.answer) entry.answer(choice);
      else if (entry && choice === "stop") entry.early = choice;
      return { ok: true };
    }
    case "visit": {
      const entry = await agentTab(p.tabId);
      if (!agentAllowed(p.url, entry.hosts)) return { ok: false, error: "Refused: another website." };
      await chrome.tabs.update(p.tabId, { url: p.url, active: true });
      await waitForTab(p.tabId);
      return { ok: true };
    }
    case "finish": {
      const entry = agentTabs.get(p.tabId);
      if (entry) {
        await inTab(p.tabId, () => window.__svxAgent.clearUi()).catch(() => {});
        agentTabs.delete(p.tabId);
        // Stay on the site tab by default so the student can keep working / see what happened.
        // Only jump back when the app explicitly asks (e.g. Close after success).
        if (p.backToApp && entry.appTabId !== undefined) {
          await chrome.tabs.update(entry.appTabId, { active: true }).catch(() => {});
        } else {
          await focusAgentTab(p.tabId).catch(() => {});
        }
      }
      await setCleanupLive({ running: false, text: p.backToApp ? "Closed." : "Stopped — stay on this tab or press Try again in the app." });
      return { ok: true };
    }
    case "record": {
      // Browser-only cleanup record: the extension keeps the dates so it can remind you monthly.
      const due = Array.isArray(p.items) ? p.items.slice(0, 50).map((i) => ({ site: String(i.site).slice(0, 60), nextCheck: Number(i.nextCheck) || 0 })) : [];
      await chrome.storage.local.set({ cleanupRecheck: due });
      await chrome.alarms.create("sv-recheck", { periodInMinutes: 24 * 60, delayInMinutes: 1 });
      return { ok: true };
    }
    default:
      return { ok: false, error: "Unknown step" };
  }
}

chrome.tabs.onRemoved.addListener((tabId) => agentTabs.delete(tabId));

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "sv-recheck") return;
  const { cleanupRecheck = [], lastNotified = 0 } = await chrome.storage.local.get(["cleanupRecheck", "lastNotified"]);
  const now = Date.now();
  const due = cleanupRecheck.filter((i) => i.nextCheck && i.nextCheck <= now);
  if (!due.length || now - lastNotified < 6 * 24 * 60 * 60 * 1000) return;
  await chrome.storage.local.set({ lastNotified: now });
  chrome.notifications.create("sv-recheck", {
    type: "basic",
    iconUrl: "icons/128.png",
    title: "Time for your monthly cleanup check",
    message: `${due.map((d) => d.site).slice(0, 3).join(", ")}${due.length > 3 ? " and more" : ""} may have listed you again. Open Scammer's View to re-check.`,
  });
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (id !== "sv-recheck") return;
  const { appUrl } = await getSettings();
  await chrome.tabs.create({ url: `${appUrl}/scan` });
});
