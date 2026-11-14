// Run: node --experimental-strip-types src/lib/voice/pipeline.check.ts
import assert from "node:assert/strict";
// @ts-expect-error node strip-types needs the .ts extension; tsc does not allow it
import { createVoicemailAudio } from "./pipeline.ts";

function mock(ttsOk: boolean, cloneOk = true) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${new URL(url).pathname}`);
    if (url.endsWith("/v1/voices/add")) return cloneOk ? Response.json({ voice_id: "v123" }) : new Response("no", { status: 401 });
    if (url.includes("/text-to-speech/")) return ttsOk ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }) : new Response("x", { status: 500 });
    if (method === "DELETE") return Response.json({ status: "ok" });
    return new Response("?", { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const base = { apiKey: "k", sample: new Blob(["a"]), sampleFilename: "s.webm", text: "hi" };

{
  const m = mock(true);
  const r = await createVoicemailAudio({ ...base, fetchImpl: m.fetchImpl });
  assert.equal(r.audio.byteLength, 3);
  assert.deepEqual(m.calls, ["POST /v1/voices/add", "POST /v1/text-to-speech/v123", "DELETE /v1/voices/v123"]);
}
{
  const m = mock(false);
  await assert.rejects(createVoicemailAudio({ ...base, fetchImpl: m.fetchImpl }));
  assert.equal(m.calls.at(-1), "DELETE /v1/voices/v123");
}
{
  const m = mock(true, false);
  await assert.rejects(createVoicemailAudio({ ...base, fetchImpl: m.fetchImpl }));
  assert.equal(m.calls.some((c) => c.startsWith("DELETE")), false); // nothing to delete
}
console.log("pipeline checks passed: delete runs on success and on TTS failure");
