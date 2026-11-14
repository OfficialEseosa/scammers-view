import { promises as fs } from "fs";
import path from "path";
import { ScanEvent, type Finding } from "@/lib/types";

/**
 * Opt-in record/replay of scan event streams.
 * Recordings contain personal data: they live only under .cache/scans (git-ignored).
 */

const DIR = path.join(process.cwd(), ".cache", "scans");

interface Recording {
  version: 1;
  recordedAt: string;
  events: { t: number; event: ScanEvent }[];
  /** Final merged findings (after de-duplication added sources/upgrades). */
  finalFindings?: Finding[];
}

export class Recorder {
  private start = Date.now();
  private events: Recording["events"] = [];
  private finalFindings: Finding[] | undefined;
  push(event: ScanEvent) {
    this.events.push({ t: Date.now() - this.start, event: structuredClone(event) });
  }
  setFinal(findings: Finding[]) {
    this.finalFindings = findings;
  }
  async save(): Promise<string> {
    await fs.mkdir(DIR, { recursive: true });
    const name = new Date(this.start).toISOString().replace(/[:.]/g, "-") + ".json";
    const file = path.join(DIR, name);
    const rec: Recording = { version: 1, recordedAt: new Date(this.start).toISOString(), events: this.events, finalFindings: this.finalFindings };
    await fs.writeFile(file, JSON.stringify(rec, null, 1), "utf8");
    return name;
  }
}

async function resolveRecording(spec: string): Promise<string> {
  if (spec === "latest" || spec === "1" || spec === "true") {
    const files = (await fs.readdir(DIR)).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) throw new Error("no recordings in .cache/scans");
    return path.join(DIR, files[files.length - 1]);
  }
  // Only files inside .cache/scans can be replayed.
  return path.join(process.cwd(), ".cache", "scans", path.basename(spec));
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

/**
 * Replays a recording with realistic pacing: original gaps, each capped (so a
 * 40s silent search turn becomes a short pause), scaled by SCAN_REPLAY_SPEED.
 * Emits everything except the recorded terminal done/error (the route adds its own).
 */
export async function replay(spec: string, emit: (e: ScanEvent) => void, signal: AbortSignal): Promise<void> {
  const file = await resolveRecording(spec);
  const rec = JSON.parse(await fs.readFile(file, "utf8")) as Recording;
  const speed = Number(process.env.SCAN_REPLAY_SPEED) > 0 ? Number(process.env.SCAN_REPLAY_SPEED) : 1;
  const maxGap = Number(process.env.SCAN_REPLAY_MAX_GAP_MS) > 0 ? Number(process.env.SCAN_REPLAY_MAX_GAP_MS) : 2500;
  // Replay findings in their final merged form (sources, upgraded anchors/values).
  const final = new Map((rec.finalFindings ?? []).map((f) => [f.id, f]));
  let prev = 0;
  for (const { t, event: recorded } of rec.events) {
    const event: ScanEvent = recorded.type === "finding" && final.has(recorded.finding.id) ? { type: "finding", finding: final.get(recorded.finding.id)! } : recorded;
    if (signal.aborted) return;
    if (event.type === "done" || event.type === "error") continue;
    const gap = Math.min(Math.max(0, t - prev), maxGap) / speed;
    prev = t;
    if (gap > 0) await sleep(gap, signal);
    const parsed = ScanEvent.safeParse(event);
    if (parsed.success) emit(parsed.data);
  }
}
