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

/** Sites the cleanup agent may open and work in (must match host_permissions in manifest.json). */
export const AGENT_HOSTS = [
  "spokeo.com",
  "whitepages.com",
  "beenverified.com",
  "radaris.com",
  "truepeoplesearch.com",
  "fastpeoplesearch.com",
  "instagram.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "github.com",
  "wayup.com",
  "devpost.com",
];

export function agentAllowed(url, hosts = AGENT_HOSTS) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return hosts.some((d) => AGENT_HOSTS.includes(d) && (h === d || h.endsWith(`.${d}`)));
  } catch {
    return false;
  }
}

/** Blank / chrome pages while a tab is still navigating — not a real "left the site". */
export function isTransientUrl(url) {
  if (!url) return true;
  return (
    url === "about:blank" ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-error://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("devtools://")
  );
}

export const LEVEL = {
  high: "Several warning signs",
  some: "Some warning signs",
  low: "No obvious warning signs",
};
