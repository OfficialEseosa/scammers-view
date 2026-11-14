// Settings and helpers shared by the background worker, popup and side panel.

/** Change this to the deployed app's address before publishing. */
export const DEFAULT_APP_URL = "http://localhost:3000";
export const MAX_CHARS = 4000;

export async function getSettings() {
  const s = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL, gmail: false });
  return { appUrl: String(s.appUrl).replace(/\/+$/, ""), gmail: Boolean(s.gmail) };
}

/** Link to the full report in the app. The message rides in the #fragment, which is never sent to the server. */
export function reportUrl(appUrl, text) {
  const p = new URLSearchParams();
  p.set("text", text.slice(0, MAX_CHARS));
  return `${appUrl}/check#${p.toString()}`;
}

export const LEVEL = {
  high: "Several warning signs",
  some: "Some warning signs",
  low: "No obvious warning signs",
};
