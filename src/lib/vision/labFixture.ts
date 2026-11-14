import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Fetched } from "./fetch";
import type { VideoDeps } from "./video";

/**
 * Development only: lets /lab/photo-context run the real video path on the
 * repo's own fictional clip (public/fixtures/vision/*.mp4) instead of a
 * platform CDN. A fixed directory and a strict file-name pattern; never
 * active outside `next dev`.
 */
const LAB_PATH = /^\/fixtures\/vision\/([a-z0-9-]{1,40})\.mp4$/;

export function labVideoDeps(mediaUrl: string): VideoDeps {
  const m = LAB_PATH.exec(mediaUrl);
  if (process.env.NODE_ENV !== "development" || !m) return {};
  return {
    fetchVideo: async (): Promise<Fetched> => ({
      mimeType: "video/mp4",
      bytes: await readFile(path.join(process.cwd(), "public", "fixtures", "vision", `${m[1]}.mp4`)),
    }),
  };
}
