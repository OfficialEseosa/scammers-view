/*
 * FTC Do Not Call complaint data. The FTC API cannot search by phone number, so the app
 * downloads the FTC's public daily complaint files for the last few days and looks numbers up
 * locally. The FTC never learns which numbers a student checked.
 * https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data
 */

export interface NumberReports {
  reports: number;
  robocalls: number;
  /** Most common complaint subject. */
  topSubject: string;
}

export type FtcIndex = Map<string, NumberReports>;

/** How many calendar days of daily files to load (weekends and holidays have none). */
export const FTC_DAYS = 10;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const BASE = "https://search.ftc.gov/sites/default/files/DNC_Complaint_Numbers_";

export function ftcFileUrls(now = new Date(), days = FTC_DAYS): string[] {
  const urls: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 86_400_000);
    urls.push(`${BASE}${d.toISOString().slice(0, 10)}.csv`);
  }
  return urls;
}

/** Splits one CSV line, honouring quoted fields. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

type Tally = Map<string, { reports: number; robocalls: number; subjects: Map<string, number> }>;

/** Adds one daily file (header: Company_Phone_Number,...,Subject,Recorded_Message_Or_Robocall). */
export function addFtcCsv(tally: Tally, csv: string) {
  const lines = csv.split(/\r?\n/);
  const header = splitCsv(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const numCol = header.indexOf("company_phone_number");
  const subjCol = header.indexOf("subject");
  const roboCol = header.indexOf("recorded_message_or_robocall");
  if (numCol < 0) return;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = splitCsv(lines[i]);
    const number = (cols[numCol] ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (number.length !== 10) continue;
    let t = tally.get(number);
    if (!t) tally.set(number, (t = { reports: 0, robocalls: 0, subjects: new Map() }));
    t.reports++;
    if ((cols[roboCol] ?? "").trim().toUpperCase() === "Y") t.robocalls++;
    const subject = (cols[subjCol] ?? "").trim() || "Other";
    t.subjects.set(subject, (t.subjects.get(subject) ?? 0) + 1);
  }
}

export function finishFtcIndex(tally: Tally): FtcIndex {
  const index: FtcIndex = new Map();
  for (const [number, t] of tally) {
    // "Other" only wins when nothing more specific was given.
    let topSubject = "Other";
    let best = 0;
    for (const [s, n] of t.subjects) {
      if (s !== "Other" && n > best) {
        topSubject = s;
        best = n;
      }
    }
    index.set(number, { reports: t.reports, robocalls: t.robocalls, topSubject });
  }
  return index;
}

/** Downloads the daily files that exist (missing days are skipped). */
export async function loadFtcIndex(fetchImpl: typeof fetch = fetch, now = new Date()): Promise<FtcIndex> {
  const tally: Tally = new Map();
  const files = await Promise.all(
    ftcFileUrls(now).map(async (url) => {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    }),
  );
  let loaded = 0;
  for (const csv of files) {
    if (csv && csv.startsWith("Company_Phone_Number")) {
      addFtcCsv(tally, csv);
      loaded++;
    }
  }
  if (loaded === 0) throw new Error("No FTC complaint files could be loaded");
  return finishFtcIndex(tally);
}

interface Holder {
  index?: FtcIndex;
  loadedAt?: number;
  loading?: Promise<FtcIndex>;
  failedAt?: number;
}
const g = globalThis as unknown as { __svFtc?: Holder };
const holder: Holder = (g.__svFtc ??= {});

/**
 * The current index, loading or refreshing it in the background when needed. Resolves with
 * whatever is ready; callers race it against their own time limit.
 */
export function ftcIndex(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<FtcIndex | null> {
  const fresh = holder.index && holder.loadedAt && now - holder.loadedAt < REFRESH_MS;
  const recentlyFailed = holder.failedAt && now - holder.failedAt < 10 * 60 * 1000;
  if (!fresh && !holder.loading && !recentlyFailed) {
    holder.loading = loadFtcIndex(fetchImpl)
      .then((index) => {
        holder.index = index;
        holder.loadedAt = Date.now();
        holder.failedAt = undefined;
        return index;
      })
      .catch((e) => {
        holder.failedAt = Date.now();
        throw e;
      })
      .finally(() => {
        holder.loading = undefined;
      });
    holder.loading.catch(() => {});
  }
  if (holder.index) return Promise.resolve(holder.index);
  return holder.loading ? holder.loading.catch(() => null) : Promise.resolve(null);
}

/** Test hook. */
export function __setFtcIndexForTests(index: FtcIndex | undefined) {
  holder.index = index;
  holder.loadedAt = index ? Date.now() : undefined;
  holder.loading = undefined;
  holder.failedAt = undefined;
}
