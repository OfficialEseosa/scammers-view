"use client";

import { useState } from "react";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { analyse, decodeTo16kMono, disposeVoiceEngine, fetchMedia, loadVoiceModels, type LoadInfo } from "@/lib/voice-exposure/client";
import { SPEAKER_MODEL, VAD_MODEL, type Dtype } from "@/lib/voice-exposure/protocol";
import { clearVoiceData, getVoiceEmbedding, hasVoiceReference, setVoiceEmbedding } from "@/lib/voice-exposure/store";
import { calibrate, cosine, MATCH_THRESHOLD, meanEmbedding, SAMPLE_RATE, verdictFor, type VoiceVerdict } from "@/lib/voice-exposure/verify";
import { FIXTURE_CLIPS, FIXTURE_REFERENCE, FIXTURE_VIDEO_FINDINGS } from "../fixtures";
import { VoiceExposure } from "../VoiceExposure";

interface ClipRow {
  id: string;
  label: string;
  speaker: string;
  durationSec: number;
  speechSeconds: number;
  windows: number;
  ms: { fetch: number; decode: number; vad: number; embed: number; total: number };
  verdict?: VoiceVerdict;
  windowSims: number[];
  clipSim?: number;
}

interface LabReport {
  dtype: Dtype;
  load: LoadInfo;
  threshold: number;
  rows: ClipRow[];
  windowCalibration: ReturnType<typeof calibrate>;
  clipCalibration: ReturnType<typeof calibrate>;
  genuineWindows: number[];
  impostorWindows: number[];
  pairs: { a: string; b: string; same: boolean; sim: number }[];
  mixed?: { label: string; verdict: VoiceVerdict }[];
}

declare global {
  interface Window {
    __voiceLab?: { report?: LabReport; storage?: unknown; clear?: unknown };
  }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function pcmOf(file: string) {
  const t0 = performance.now();
  const bytes = await fetchMedia(file);
  const t1 = performance.now();
  const pcm = await decodeTo16kMono(bytes);
  return { pcm, fetch: Math.round(t1 - t0), decode: Math.round(performance.now() - t1) };
}

/** Speech at full level with the music bed at `musicGain` underneath. */
function mix(speech: Float32Array, music: Float32Array, musicGain: number) {
  const out = new Float32Array(speech.length);
  for (let i = 0; i < out.length; i++) out[i] = speech[i] + musicGain * (music[i % music.length] ?? 0);
  return out;
}

async function runMeasurement(dtype: Dtype, log: (s: string) => void): Promise<LabReport> {
  log(`Loading models (${dtype})`);
  const load = await loadVoiceModels(dtype, (l, t) => log(`Downloading ${(l / 1e6).toFixed(1)} / ${(t / 1e6).toFixed(1)} MB`));
  log(`Models ready: ${(load.bytes / 1e6).toFixed(1)} MB in ${load.ms} ms`);

  const embs = new Map<string, Float32Array[]>();
  const rows: ClipRow[] = [];
  const raw = new Map<string, Float32Array>();
  for (const c of FIXTURE_CLIPS) {
    log(`Processing ${c.label}`);
    const { pcm, fetch, decode } = await pcmOf(c.file);
    raw.set(c.id, pcm.slice());
    const durationSec = pcm.length / SAMPLE_RATE;
    const t0 = performance.now();
    const r = await analyse(pcm, undefined, true);
    const total = Math.round(performance.now() - t0) + fetch + decode;
    embs.set(c.id, r.windows.map((w) => w.embedding!));
    rows.push({ id: c.id, label: c.label, speaker: c.speaker, durationSec: r3(durationSec), speechSeconds: r3(r.speechSeconds), windows: r.windows.length, ms: { fetch, decode, vad: r.ms.vad, embed: r.ms.embed, total }, windowSims: [] });
  }

  const ref = meanEmbedding(embs.get(FIXTURE_REFERENCE.id)!)!;
  const genuineWindows: number[] = [];
  const impostorWindows: number[] = [];
  for (const row of rows) {
    if (row.id === FIXTURE_REFERENCE.id) continue;
    const ws = embs.get(row.id)!;
    row.windowSims = ws.map((e) => r3(cosine(e, ref)));
    const clip = meanEmbedding(ws);
    row.clipSim = clip ? r3(cosine(clip, ref)) : undefined;
    if (row.speaker === "A") genuineWindows.push(...row.windowSims);
    else if (row.speaker !== "-") impostorWindows.push(...row.windowSims);
  }
  const windowCalibration = calibrate(genuineWindows, impostorWindows);

  // Clip-level pairs between every two speech clips (each clip's mean embedding).
  const speech = rows.filter((r) => r.speaker !== "-");
  const pairs: LabReport["pairs"] = [];
  for (let i = 0; i < speech.length; i++)
    for (let j = i + 1; j < speech.length; j++) {
      const a = meanEmbedding(embs.get(speech[i].id)!), b = meanEmbedding(embs.get(speech[j].id)!);
      if (a && b) pairs.push({ a: speech[i].id, b: speech[j].id, same: speech[i].speaker === speech[j].speaker, sim: r3(cosine(a, b)) });
    }
  const clipCalibration = calibrate(pairs.filter((p) => p.same).map((p) => p.sim), pairs.filter((p) => !p.same).map((p) => p.sim));

  // Verdicts with the shipped threshold, using the same window logic the product uses.
  for (const row of rows) {
    if (row.id === FIXTURE_REFERENCE.id) continue;
    const ws = embs.get(row.id)!;
    const { windows } = await analyse(raw.get(row.id)!.slice(), ref);
    row.verdict = verdictFor(row.speechSeconds, windows);
    void ws;
  }

  // Weakness probe: your voice with a music bed underneath, at two levels.
  const mixed: LabReport["mixed"] = [];
  for (const g of [0.5, 1.5]) {
    const m = mix(raw.get("a-same-1")!, raw.get("music")!, g);
    const r = await analyse(m, ref);
    mixed.push({ label: `Speaker A + piano x${g}`, verdict: verdictFor(r.speechSeconds, r.windows) });
  }

  for (const list of embs.values()) list.forEach((e) => e.fill(0));
  return { dtype, load, threshold: MATCH_THRESHOLD, rows, windowCalibration, clipCalibration, genuineWindows, impostorWindows, pairs, mixed };
}

async function storageAudit() {
  const ls: string[] = [];
  const ss: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) ls.push(localStorage.key(i)!);
    for (let i = 0; i < sessionStorage.length; i++) ss.push(sessionStorage.key(i)!);
  } catch {
    /* blocked */
  }
  const caches_ = typeof caches !== "undefined" ? await caches.keys().catch(() => ["(error)"]) : [];
  const idb = typeof indexedDB !== "undefined" && "databases" in indexedDB ? (await indexedDB.databases().catch(() => [])).map((d) => d.name) : ["(unsupported)"];
  return { localStorage: ls, sessionStorage: ss, cacheStorage: caches_, indexedDB: idb, cookies: document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter(Boolean) };
}

export function VoiceLab() {
  const [dtype, setDtype] = useState<Dtype>("fp32");
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<LabReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<unknown>(null);
  const [clearTest, setClearTest] = useState<unknown>(null);
  const [demoKey, setDemoKey] = useState(0);

  const add = (s: string) => setLog((l) => [...l.slice(-12), s]);

  const run = async () => {
    setBusy(true);
    setReport(null);
    try {
      const r = await runMeasurement(dtype, add);
      setReport(r);
      window.__voiceLab = { ...window.__voiceLab, report: r };
      add("Done");
    } catch (e) {
      add(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doAudit = async () => {
    const a = await storageAudit();
    setAudit(a);
    window.__voiceLab = { ...window.__voiceLab, storage: a };
  };

  const doClear = () => {
    const before = { has: hasVoiceReference(), embeddingLength: getVoiceEmbedding()?.length ?? 0 };
    const held = getVoiceEmbedding();
    clearVoiceData();
    const after = { has: hasVoiceReference(), embedding: getVoiceEmbedding(), heldArrayZeroed: held ? held.every((x) => x === 0) : null };
    const r = { before, after };
    setClearTest(r);
    window.__voiceLab = { ...window.__voiceLab, clear: r };
  };

  return (
    <div className="flex flex-col gap-10">
      <Card>
        <h2 className="font-display text-xl font-semibold">Measure</h2>
        <p className="mt-1 text-sm text-muted">
          {SPEAKER_MODEL.id} ({SPEAKER_MODEL.licence}) · {VAD_MODEL.id} ({VAD_MODEL.licence})
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select value={dtype} onChange={(e) => setDtype(e.target.value as Dtype)} className="min-h-11 rounded-control border border-edge bg-canvas px-3" aria-label="Weights">
            <option value="fp32">fp32</option>
            <option value="q8">q8</option>
          </select>
          <Button onClick={() => void run()} disabled={busy} data-lab="run">
            {busy ? "Running" : "Run fixtures"}
          </Button>
          <Button variant="secondary" onClick={() => { disposeVoiceEngine(); add("Engine disposed"); }}>
            Dispose engine
          </Button>
        </div>
        <pre className="mt-4 max-h-40 overflow-auto text-sm text-muted" aria-live="polite">{log.join("\n")}</pre>
        {report && (
          <div className="mt-4 overflow-x-auto">
            <p className="text-sm">
              Download {(report.load.bytes / 1e6).toFixed(1)} MB in {report.load.ms} ms · threshold {report.threshold} · window calibration{" "}
              {report.windowCalibration.threshold} ({report.windowCalibration.separated ? "separated" : `FRR ${report.windowCalibration.frr} FAR ${report.windowCalibration.far}`})
            </p>
            <table className="mt-3 w-full text-left text-sm" data-lab="table">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3">Clip</th>
                  <th className="pr-3">Len</th>
                  <th className="pr-3">Speech</th>
                  <th className="pr-3">Win</th>
                  <th className="pr-3">Clip sim</th>
                  <th className="pr-3">Window sims</th>
                  <th className="pr-3">Verdict</th>
                  <th className="pr-3">ms (fetch/decode/vad/embed)</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.id} className="border-t border-edge">
                    <td className="py-1 pr-3">{r.label}</td>
                    <td className="pr-3">{r.durationSec}</td>
                    <td className="pr-3">{r.speechSeconds}</td>
                    <td className="pr-3">{r.windows}</td>
                    <td className="pr-3">{r.clipSim ?? "-"}</td>
                    <td className="pr-3">{r.windowSims.join(", ")}</td>
                    <td className="pr-3">{r.verdict ? `${r.verdict.kind} ${r.verdict.matchedSeconds}s` : "reference"}</td>
                    <td className="pr-3">{`${r.ms.fetch}/${r.ms.decode}/${r.ms.vad}/${r.ms.embed}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.mixed && (
              <ul className="mt-3 text-sm">
                {report.mixed.map((m) => (
                  <li key={m.label}>
                    {m.label}: {m.verdict.kind}, best {m.verdict.similarity}, matched {m.verdict.matchedSeconds}s of {m.verdict.speechSeconds}s
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-display text-xl font-semibold">Privacy checks</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => void doAudit()} data-lab="audit">
            Audit storage
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setVoiceEmbedding(new Float32Array(256).fill(0.1));
              add("Test voiceprint set");
            }}
          >
            Set test voiceprint
          </Button>
          <Button variant="secondary" onClick={doClear} data-lab="clear">
            clearVoiceData()
          </Button>
        </div>
        {audit != null && <pre className="mt-3 text-sm">{JSON.stringify(audit, null, 1)}</pre>}
        {clearTest != null && <pre className="mt-3 text-sm">{JSON.stringify(clearTest, null, 1)}</pre>}
      </Card>

      <div>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="font-display text-xl font-semibold">Component, fixture mode</h2>
          <Button variant="ghost" size="sm" onClick={() => setDemoKey((k) => k + 1)}>
            Reset
          </Button>
        </div>
        <VoiceExposure key={demoKey} findings={FIXTURE_VIDEO_FINDINGS} fixtureReference={FIXTURE_REFERENCE.file} />
      </div>
    </div>
  );
}
