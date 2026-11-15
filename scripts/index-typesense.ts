// Run: npm run index:typesense   (needs TYPESENSE_HOST and TYPESENSE_API_KEY, from the shell or .env.local)
// Rebuilds the scam_patterns, fixes and scam_cases collections from the reference data in the repo.
// Only reference data is indexed: no findings, no user, no pasted text.
import { existsSync } from "node:fs";
import { fixDocs, patternDocs } from "../src/lib/search/docs";
import { reindex, typesenseConfig } from "../src/lib/search/typesense";
import { reindexCases } from "../src/lib/cases/search";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const cfg = typesenseConfig();
if (!cfg) {
  console.error("Set TYPESENSE_HOST (e.g. http://localhost:8108) and TYPESENSE_API_KEY first.");
  process.exit(1);
}

const t0 = Date.now();
// `--cases` reloads only the real scam cases and leaves the other collections alone.
const casesOnly = process.argv.includes("--cases");
(casesOnly ? Promise.resolve({ patterns: 0, fixes: 0 }) : reindex(cfg, { patterns: patternDocs(), fixes: fixDocs() }))
  .then(async (n) => ({ ...n, cases: await reindexCases(cfg) }))
  .then((n) => console.log(`Indexed ${n.patterns} scam patterns, ${n.fixes} fixes and ${n.cases} real scam cases into ${cfg.host} in ${Date.now() - t0} ms.`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
