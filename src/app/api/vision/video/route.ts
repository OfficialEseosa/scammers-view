import { handleVision } from "@/lib/vision/http";
import { labVideoDeps } from "@/lib/vision/labFixture";
import { VideoRequest } from "@/lib/vision/schema";
import { analyseVideo } from "@/lib/vision/video";

/**
 * POST /api/vision/video { findingId, mediaUrl, sourceUrl?, durationSec?, anchor? }
 * Watches and listens to the user's own public video with Gemini. Signed-in only.
 * Media host allowlist + SSRF rules from the voice relay; the Files API upload
 * is deleted in a finally block. Over-limit videos come back as { skipped }.
 */
export const maxDuration = 150;

export function POST(request: Request) {
  return handleVision(request, "video", VideoRequest, (req, signal) => analyseVideo(req, signal, labVideoDeps(req.mediaUrl)));
}
