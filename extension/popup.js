import { getSettings } from "./shared.js";

const GMAIL_ORIGIN = "https://mail.google.com/*";
const gmail = document.getElementById("gmail");
const appUrl = document.getElementById("app-url");
const status = document.getElementById("status");

const settings = await getSettings();
gmail.checked = settings.gmail && (await chrome.permissions.contains({ origins: [GMAIL_ORIGIN] }));
appUrl.value = settings.appUrl;

// Looked up ahead of time: sidePanel.open must run directly inside the click.
const { id: windowId } = await chrome.windows.getCurrent();
document.getElementById("open-panel").addEventListener("click", () => {
  void chrome.sidePanel.open({ windowId }).then(() => window.close());
});

gmail.addEventListener("change", async () => {
  if (gmail.checked) {
    const ok = await chrome.permissions.request({ origins: [GMAIL_ORIGIN] });
    gmail.checked = ok;
    await chrome.storage.sync.set({ gmail: ok });
    status.textContent = ok ? "Gmail warnings are on. Reload Gmail to start." : "Gmail access wasn't granted.";
  } else {
    await chrome.storage.sync.set({ gmail: false });
    await chrome.permissions.remove({ origins: [GMAIL_ORIGIN] });
    status.textContent = "Gmail warnings are off.";
  }
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
  status.textContent = `Saved. Checks go to ${url.origin}.`;
});
