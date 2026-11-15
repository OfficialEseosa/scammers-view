// Run: npm run index:typesense   (needs TYPESENSE_HOST and TYPESENSE_API_KEY, from the shell or .env.local)
// Rebuilds the scam_patterns and fixes collections from the reference data in the repo.
// Only reference data is indexed: no findings, no user, no pasted text.
import { existsSync } from "node:fs";
import { fixDocs, patternDocs } from "../src/lib/search/docs";
import { reindex, typesenseConfig } from "../src/lib/search/typesense";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const cfg = typesenseConfig();
if (!cfg) {
  console.error("Set TYPESENSE_HOST (e.g. http://localhost:8108) and TYPESENSE_API_KEY first.");
  process.exit(1);
}

const t0 = Date.now();
reindex(cfg, { patterns: patternDocs(), fixes: fixDocs() })
  .then((n) => console.log(`Indexed ${n.patterns} scam patterns and ${n.fixes} fixes into ${cfg.host} in ${Date.now() - t0} ms.`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
