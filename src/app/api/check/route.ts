import { z } from "zod";
import { PATTERN_BY_ID } from "@/lib/campus/patterns";
import { CUES, findSpans, searchFixes, searchPatterns } from "@/lib/search";
import { PRACTICE_FOR_PATTERN } from "@/lib/call/schema";

const Body = z.union([
  z.object({ text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ fixQuery: z.string().trim().min(1).max(200) }).strict(),
]);

const NO_STORE = { "cache-control": "no-store" };

/**
 * "Is this a scam?" Compares pasted text with reference scam patterns (Typesense, or the local
 * scorer) and points at the warning signs in it. Open without sign-in: nothing personal is
 * involved, and the pasted text is never stored or logged.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Paste up to 4,000 characters." }, { status: 400, headers: NO_STORE });

  if ("fixQuery" in parsed.data) {
    const { engine, hits } = await searchFixes(parsed.data.fixQuery, 6);
    return Response.json({ engine, fixes: hits }, { headers: NO_STORE });
  }

  const text = parsed.data.text;
  const spans = findSpans(text);
  const cueIds = new Set(spans.map((s) => s.cueId));
  const { engine, hits } = await searchPatterns(text, 3);
  const matches = hits.map((h) => {
    const p = PATTERN_BY_ID[h.id];
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      score: h.score,
      signs: CUES.filter((c) => cueIds.has(c.id) && c.patterns.includes(p.id)).map((c) => c.why),
      redFlags: p.redFlags,
      action: p.action,
      report: p.report,
      practice: PRACTICE_FOR_PATTERN[p.id],
    };
  });
  const level = cueIds.size >= 3 ? "high" : cueIds.size >= 1 ? "some" : "low";
  return Response.json({ engine, level, spans, matches }, { headers: NO_STORE });
}
