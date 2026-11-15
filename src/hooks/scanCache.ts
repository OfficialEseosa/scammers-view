import type { AttackChain, ExposureScore, Finding, SourceType } from "@/lib/types";

/**
 * A finished scan, saved in this browser only. Nothing here is sent anywhere:
 * it lets the same person reopen their results without paying for a new scan,
 * and it is erased when they end the session.
 */
export interface CachedScan {
  version: 1;
  owner: string;
  savedAt: number;
  findings: Finding[];
  chains: AttackChain[];
  score: ExposureScore | null;
  sources: Partial<Record<SourceType, { status: "running" | "done"; count: number; query?: string }>>;
}

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

export function saveScanCache(scan: Omit<CachedScan, "version" | "savedAt">): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...scan, version: 1, savedAt: Date.now() } satisfies CachedScan));
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
