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

const GMAIL_SCRIPT = "gmail";
const GMAIL_ORIGIN = "https://mail.google.com/*";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "check-selection", title: "Check with Scammer's View", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "check-link", title: "Check this link with Scammer's View", contexts: ["link"] });
  });
  void syncGmail();
});
chrome.runtime.onStartup.addListener(() => void syncGmail());

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
  if (msg?.type === "check") {
    void checkAndShow(String(msg.text ?? "")).then(reply);
    return true;
  }
  if (msg?.type === "open-panel" && sender.tab?.id !== undefined) {
    void chrome.sidePanel.open({ tabId: sender.tab.id });
  }
  if (msg?.type === "check-in-panel") {
    void checkAndShow(String(msg.text ?? ""));
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "gmail" in changes) void syncGmail();
});

/* ------------------------- cleanup agent: hands in your Chrome ------------------------- */

// Tabs the agent opened, with the hosts each one may stay on. Lost if the worker restarts,
// which simply ends the run (the app page then offers to try again).
const agentTabs = new Map();

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

async function agentTab(tabId) {
  const entry = agentTabs.get(tabId);
  if (!entry) throw new Error("That tab is no longer under the agent's control.");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? "";
    if (agentAllowed(url, entry.hosts)) return entry;
    if (url && !isTransientUrl(url)) {
      const host = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url.slice(0, 40);
        }
      })();
      throw new Error(
        `The tab went to ${host}, outside ${entry.hosts.join(", ")}. Sign in there if needed, open your ${entry.hosts[0]} page again, then press Try again.`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("That page didn't finish loading on the allowed site. Stay on the tab and press Try again.");
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
      // Wait until we're on an allowed URL (not about:blank), then stay on this tab.
      try {
        await agentTab(tab.id);
      } catch (e) {
        return { ok: false, error: e?.message || "Couldn't stay on that site." };
      }
      return { ok: true, data: { tabId: tab.id } };
    }
    case "snapshot": {
      await agentTab(p.tabId);
      await waitForTab(p.tabId, 10000);
      await new Promise((r) => setTimeout(r, 600));
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
      await new Promise((r) => setTimeout(r, 400));
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
      await agentTab(p.tabId);
      await focusAgentTab(p.tabId);
      await setCleanupLive({ text: String(p.text ?? ""), running: true });
      const buttons = Array.isArray(p.buttons) ? p.buttons.slice(0, 3) : [{ id: "ok", label: "Okay", primary: true }];
      const choice = await inTab(p.tabId, (text, b) => window.__svxAgent.ask(text, b), [String(p.text ?? ""), buttons]);
      return { ok: true, data: { choice } };
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

/** The Gmail banner runs only after the student turns it on and grants access to mail.google.com. */
async function syncGmail() {
  const { gmail } = await getSettings();
  const granted = await chrome.permissions.contains({ origins: [GMAIL_ORIGIN] });
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [GMAIL_SCRIPT] })).length > 0;
  if (gmail && granted && !registered) {
    await chrome.scripting.registerContentScripts([
      { id: GMAIL_SCRIPT, matches: [GMAIL_ORIGIN], js: ["gmail.js"], css: ["gmail.css"], runAt: "document_idle" },
    ]);
  } else if ((!gmail || !granted) && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [GMAIL_SCRIPT] });
  }
}
