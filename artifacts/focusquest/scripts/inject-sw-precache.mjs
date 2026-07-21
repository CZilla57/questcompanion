// Post-build step (see package.json "build"): scans dist/public, injects the
// precached shell manifest into dist/public/sw.js. Source public/sw.js keeps
// hash "dev" so `vite dev` serves an inert worker. Assumes BASE_PATH=/ (what
// the Dockerfile deploys).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = 'const BUILD = { hash: "dev", assets: [] }; // replaced at build time by scripts/inject-sw-precache.mjs';
const SIZE_BUDGET_BYTES = 3 * 1024 * 1024;

// Shell only: the big art dirs (/lpc, /avatars, /kingdoms) and misc root
// files are deliberately absent — offline is capture-mode (spec §Part 1).
const ROOT_FILES = ["index.html", "manifest.webmanifest", "favicon.svg"];
const DIRS = ["assets", "icons"];

export function collectPrecache(distDir) {
  const assets = [];
  let totalBytes = 0;
  for (const f of ROOT_FILES) {
    assets.push(`/${f}`);
    totalBytes += statSync(path.join(distDir, f)).size;
  }
  for (const dir of DIRS) {
    for (const f of readdirSync(path.join(distDir, dir)).sort()) {
      assets.push(`/${dir}/${f}`);
      totalBytes += statSync(path.join(distDir, dir, f)).size;
    }
  }
  assets.sort();
  // Hashed bundle names make the list content-addressed — but index.html and
  // the manifest keep stable names, so their bytes join the hash too (a
  // meta-tag-only edit must still produce a fresh cache).
  const h = createHash("sha256");
  h.update(JSON.stringify(assets));
  h.update(readFileSync(path.join(distDir, "index.html")));
  h.update(readFileSync(path.join(distDir, "manifest.webmanifest")));
  return { assets, hash: h.digest("hex").slice(0, 12), totalBytes };
}

export function injectIntoSw(swSource, { hash, assets }) {
  if (!swSource.includes(MARKER)) {
    throw new Error("inject-sw-precache: BUILD marker line not found in sw.js — template drifted");
  }
  return swSource.replace(MARKER, `const BUILD = ${JSON.stringify({ hash, assets })};`);
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.resolve(here, "..", "dist", "public");
  const swPath = path.join(distDir, "sw.js");
  const manifest = collectPrecache(distDir);
  writeFileSync(swPath, injectIntoSw(readFileSync(swPath, "utf8"), manifest));
  const mb = (manifest.totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`sw precache: ${manifest.assets.length} files, ${mb} MB, hash ${manifest.hash}`);
  if (manifest.totalBytes > SIZE_BUDGET_BYTES) {
    console.warn(`sw precache: WARNING — shell exceeds the ${SIZE_BUDGET_BYTES / (1024 * 1024)} MB budget; check what grew`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
