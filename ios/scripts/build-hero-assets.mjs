// Regenerates the bundled iOS hero sprites + catalog from the web app's shared
// LPC assets. Run from anywhere: `node ios/scripts/build-hero-assets.mjs`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lpcDir = path.join(root, "artifacts/focusquest/public/lpc");
const catalogTs = path.join(root, "artifacts/focusquest/src/lib/hero/catalog.ts");
const outDir = path.join(root, "ios/FocusQuest/Resources/HeroSprites");

fs.mkdirSync(outDir, { recursive: true });

// Extract the CATALOG array literal (keys/values are quoted → valid JSON).
const ts = fs.readFileSync(catalogTs, "utf8");
const eq = ts.indexOf("= [", ts.indexOf("CATALOG")); const start = ts.indexOf("[", eq);
const end = ts.indexOf("];", start);
const arr = JSON.parse(ts.slice(start, end + 1));

// file "/lpc/body/male_light.png" -> resource "body__male_light"
const resName = (file) => {
  const rel = file.replace(/^\/lpc\//, "");        // body/male_light.png
  return rel.replace(/\.png$/, "").replace(/\//g, "__");
};

const out = arr.map((e) => ({
  id: e.id,
  category: e.category,
  zIndex: e.zIndex,
  res: resName(e.file),
}));

fs.writeFileSync(path.join(outDir, "catalog.json"), JSON.stringify(out, null, 0));
console.log(`catalog.json: ${out.length} entries`);

// Copy every PNG with its flattened name.
let copied = 0;
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { walk(full); continue; }
    if (!name.endsWith(".png")) continue;
    const rel = path.relative(lpcDir, full).replace(/\.png$/, "").replace(/\//g, "__");
    fs.copyFileSync(full, path.join(outDir, `${rel}.png`));
    copied++;
  }
};
walk(lpcDir);
console.log(`copied ${copied} PNGs to ${outDir}`);
