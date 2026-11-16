// Run: npm run pack:extension            (the site download, files inside a folder)
//      npm run pack:extension -- --store  (for the Chrome Web Store: manifest.json at the top level)
// Zips extension/ into public/scammers-view-extension.zip, the file the landing page's
// "Get the extension" button downloads. Re-run after changing anything under extension/.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const SRC = "extension";
const STORE = process.argv.includes("--store");
const ROOT = STORE ? "" : "scammers-view-extension/";
const OUT = STORE ? "scammers-view-extension-store.zip" : "public/scammers-view-extension.zip";

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

// A fixed date keeps the zip identical when the files are, so it only changes in git when the extension does.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const local = [];
const central = [];
let offset = 0;
for (const file of walk(SRC)) {
  const name = Buffer.from(`${ROOT}${relative(SRC, file).split(sep).join("/")}`, "utf8");
  const data = readFileSync(file);
  const packed = deflateRawSync(data, { level: 9 });
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0x0800, 6);
  head.writeUInt16LE(8, 8);
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(crc32(data), 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(name.length, 26);
  local.push(head, name, packed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  head.copy(entry, 8, 6, 30);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += head.length + name.length + packed.length;
}

const dir = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(dir.length, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(OUT, Buffer.concat([...local, dir, end]));
console.log(`Wrote ${OUT}: ${central.length / 2} files, ${Math.round((offset + dir.length + 22) / 1024)} KB`);
