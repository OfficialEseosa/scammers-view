import type { AttackChain, ExposureScore, Finding, SourceType } from "@/lib/types";

/**
 * A finished scan, remembered so the same person can reopen their results
 * without paying for a new scan. Two layers:
 *   - the account copy, saved encrypted on our server (/api/scan/saved), so it
 *     follows the person to any device they sign in on;
 *   - a local copy in this browser, a fast and offline layer.
 * Both are erased when they end the session.
 */
export interface CachedScan {
  version: 1;
  owner: string;
  savedAt: number;
  findings: Finding[];
  chains: AttackChain[];
  score: ExposureScore | null;
  sources: Partial<Record<SourceType, { status: "running" | "done"; count: number; query?: string }>>;
  /** Findings the person marked "not me". */
  notMeIds?: string[];
}

export type ScanBody = Omit<CachedScan, "version" | "owner">;

const KEY = "sv_scan_v1";

export function loadScanCache(owner: string): CachedScan | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CachedScan;
    if (data?.version !== 1 || data.owner !== owner || !Array.isArray(data.findings) || data.findings.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveScanCache(scan: Omit<CachedScan, "version" | "savedAt"> & { savedAt?: number }): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...scan, version: 1, savedAt: scan.savedAt ?? Date.now() } satisfies CachedScan));
  } catch {
    /* storage full or blocked: the scan still works, it just isn't remembered */
  }
}

export function clearScanCache(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** "none": signed in, nothing saved. "unavailable": not configured, signed out or unreachable. */
export type ServerScan = { status: "found"; scan: ScanBody } | { status: "none" } | { status: "unavailable" };

export async function fetchServerScan(timeoutMs = 6000): Promise<ServerScan> {
  try {
    const res = await fetch("/api/scan/saved", { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { status: "unavailable" };
    const data = (await res.json()) as { saved?: ScanBody | null; state?: string };
    if (data.state === "not_configured") return { status: "unavailable" };
    const s = data.saved;
    if (s && Array.isArray(s.findings) && s.findings.length > 0 && typeof s.savedAt === "number") return { status: "found", scan: s };
    return { status: "none" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Save to the account. Best effort: the local copy still works if this fails. */
export async function putServerScan(scan: ScanBody): Promise<boolean> {
  try {
    const body: ScanBody = {
      savedAt: scan.savedAt,
      findings: scan.findings,
      chains: scan.chains,
      score: scan.score,
      sources: scan.sources,
      notMeIds: scan.notMeIds ?? [],
    };
    const res = await fetch("/api/scan/saved", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete the account copy. True when it is gone (or the feature is off). */
export async function deleteServerScan(): Promise<boolean> {
  try {
    const res = await fetch("/api/scan/saved", { method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch {
    return false;
  }
}
