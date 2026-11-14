"use client";

import type { AnalyseResult, Dtype, WorkerRequest, WorkerResponse } from "./protocol";
import { meanEmbedding, MIN_REFERENCE_SEC, SAMPLE_RATE, verdictFor, type VoiceVerdict } from "./verify";

/**
 * Main-thread side of the on-device voice check: decode + resample here
 * (OfflineAudioContext is not available in workers), VAD + embeddings in a
 * worker. Audio and embeddings stay in this tab's memory.
 */

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (l: number, t: number) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./voice.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === "progress") return p.onProgress?.(m.loaded, m.total);
    pending.delete(m.id);
    if (m.type === "error") p.reject(new Error(m.message));
    else p.resolve(m);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "voice worker failed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type Req = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id"> : never) : never;

function call(req: Req, transfer: Transferable[] = [], onProgress?: (l: number, t: number) => void): Promise<WorkerResponse> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...req, id } as WorkerRequest, transfer);
  });
}

export interface LoadInfo {
  bytes: number;
  ms: number;
  dtype: Dtype;
}

export async function loadVoiceModels(dtype: Dtype = "fp32", onProgress?: (loaded: number, total: number) => void): Promise<LoadInfo> {
  const r = await call({ type: "load", dtype }, [], onProgress);
  if (r.type !== "loaded") throw new Error("unexpected worker reply");
  return { bytes: r.bytes, ms: r.ms, dtype: r.dtype };
}

/** Stop the worker and drop the models (End session). */
export function disposeVoiceEngine() {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error("disposed"));
  pending.clear();
}

/** Any container the browser can decode -> 16 kHz mono Float32 PCM. */
export async function decodeTo16kMono(data: ArrayBuffer, maxSeconds = 180): Promise<Float32Array> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ac.decodeAudioData(data);
  } finally {
    void ac.close().catch(() => {});
  }
  const seconds = Math.min(decoded.duration, maxSeconds);
  const length = Math.max(1, Math.ceil(seconds * SAMPLE_RATE));
  const off = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination); // channels are down-mixed to mono by the destination
  src.start(0, 0, seconds);
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}

export async function analyse(pcm: Float32Array, reference?: Float32Array, keepEmbeddings = false): Promise<AnalyseResult> {
  const r = await call({ type: "analyse", pcm, reference, keepEmbeddings }, [pcm.buffer]);
  if (r.type !== "analysed") throw new Error("unexpected worker reply");
  return r.result;
}

export class NotEnoughSpeechError extends Error {
  constructor(readonly speechSeconds: number) {
    super("not enough speech in the reference");
  }
}

/** Reference voiceprint: mean embedding over the speech windows of the live sample. */
export async function buildReference(pcm: Float32Array): Promise<{ embedding: Float32Array; speechSeconds: number; windows: number; ms: number }> {
  const t0 = performance.now();
  const r = await analyse(pcm, undefined, true);
  const embs = r.windows.map((w) => w.embedding!).filter(Boolean);
  const embedding = meanEmbedding(embs);
  embs.forEach((e) => e.fill(0));
  if (!embedding || r.speechSeconds < MIN_REFERENCE_SEC) throw new NotEnoughSpeechError(r.speechSeconds);
  return { embedding, speechSeconds: r.speechSeconds, windows: r.windows.length, ms: Math.round(performance.now() - t0) };
}

export interface ClipResult extends VoiceVerdict {
  ms: { fetch: number; decode: number; vad: number; embed: number; total: number };
  durationSec: number;
}

/** Fetch -> decode -> VAD -> windowed embeddings -> verdict for one clip. */
export async function verifyClip(fetchBytes: () => Promise<ArrayBuffer>, reference: Float32Array, threshold?: number): Promise<ClipResult> {
  const t0 = performance.now();
  const bytes = await fetchBytes();
  const t1 = performance.now();
  const pcm = await decodeTo16kMono(bytes);
  const durationSec = pcm.length / SAMPLE_RATE;
  const t2 = performance.now();
  const r = await analyse(pcm, reference);
  const v = verdictFor(r.speechSeconds, r.windows, threshold);
  return {
    ...v,
    durationSec: Math.round(durationSec * 10) / 10,
    ms: { fetch: Math.round(t1 - t0), decode: Math.round(t2 - t1), vad: r.ms.vad, embed: r.ms.embed, total: Math.round(performance.now() - t0) },
  };
}

/** Same-origin fixture paths load directly; everything else goes through the hardened relay. */
export async function fetchMedia(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const local = url.startsWith("/fixtures/voice/");
  const res = await fetch(local ? url : `/api/voice/media?url=${encodeURIComponent(url)}`, { cache: "no-store", signal, credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}
