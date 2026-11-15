import { connection } from "next/server";
import { getScanSubject } from "@/lib/auth/subject";
import { isLlmConfigured, LlmBillingError, LlmNotConfiguredError } from "@/lib/llm/gemini";
import type { ScanEvent } from "@/lib/types";
import { runScan } from "@/lib/scan/orchestrator";
import { Recorder, replay } from "@/lib/scan/recording";
import { takeScan } from "@/lib/scan/quota";

const GEMINI_NOT_CONFIGURED = "Gemini is not configured: set GEMINI_API_KEY on the server to run a live scan.";

// Scans run several agents in parallel and can take a few minutes.
export const maxDuration = 300;

/**
 * GET /api/scan — Server-Sent Events stream of ScanEvents.
 * The scan target comes ONLY from getScanSubject() (the signed-in user);
 * nothing in the request (query, body, headers) can choose who is scanned.
 */
export async function GET(request: Request) {
  await connection();
  const subject = await getScanSubject();
  if (!subject) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const replaySpec = process.env.SCAN_REPLAY;
  const recorder = !replaySpec && process.env.SCAN_RECORD === "1" ? new Recorder() : null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
          abort.abort();
        }
      };
      const emit = (event: ScanEvent) => {
        if (abort.signal.aborted) return;
        recorder?.push(event);
        write(`data: ${JSON.stringify(event)}\n\n`);
      };
      // Keep proxies from timing out during long silent search turns.
      const heartbeat = setInterval(() => write(": keepalive\n\n"), 15_000);
      write(": connected\n\n");

      let ran = false;
      (async () => {
        try {
          if (replaySpec) {
            // Replay needs no model key.
            await replay(replaySpec, emit, abort.signal);
          } else if (!isLlmConfigured()) {
            emit({ type: "error", message: GEMINI_NOT_CONFIGURED });
            return;
          } else {
            // A fresh scan costs money: a few a day per person, kept on their device in between.
            const allowed = await takeScan(subject.email);
            if (!allowed.ok) {
              emit({ type: "error", message: `You have used today's ${allowed.quota.limit} scans. Your saved results are still on this device. Try again tomorrow.` });
              return;
            }
            ran = true;
            const final = await runScan(subject, emit, abort.signal);
            if (final) recorder?.setFinal(final);
          }
          emit({ type: "done" });
        } catch (e) {
          if (e instanceof LlmNotConfiguredError) {
            emit({ type: "error", message: GEMINI_NOT_CONFIGURED });
          } else if (e instanceof LlmBillingError) {
            console.error("[scan] Gemini billing error:", e.status);
            emit({ type: "error", message: "Gemini billing problem: the project's prepaid credits are used up or billing is off. Top up in AI Studio, then try again." });
          } else if (!abort.signal.aborted) {
            console.error("[scan] failed:", e instanceof Error ? e.message : e);
            emit({ type: "error", message: "The scan failed. Please try again." });
          }
        } finally {
          clearInterval(heartbeat);
          if (recorder && ran) {
            try {
              const name = await recorder.save();
              console.log(`[scan] recorded to .cache/scans/${name}`);
            } catch (e) {
              console.error("[scan] could not save recording:", e instanceof Error ? e.message : e);
            }
          }
          if (!closed) {
            closed = true;
            try { controller.close(); } catch { /* already closed */ }
          }
        }
      })();
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
