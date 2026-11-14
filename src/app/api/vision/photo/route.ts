import { handleVision } from "@/lib/vision/http";
import { analysePhoto } from "@/lib/vision/photo";
import { PhotoRequest } from "@/lib/vision/schema";

/**
 * POST /api/vision/photo { findingId, imageUrl, sourceUrl? }
 * Reads what a photo (already face-matched to the user ON THEIR DEVICE) reveals,
 * with Gemini. Signed-in only. The image is fetched with the face relay's SSRF
 * rules and never stored. Gemini is told never to identify anyone.
 */
export const maxDuration = 60;

export function POST(request: Request) {
  return handleVision(request, "photo", PhotoRequest, (req, signal) => analysePhoto(req, signal));
}
