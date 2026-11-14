/**
 * ElevenLabs voicemail pipeline. Relative imports only, so it can be
 * exercised outside Next (see pipeline.check.ts).
 *
 * Docs coded against:
 *  - POST   /v1/voices/add            (instant voice clone, multipart name+files)
 *  - POST   /v1/text-to-speech/{id}   (JSON body, returns audio bytes)
 *  - DELETE /v1/voices/{id}
 * Auth: `xi-api-key` header.
 */

const BASE = "https://api.elevenlabs.io";

export class VoiceError extends Error {
  readonly code: "clone_failed" | "tts_failed";
  readonly status?: number;
  constructor(message: string, code: "clone_failed" | "tts_failed", status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type FetchLike = typeof fetch;

export interface PipelineOptions {
  apiKey: string;
  sample: Blob;
  sampleFilename: string;
  text: string;
  fetchImpl?: FetchLike;
  onDelete?: (result: "deleted" | "failed", voiceId: string) => void;
}

export async function createVoicemailAudio(opts: PipelineOptions): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const f = opts.fetchImpl ?? fetch;
  const headers = { "xi-api-key": opts.apiKey };
  let voiceId: string | null = null;
  try {
    const form = new FormData();
    form.set("name", `practice-${Date.now()}`);
    form.set("description", "Temporary practice clone; deleted immediately.");
    form.set("remove_background_noise", "true");
    form.append("files", opts.sample, opts.sampleFilename);
    const cloneRes = await f(`${BASE}/v1/voices/add`, { method: "POST", headers, body: form });
    if (!cloneRes.ok) throw new VoiceError("Voice clone was rejected.", "clone_failed", cloneRes.status);
    const cloneJson = (await cloneRes.json()) as { voice_id?: string };
    if (!cloneJson.voice_id) throw new VoiceError("Voice clone returned no id.", "clone_failed");
    voiceId = cloneJson.voice_id;

    const ttsRes = await f(`${BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text: opts.text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.4, similarity_boost: 0.85 },
      }),
    });
    if (!ttsRes.ok) throw new VoiceError("Speech generation failed.", "tts_failed", ttsRes.status);
    return { audio: await ttsRes.arrayBuffer(), contentType: ttsRes.headers.get("content-type") ?? "audio/mpeg" };
  } finally {
    if (voiceId) {
      const id = voiceId;
      let ok = false;
      // Retry once: a leaked clone is the worst failure mode here.
      for (let i = 0; i < 2 && !ok; i++) {
        try {
          const del = await f(`${BASE}/v1/voices/${encodeURIComponent(id)}`, { method: "DELETE", headers });
          ok = del.ok;
        } catch {
          ok = false;
        }
      }
      opts.onDelete?.(ok ? "deleted" : "failed", id);
    }
  }
}
