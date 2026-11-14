/*
 * Temporary ElevenLabs clone for the family drill (same endpoints as src/lib/voice/pipeline.ts):
 *  - POST   /v1/voices/add   (instant voice clone, multipart name+files)
 *  - DELETE /v1/voices/{id}
 * The clone exists only for the length of one call.
 */

const BASE = "https://api.elevenlabs.io";

export async function cloneVoice(sample: { base64: string; type: string }): Promise<string | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const form = new FormData();
  form.set("name", `practice-call-${Date.now()}`);
  form.set("description", "Temporary practice-call clone; deleted when the call ends.");
  form.set("remove_background_noise", "true");
  const ext = sample.type.includes("mp4") ? "m4a" : sample.type.includes("ogg") ? "ogg" : "webm";
  form.append("files", new Blob([Buffer.from(sample.base64, "base64")], { type: sample.type }), `sample.${ext}`);
  const res = await fetch(`${BASE}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": key }, body: form });
  if (!res.ok) return null;
  const json = (await res.json()) as { voice_id?: string };
  return json.voice_id ?? null;
}

export async function deleteVoice(voiceId: string): Promise<boolean> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return false;
  const res = await fetch(`${BASE}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", headers: { "xi-api-key": key } }).catch(() => null);
  return Boolean(res?.ok);
}
