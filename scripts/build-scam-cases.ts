// Run: npx tsx scripts/build-scam-cases.ts
// Turns the tagged source files in data/scam-cases/ into the compact list the app loads
// (src/lib/cases/cases.json). Only cases marked relevant and tagged are kept.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Raw {
  id: string;
  url: string;
  date: string;
  title: string;
  text: string;
  relevant?: boolean;
  scam_type?: string;
  channels?: string[];
  needs?: string[];
}

const DIR = "data/scam-cases";
const SOURCE: Record<string, string> = { "ic3-psa.json": "FBI IC3", "ftc-alerts.json": "FTC" };

function summary(text: string, title: string): string {
  let t = text.replace(/^##\s*/gm, "").replace(/\s+/g, " ").trim();
  if (t.toLowerCase().startsWith(title.toLowerCase())) t = t.slice(title.length).trim();
  if (t.length <= 520) return t;
  const cut = t.slice(0, 520);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return stop > 200 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

// One plain line per scam type: what happens, from the target's side. Search ranks against it.
const HOW = JSON.parse(readFileSync(join(DIR, "scam-types.json"), "utf8")) as Record<string, string>;

const out = [];
const seen = new Set<string>();
for (const file of readdirSync(DIR).filter((f) => f in SOURCE).sort()) {
  const { cases } = JSON.parse(readFileSync(join(DIR, file), "utf8")) as { cases: Raw[] };
  for (const c of cases) {
    if (!c.relevant || !c.scam_type || !c.needs?.length || !c.channels?.length) continue;
    const key = `${SOURCE[file]}:${c.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `${SOURCE[file] === "FTC" ? "ftc" : "ic3"}-${c.id}`.toLowerCase().slice(0, 120),
      source: SOURCE[file],
      url: c.url,
      year: Number(c.date.slice(0, 4)),
      title: c.title,
      summary: summary(c.text, c.title),
      scam_type: c.scam_type,
      how: HOW[c.scam_type] ?? "",
      channels: c.channels,
      needs: c.needs,
    });
  }
}
out.sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
writeFileSync("src/lib/cases/cases.json", `${JSON.stringify(out, null, 1)}\n`);
console.log(`Wrote ${out.length} cases to src/lib/cases/cases.json`);
