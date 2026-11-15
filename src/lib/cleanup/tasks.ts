import { createHash } from "node:crypto";
import type { Fix } from "@/lib/fixes/types";
import {
  BROKER_SITES,
  PROFILE_SITES,
  SETTINGS_SITES,
  allowedUrl,
  brokerForUrl,
  brokerTask,
  hostOf,
  profileForUrl,
  profileTask,
  settingsTask,
} from "./sites";
import type { CleanupTask } from "./types";

/** Resolves a task id to a known site; the browser never chooses the goal or the allowed hosts. */
export function taskFor(id: string, listingUrl?: string): CleanupTask | null {
  const [kind, key] = id.split(":");
  if (kind === "broker") {
    const b = BROKER_SITES.find((x) => x.id === key);
    return b ? brokerTask(b, listingUrl) : null;
  }
  if (kind === "settings") {
    const s = SETTINGS_SITES.find((x) => x.id === key);
    return s ? settingsTask(s) : null;
  }
  if (kind === "profile") {
    const s = PROFILE_SITES.find((x) => x.id === key);
    if (!s || !listingUrl || !allowedUrl(listingUrl, [s.domain])) return null;
    return profileTask(s, listingUrl);
  }
  return null;
}

export function cleanupOwner(email: string): string {
  return createHash("sha256").update(`cleanup:${email.trim().toLowerCase()}`).digest("hex");
}

export type CleanupMode = "broker-form" | "broker-email" | "settings" | "github-api" | "prepare";

/** How the agent can help with this fix, or null when it can't. */
export function cleanupForFix(fix: Fix): { taskId: string; mode: CleanupMode; site: string } | null {
  if (fix.kind === "broker" && fix.optout) {
    const b = brokerForUrl(fix.optout.listingUrl) ?? BROKER_SITES.find((x) => x.name.toLowerCase() === fix.optout!.broker.toLowerCase());
    if (!b) return null;
    return { taskId: `broker:${b.id}`, mode: b.method === "email" ? "broker-email" : "broker-form", site: b.name };
  }
  if (fix.kind === "privacy") {
    const platform = fix.id.replace(/^fix:privacy:/, "");
    const s = SETTINGS_SITES.find((x) => x.platform === platform);
    if (!s) return null;
    // GitHub email privacy is a settings page in the student's signed-in Chrome (both
    // checkboxes). The API token path is offered inside the panel as a fallback.
    return { taskId: `settings:${s.id}`, mode: "settings", site: s.name };
  }
  if (fix.kind === "2fa" || fix.kind === "security-question") {
    return { taskId: `prepare:${fix.id}`, mode: "prepare", site: fix.title };
  }
  if (fix.kind === "takedown" && fix.link) {
    const h = hostOf(fix.link);
    const b = BROKER_SITES.find((x) => h === x.domain || h.endsWith(`.${x.domain}`));
    if (b) return { taskId: `broker:${b.id}`, mode: b.method === "email" ? "broker-email" : "broker-form", site: b.name };
    const p = profileForUrl(fix.link);
    if (p) return { taskId: `profile:${p.id}`, mode: "settings", site: p.name };
  }
  return null;
}
