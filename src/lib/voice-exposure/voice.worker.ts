/// <reference lib="webworker" />
/**
 * On-device speaker verification worker. Receives 16 kHz mono PCM, runs
 * Silero VAD + WeSpeaker ResNet34-LM embeddings, and returns numbers only.
 * Nothing is persisted: the Cache API is switched off for model files and
 * audio never leaves this worker except as embeddings / similarities.
 *
 * Models (Hugging Face, pinned revisions):
 *  - onnx-community/wespeaker-voxceleb-resnet34-LM  CC-BY-4.0  (WeSpeaker, VoxCeleb)
 *  - onnx-community/silero-vad                      MIT        (Silero VAD v5)
 */
import { AutoModel, env, Tensor, WeSpeakerFeatureExtractor, type PreTrainedModel } from "@huggingface/transformers";
import { cosine, planWindows, SAMPLE_RATE, speechSegments, totalSeconds, VAD_FRAME } from "./verify";
import { SPEAKER_MODEL, VAD_MODEL, type AnalyseResult, type Dtype, type WorkerRequest, type WorkerResponse } from "./protocol";

env.allowLocalModels = false;
env.useBrowserCache = false;
env.useWasmCache = false;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let speaker: PreTrainedModel | null = null;
let vad: PreTrainedModel | null = null;
let fbank: WeSpeakerFeatureExtractor | null = null;
let loading: Promise<{ bytes: number; ms: number; dtype: Dtype }> | null = null;
let loadedDtype: Dtype | null = null;

const FBANK_CONFIG = {
  feature_extractor_type: "WeSpeakerFeatureExtractor",
  sampling_rate: SAMPLE_RATE,
  num_mel_bins: 80,
  min_num_frames: 9,
  fbank_centering_span: null,
};

function load(id: number, dtype: Dtype) {
  if (loading && loadedDtype === dtype) return loading;
  loadedDtype = dtype;
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; name?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" && p.status !== "done") return;
    const key = `${p.name}/${p.file}`;
    const cur = files.get(key) ?? { loaded: 0, total: 0 };
    if (typeof p.total === "number" && p.total > 0) cur.total = p.total;
    if (typeof p.loaded === "number") cur.loaded = p.loaded;
    if (p.status === "done") cur.loaded = cur.total || cur.loaded;
    files.set(key, cur);
    let loaded = 0, total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    ctx.postMessage({ id, type: "progress", loaded, total } satisfies WorkerResponse);
  };
  const t0 = performance.now();
  loading = (async () => {
    const [s, v] = await Promise.all([
      AutoModel.from_pretrained(SPEAKER_MODEL.id, { revision: SPEAKER_MODEL.revision, dtype, device: "wasm", progress_callback }),
      AutoModel.from_pretrained(VAD_MODEL.id, {
        revision: VAD_MODEL.revision,
        dtype: "fp32",
        device: "wasm",
        // Silero ships no config.json.
        config: { model_type: "custom" } as never,
        progress_callback,
      }),
    ]);
    speaker = s;
    vad = v;
    fbank = new WeSpeakerFeatureExtractor(FBANK_CONFIG);
    let bytes = 0;
    for (const f of files.values()) bytes += f.total || f.loaded;
    return { bytes, ms: Math.round(performance.now() - t0), dtype };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Silero VAD v5: 512-sample frames with 64 samples of context, recurrent state [2,1,128]. */
async function vadProbs(pcm: Float32Array): Promise<Float32Array> {
  const CONTEXT = 64;
  const frames = Math.floor(pcm.length / VAD_FRAME);
  const probs = new Float32Array(frames);
  let state = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
  const buf = new Float32Array(CONTEXT + VAD_FRAME);
  for (let i = 0; i < frames; i++) {
    const at = i * VAD_FRAME;
    buf.fill(0, 0, CONTEXT);
    if (at >= CONTEXT) buf.set(pcm.subarray(at - CONTEXT, at), 0);
    buf.set(pcm.subarray(at, at + VAD_FRAME), CONTEXT);
    const out = (await vad!({ input: new Tensor("float32", buf.slice(), [1, CONTEXT + VAD_FRAME]), sr, state })) as Record<string, Tensor>;
    probs[i] = (out.output.data as Float32Array)[0];
    state = out.stateN;
  }
  return probs;
}

async function embed(pcm: Float32Array): Promise<Float32Array> {
  const { input_features } = await fbank!(pcm);
  const out = (await speaker!({ input_features })) as Record<string, Tensor>;
  const first = out.embeddings ?? out.last_hidden_state ?? Object.values(out)[0];
  return Float32Array.from(first.data as Float32Array);
}

async function analyse(pcm: Float32Array, reference?: Float32Array, keepEmbeddings = false): Promise<AnalyseResult> {
  const t0 = performance.now();
  const segments = speechSegments(await vadProbs(pcm));
  const t1 = performance.now();
  const windows: AnalyseResult["windows"] = [];
  for (const w of planWindows(segments)) {
    const e = await embed(pcm.subarray(Math.floor(w.start * SAMPLE_RATE), Math.ceil(w.end * SAMPLE_RATE)));
    windows.push({ ...w, similarity: reference ? cosine(e, reference) : 0, ...(keepEmbeddings ? { embedding: e } : {}) });
  }
  const t2 = performance.now();
  pcm.fill(0);
  return { speechSeconds: totalSeconds(segments), segments, windows, ms: { vad: Math.round(t1 - t0), embed: Math.round(t2 - t1) } };
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      const r = await load(msg.id, msg.dtype);
      ctx.postMessage({ id: msg.id, type: "loaded", ...r } satisfies WorkerResponse);
    } else if (msg.type === "analyse") {
      if (!speaker || !vad) throw new Error("models not loaded");
      const result = await analyse(msg.pcm, msg.reference, msg.keepEmbeddings);
      ctx.postMessage({ id: msg.id, type: "analysed", result } satisfies WorkerResponse);
    }
  } catch (err) {
    ctx.postMessage({ id: msg.id, type: "error", message: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};
