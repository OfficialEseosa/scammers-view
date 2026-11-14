import { createHash } from "crypto";
import type { FindingCollector } from "./findings";

/**
 * Gravatar avatars for the subject's own email addresses (public, no login):
 * a photo candidate anchored by email. Only checks existence (d=404).
 */
export async function addGravatarPhotos(emails: string[], collector: FindingCollector, signal: AbortSignal): Promise<number> {
  let n = 0;
  await Promise.all(
    [...new Set(emails.map((e) => e.trim().toLowerCase()))].slice(0, 4).map(async (email) => {
      const hash = createHash("sha256").update(email).digest("hex");
      const url = `https://gravatar.com/avatar/${hash}?s=400&d=404`;
      try {
        const res = await fetch(url, { method: "HEAD", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), cache: "no-store", redirect: "follow" });
        if (!res.ok) return;
        const r = await collector.add(
          { category: "photo", label: "Gravatar profile picture", value: `Avatar registered to ${email}`, sourceType: "other", sourceUrl: `https://gravatar.com/${hash}`, imageUrl: url.replace("&d=404", ""), anchor: "email", confidence: 0.85, riskWeight: 3 },
          "photos",
        );
        if (r.ok) n++;
      } catch {
        /* not found or timed out */
      }
    }),
  );
  return n;
}
