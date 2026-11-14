import { MAX_CHARS, getSettings } from "./shared.js";

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
