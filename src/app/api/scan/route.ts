import { connection } from "next/server";
import { getScanSubject } from "@/lib/auth/subject";
import type { ScanEvent } from "@/lib/types";
import { runScan } from "@/lib/scan/orchestrator";
import { Recorder, replay } from "@/lib/scan/recording";

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

      (async () => {
        try {
          if (replaySpec) {
            await replay(replaySpec, emit, abort.signal);
          } else {
            const final = await runScan(subject, emit, abort.signal);
            if (final) recorder?.setFinal(final);
          }
          emit({ type: "done" });
        } catch (e) {
          if (!abort.signal.aborted) {
            console.error("[scan] failed:", e instanceof Error ? e.message : e);
            emit({ type: "error", message: "The scan failed. Please try again." });
          }
        } finally {
          clearInterval(heartbeat);
          if (recorder) {
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
