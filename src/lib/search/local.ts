import { CUES } from "./cues";
import { fixDocs, patternDocs } from "./docs";
import type { FixHit, PatternHit, ScamSearch } from "./types";

/** Idf-weighted token overlap over the reference documents, plus cue boosts. */

const STOP = new Set(
  "a an and are as at be by for from has have i if in into is it its me my no not of on or our so that the their them then there they this to was we were will with you your yours".split(" "),
);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

interface Indexed<T> {
  doc: T;
  terms: Set<string>;
}

function build<T>(docs: T[], text: (d: T) => string) {
  const items: Indexed<T>[] = docs.map((doc) => ({ doc, terms: new Set(tokens(text(doc))) }));
  const df = new Map<string, number>();
  for (const it of items) for (const t of it.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + items.length / (df.get(t) ?? items.length));
  return (query: string) => {
    const q = new Set(tokens(query));
    return items.map((it) => {
      let s = 0;
      for (const t of q) if (it.terms.has(t)) s += idf(t);
      return { doc: it.doc, raw: s };
    });
  };
}

const normalise = <T extends { raw: number }>(rows: T[]) => {
  const max = Math.max(0, ...rows.map((r) => r.raw));
  return rows.map((r) => ({ ...r, score: max > 0 ? r.raw / max : 0 }));
};

let patternIndex: ReturnType<typeof build<ReturnType<typeof patternDocs>[number]>> | null = null;
let fixIndex: ReturnType<typeof build<ReturnType<typeof fixDocs>[number]>> | null = null;

export const localSearch: ScamSearch = {
  name: "local",
  async searchPatterns(text, limit) {
    patternIndex ??= build(patternDocs(), (d) => [d.name, d.tagline, d.opener, ...d.red_flags, d.action].join(" "));
    const rows = patternIndex(text);
    const cueBoost = new Map<string, number>();
    for (const c of CUES) {
      c.re.lastIndex = 0;
      if (!c.re.test(text)) continue;
      for (const p of c.patterns) cueBoost.set(p, (cueBoost.get(p) ?? 0) + 1.5);
    }
    const scored = normalise(rows.map((r) => ({ ...r, raw: r.raw + (cueBoost.get(r.doc.id) ?? 0) })));
    return scored
      .filter((r) => r.raw > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r): PatternHit => ({ id: r.doc.id, score: Math.round(r.score * 100) / 100 }));
  },
  async searchFixes(query, limit) {
    fixIndex ??= build(fixDocs(), (d) => [d.title, ...d.keywords, ...d.steps].join(" "));
    return normalise(fixIndex(query))
      .filter((r) => r.raw > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r): FixHit => ({ id: r.doc.id, kind: r.doc.kind, title: r.doc.title, link: r.doc.link, score: Math.round(r.score * 100) / 100 }));
  },
};
