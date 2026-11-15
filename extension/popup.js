import { getSettings } from "./shared.js";

const appUrl = document.getElementById("app-url");
const status = document.getElementById("status");

const settings = await getSettings();
appUrl.value = settings.appUrl;

const { id: windowId } = await chrome.windows.getCurrent();

function openSidePanel() {
  void chrome.sidePanel.open({ windowId }).then(() => window.close()).catch(() => {});
}

document.getElementById("open-panel").addEventListener("click", openSidePanel);
document.getElementById("open-cleanup-panel")?.addEventListener("click", openSidePanel);

function renderCleanup(live) {
  const box = document.getElementById("cleanup");
  const site = document.getElementById("cleanup-site");
  const text = document.getElementById("cleanup-text");
  const log = document.getElementById("cleanup-log");
  if (!box || !site || !text || !log) return;
  if (!live || (!live.running && !live.text)) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  site.textContent = live.site ? `Cleanup · ${live.site}` : "Cleanup agent";
  text.textContent = live.text || (live.running ? "Working…" : "");
  log.replaceChildren();
  for (const line of Array.isArray(live.log) ? live.log.slice(-8) : []) {
    const li = document.createElement("li");
    li.textContent = String(line);
    log.append(li);
  }
}

chrome.storage.session.get("cleanupLive").then(({ cleanupLive }) => renderCleanup(cleanupLive));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.cleanupLive) renderCleanup(changes.cleanupLive.newValue);
});

document.getElementById("app").addEventListener("submit", async (e) => {
  e.preventDefault();
  let url;
  try {
    url = new URL(appUrl.value.trim());
  } catch {
    status.textContent = "That isn't a valid address.";
    return;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!local && url.protocol !== "https:") {
    status.textContent = "Use an https:// address.";
    return;
  }
  if (!local && !(await chrome.permissions.request({ origins: [`${url.origin}/*`] }))) {
    status.textContent = "The extension needs permission to reach that address.";
    return;
  }
  await chrome.storage.sync.set({ appUrl: url.origin });
  const builtIn = url.origin === "http://localhost:3000" || url.origin === "http://127.0.0.1:3000";
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["sv-bridge"] }).catch(() => {});
    if (!builtIn) {
      await chrome.scripting.registerContentScripts([
        {
          id: "sv-bridge",
          matches: [`${url.origin}/*`],
          js: ["bridge.js"],
          runAt: "document_start",
          persistAcrossSessions: true,
        },
      ]);
    }
  } catch {
    status.textContent = `Saved checks for ${url.origin}, but the page bridge couldn't be registered. Reload the extension and try again.`;
    return;
  }
  status.textContent = `Saved. Reload any open app tab so the extension can connect (${url.origin}).`;
});
