/**
 * The user's reference voice, in memory only: no localStorage, IndexedDB,
 * Cache Storage, cookies or network. A reload wipes it; clearVoiceData()
 * wipes it sooner (End session, leaving the page).
 *
 * The raw sample is the live recording from the voicemail step (or the
 * exposure check's own recording). Once a voiceprint is computed from it the
 * sample is dropped and only the embedding (256 floats) is kept.
 */

let sample: Blob | null = null;
let embedding: Float32Array | null = null;
let version = 0;
const listeners = new Set<() => void>();

const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

/** A new live recording replaces any previous sample and voiceprint. */
export function setVoiceSample(blob: Blob | null) {
  sample = blob;
  if (embedding) embedding.fill(0);
  embedding = null;
  notify();
}

export function getVoiceSample(): Blob | null {
  return sample;
}

/** Keep the voiceprint and drop the raw recording it came from. */
export function setVoiceEmbedding(e: Float32Array) {
  if (embedding && embedding !== e) embedding.fill(0);
  embedding = e;
  sample = null;
  notify();
}

export function getVoiceEmbedding(): Float32Array | null {
  return embedding;
}

export function hasVoiceReference(): boolean {
  return !!(sample || embedding);
}

/** Changes whenever the reference changes (for useSyncExternalStore). */
export function voiceVersion(): number {
  return version;
}

export function subscribeVoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget the sample and voiceprint. */
export function clearVoiceData() {
  sample = null;
  if (embedding) embedding.fill(0);
  embedding = null;
  notify();
}
