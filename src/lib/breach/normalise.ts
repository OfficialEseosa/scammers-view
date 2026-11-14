import type { BreachInfo } from "./types";

function isoDate(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? "1970-01-01" : new Date(t).toISOString().slice(0, 10);
}

function strings(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()) : [];
}

export function sortNewestFirst(list: BreachInfo[]): BreachInfo[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

/** HIBP breachedaccount?truncateResponse=false. Drops sensitive and retired entries. */
export function normaliseHibp(raw: unknown): BreachInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: BreachInfo[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const b = r as Record<string, unknown>;
    if (typeof b.Name !== "string" || !b.Name) continue;
    if (b.IsSensitive || b.IsRetired) continue;
    out.push({
      name: typeof b.Title === "string" && b.Title ? b.Title : b.Name,
      domain: typeof b.Domain === "string" && b.Domain ? b.Domain : undefined,
      date: isoDate(b.BreachDate),
      dataClasses: strings(b.DataClasses),
      verified: typeof b.IsVerified === "boolean" ? b.IsVerified : undefined,
    });
  }
  return sortNewestFirst(out);
}

/** XposedOrNot /v1/breach-analytics. xposed_data is a ";"-separated list, xposed_date a year. */
export function normaliseXon(raw: unknown): BreachInfo[] {
  const details = (raw as { ExposedBreaches?: { breaches_details?: unknown } } | null)?.ExposedBreaches?.breaches_details;
  if (!Array.isArray(details)) return [];
  const out: BreachInfo[] = [];
  for (const r of details) {
    if (!r || typeof r !== "object") continue;
    const b = r as Record<string, unknown>;
    if (typeof b.breach !== "string" || !b.breach) continue;
    const classes = typeof b.xposed_data === "string" ? b.xposed_data.split(";").map((s) => s.trim()).filter(Boolean) : [];
    const v = b.verified;
    out.push({
      name: b.breach,
      domain: typeof b.domain === "string" && b.domain ? b.domain : undefined,
      date: isoDate(b.xposed_date),
      dataClasses: classes,
      verified: typeof v === "boolean" ? v : typeof v === "string" ? /^(yes|true)$/i.test(v) : undefined,
    });
  }
  return sortNewestFirst(out);
}
