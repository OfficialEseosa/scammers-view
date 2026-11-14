import { NextResponse } from "next/server";
import { z } from "zod";
import { Finding } from "@/lib/types";
import { getScanSubject } from "@/lib/auth/subject";
import { generateScript } from "@/lib/voice/script";
import { createVoicemailAudio, VoiceError } from "@/lib/voice/pipeline";

export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const recent = new Map<string, number[]>(); // best-effort, per-instance limiter
const LIMIT = 6;
const WINDOW_MS = 60 * 60 * 1000;

function limited(email: string): boolean {
  const now = Date.now();
  const hits = (recent.get(email) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= LIMIT) return true;
  hits.push(now);
  recent.set(email, hits);
  return false;
}

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const subject = await getScanSubject();
  if (!subject) return json({ error: "unauthorized", message: "Sign in to try this." }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "bad_request", message: "Could not read the recording." }, 400);
  }
  if (form.get("consent") !== "yes") return json({ error: "consent_required", message: "Consent is required." }, 400);

  const sample = form.get("sample");
  if (!(sample instanceof Blob) || sample.size < 2_000) {
    return json({ error: "bad_sample", message: "The recording was empty." }, 400);
  }
  if (sample.size > MAX_BYTES) return json({ error: "bad_sample", message: "The recording is too large." }, 413);
  if (!/^(audio\/|video\/(webm|mp4))/.test(sample.type)) {
    return json({ error: "bad_sample", message: "Unsupported recording type." }, 415);
  }

  let findings: Finding[] = [];
  try {
    findings = z.array(Finding).max(60).parse(JSON.parse(String(form.get("findings") ?? "[]")));
  } catch {
    return json({ error: "bad_request", message: "Invalid findings." }, 400);
  }

  if (limited(subject.email)) {
    return json({ error: "rate_limited", message: "Practice voicemail is limited to a few tries per hour." }, 429);
  }

  const script = await generateScript(findings, subject.name);
  const meta = { text: script.text, uses: script.uses };

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return json(
      { error: "voice_not_configured", message: "Voice generation isn't set up on this server yet.", script: meta },
      503,
    );
  }

  try {
    const ext = sample.type.includes("mp4") ? "m4a" : sample.type.includes("ogg") ? "ogg" : "webm";
    const { audio, contentType } = await createVoicemailAudio({
      apiKey,
      sample,
      sampleFilename: `sample.${ext}`,
      text: script.text,
      onDelete: (result) => {
        if (result === "failed") console.error("[voice] clone deletion failed; remove it in the ElevenLabs dashboard");
      },
    });
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "Content-Disposition": "inline",
        "X-Voicemail-Script": encodeURIComponent(JSON.stringify(meta)),
      },
    });
  } catch (e) {
    const status = e instanceof VoiceError ? e.status : undefined;
    console.error("[voice] pipeline failed", e instanceof VoiceError ? `${e.code} ${status ?? ""}` : "unknown");
    const planIssue = status === 401 || status === 402 || status === 403;
    return json(
      {
        error: planIssue ? "voice_unavailable" : "voice_failed",
        message: planIssue
          ? "The voice service refused the request. Instant voice cloning needs a paid ElevenLabs plan and a key with voice permissions."
          : "Couldn't generate the voicemail. Try recording again.",
        script: meta,
      },
      502,
    );
  }
}
