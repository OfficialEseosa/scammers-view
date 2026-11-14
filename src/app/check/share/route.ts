import { clientIp, takeCheck } from "@/lib/check/limits";
import { readScreenshot } from "@/lib/check/screenshot";
import { readShareForm } from "@/lib/check/share";
import { sharedHash, type Shared } from "@/lib/check/shared";

export const maxDuration = 30;

/**
 * Android share-sheet target (see app/manifest.ts). Reads the shared text, link or screenshot,
 * then hands the message to /check in the URL fragment so it never lands in a server log.
 * Nothing is stored.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return to({ note: "empty" });

  const ip = clientIp(request);
  const { text, shot } = readShareForm(form);

  if (shot) {
    if (!takeCheck("image", ip)) return to({ text: text || undefined, note: text ? undefined : "limit" });
    const read = await readScreenshot(shot, request.signal);
    if (read) return to({ text: [text, read].filter(Boolean).join("\n").trim() });
    return to(text ? { text } : { note: "paste" });
  }

  return to(text ? { text } : { note: "empty" });
}

function to(shared: Shared): Response {
  return new Response(null, { status: 303, headers: { location: `/check${sharedHash(shared)}`, "cache-control": "no-store" } });
}
