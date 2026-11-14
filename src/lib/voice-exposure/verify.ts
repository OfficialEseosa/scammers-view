/**
 * Pure speaker-verification maths (no DOM, no models; unit-tested):
 * VAD frame probabilities -> speech segments -> scoring windows -> cosine
 * similarity against the reference -> per-video verdict.
 */

export const SAMPLE_RATE = 16_000;
/** Silero VAD v5 frame at 16 kHz. */
export const VAD_FRAME = 512;
export const VAD_FRAME_SEC = VAD_FRAME / SAMPLE_RATE;

/**
 * Cosine threshold for one ~3 s window to count as the reference speaker.
 * Calibrated in the browser on the lab fixtures (WeSpeaker ResNet34-LM, 3 s windows
 * vs a 30 s reference): same speaker 0.68 to 0.83, other speakers -0.05 to 0.32
 * (fp32 and q8 alike), so 0.5 sits mid-gap. See /lab/voice-exposure.
 */
export const MATCH_THRESHOLD = 0.5;
/** Scoring window length; shorter speech regions down to MIN_WINDOW_SEC still count. */
export const WINDOW_SEC = 3;
export const MIN_WINDOW_SEC = 1.5;
/** Matched speech needed before a video counts as "your voice". */
export const MIN_MATCHED_SEC = 2;
/** Less speech than this and the clip is "no speech". */
export const MIN_SPEECH_SEC = 1.5;
/** Reference needs at least this much speech. */
export const MIN_REFERENCE_SEC = 5;

/** What instant voice cloning needs (ElevenLabs Instant Voice Cloning docs). */
export const CLONE_MIN_SEC = 10;
export const CLONE_RECOMMENDED_SEC = 60;

export interface Segment {
  start: number;
  end: number;
}

export interface VadOptions {
  threshold?: number;
  negThreshold?: number;
  minSpeechSec?: number;
  minSilenceSec?: number;
  padSec?: number;
}

/** Silero-style hysteresis segmentation over per-frame speech probabilities. */
export function speechSegments(probs: ArrayLike<number>, frameSec = VAD_FRAME_SEC, opts: VadOptions = {}): Segment[] {
  const th = opts.threshold ?? 0.5;
  const neg = opts.negThreshold ?? Math.max(th - 0.15, 0.01);
  const minSpeech = opts.minSpeechSec ?? 0.25;
  const minSilence = opts.minSilenceSec ?? 0.1;
  const pad = opts.padSec ?? 0.03;
  const total = probs.length * frameSec;
  const out: Segment[] = [];
  let inSpeech = false;
  let start = 0;
  let silenceAt: number | null = null;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    const t = i * frameSec;
    if (p >= th) {
      silenceAt = null;
      if (!inSpeech) {
        inSpeech = true;
        start = t;
      }
    } else if (inSpeech && p < neg) {
      silenceAt ??= t;
      if (t + frameSec - silenceAt >= minSilence) {
        if (silenceAt - start >= minSpeech) out.push({ start, end: silenceAt });
        inSpeech = false;
        silenceAt = null;
      }
    }
  }
  if (inSpeech) {
    const end = silenceAt ?? total;
    if (end - start >= minSpeech) out.push({ start, end });
  }
  return out.map((s) => ({ start: Math.max(0, s.start - pad), end: Math.min(total, s.end + pad) }));
}

export const totalSeconds = (segs: Segment[]) => segs.reduce((a, s) => a + (s.end - s.start), 0);

/** Merge segments separated by short pauses into speaking regions. */
export function mergeSegments(segs: Segment[], maxGapSec = 0.5): Segment[] {
  const out: Segment[] = [];
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start - last.end <= maxGapSec) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Non-overlapping scoring windows inside speaking regions: WINDOW_SEC chunks,
 * a remainder >= MIN_WINDOW_SEC becomes its own window, a shorter one joins the
 * previous window. Regions shorter than MIN_WINDOW_SEC are not scored.
 */
export function planWindows(segs: Segment[], win = WINDOW_SEC, minWin = MIN_WINDOW_SEC): Segment[] {
  const out: Segment[] = [];
  for (const r of mergeSegments(segs)) {
    const len = r.end - r.start;
    if (len < minWin) continue;
    let t = r.start;
    const local: Segment[] = [];
    while (r.end - t >= win) {
      local.push({ start: t, end: t + win });
      t += win;
    }
    const rest = r.end - t;
    if (rest >= minWin || local.length === 0) local.push({ start: t, end: r.end });
    else if (rest > 0) local[local.length - 1].end = r.end;
    out.push(...local);
  }
  return out;
}

export function l2normalize(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Mean of L2-normalised embeddings, renormalised: the reference voiceprint. */
export function meanEmbedding(list: ArrayLike<number>[]): Float32Array | null {
  if (!list.length) return null;
  const dim = list[0].length;
  const acc = new Float32Array(dim);
  for (const e of list) {
    const n = l2normalize(e);
    for (let i = 0; i < dim; i++) acc[i] += n[i];
  }
  return l2normalize(acc);
}

export type VoiceVerdictKind = "yours" | "someone_else" | "no_speech";

export interface ScoredWindow extends Segment {
  similarity: number;
}

export interface VoiceVerdict {
  matched: boolean;
  kind: VoiceVerdictKind;
  /** Best window similarity (0 when nothing was scored). */
  similarity: number;
  speechSeconds: number;
  matchedSeconds: number;
  windows: ScoredWindow[];
}

/** Only windows at or above the threshold count, so a clip with several speakers counts just your parts. */
export function verdictFor(speechSeconds: number, windows: ScoredWindow[], threshold = MATCH_THRESHOLD): VoiceVerdict {
  const round = (x: number) => Math.round(x * 10) / 10;
  const similarity = windows.reduce((m, w) => Math.max(m, w.similarity), 0);
  const matchedSeconds = windows.filter((w) => w.similarity >= threshold).reduce((a, w) => a + (w.end - w.start), 0);
  if (speechSeconds < MIN_SPEECH_SEC || windows.length === 0) {
    return { matched: false, kind: "no_speech", similarity: round3(similarity), speechSeconds: round(speechSeconds), matchedSeconds: 0, windows };
  }
  const matched = matchedSeconds >= MIN_MATCHED_SEC;
  return {
    matched,
    kind: matched ? "yours" : "someone_else",
    similarity: round3(similarity),
    speechSeconds: round(speechSeconds),
    matchedSeconds: matched ? round(matchedSeconds) : 0,
    windows,
  };
}

function round3(x: number) {
  return Math.round(x * 1000) / 1000;
}

/**
 * Pick a threshold from labelled scores: the midpoint of the widest gap between
 * the highest impostor and lowest genuine score, or the equal-error point when
 * they overlap. Returns the threshold and the error rates at it.
 */
export function calibrate(genuine: number[], impostor: number[]): { threshold: number; frr: number; far: number; separated: boolean } {
  if (!genuine.length || !impostor.length) return { threshold: MATCH_THRESHOLD, frr: 0, far: 0, separated: false };
  const g = [...genuine].sort((a, b) => a - b);
  const im = [...impostor].sort((a, b) => a - b);
  const maxImp = im[im.length - 1];
  const minGen = g[0];
  if (minGen > maxImp) return { threshold: round3((minGen + maxImp) / 2), frr: 0, far: 0, separated: true };
  let best = { threshold: MATCH_THRESHOLD, frr: 1, far: 1, gap: Infinity };
  for (const t of [...g, ...im]) {
    const frr = g.filter((x) => x < t).length / g.length;
    const far = im.filter((x) => x >= t).length / im.length;
    if (Math.abs(frr - far) < best.gap) best = { threshold: t, frr, far, gap: Math.abs(frr - far) };
  }
  return { threshold: round3(best.threshold), frr: best.frr, far: best.far, separated: false };
}
