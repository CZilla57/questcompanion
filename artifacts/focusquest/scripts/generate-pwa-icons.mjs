// One-off asset generator for the PWA icon set.
// Preferred source: scripts/pwa-icon-source.png (a square, full-bleed PNG, >=512px).
//   Kept in scripts/ (NOT public/) so the source art is committed for reproducible
//   regeneration but never bundled into the shipped build.
// Fallback: rasterize public/favicon.svg so the icons exist even before final art.
// Re-run after dropping in real art: `pnpm --filter @workspace/focusquest gen:icons`.
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const iconsDir = path.join(root, "public", "icons");
const sourcePng = path.join(root, "scripts", "pwa-icon-source.png");
const faviconSvg = path.join(root, "public", "favicon.svg");
const BG = "#090b15"; // app --background

mkdirSync(iconsDir, { recursive: true });

async function loadSource() {
  if (existsSync(sourcePng)) {
    console.log("Using scripts/pwa-icon-source.png");
    return sharp(sourcePng);
  }
  console.log("source art not found — rasterizing favicon.svg as a placeholder");
  // Rasterizes the 180px favicon.svg at high density (~960px), then the
  // .resize below normalizes the buffer up to a clean 1024x1024.
  const buf = await sharp(faviconSvg, { density: 384 })
    .resize(1024, 1024, { fit: "cover" })
    .png()
    .toBuffer();
  return sharp(buf);
}

async function square(src, size, file) {
  await src.clone().resize(size, size, { fit: "cover" }).png().toFile(path.join(iconsDir, file));
  console.log("wrote", file);
}

const src = await loadSource();

await square(src, 192, "icon-192.png");
await square(src, 512, "icon-512.png");
await square(src, 180, "apple-touch-icon.png");

// Maskable: source at ~80% centered on a solid #090b15 field (safe zone for
// Android adaptive-icon cropping). 408/512 leaves 52px/side (~10.16%
// padding), satisfying the >=10% safe-zone requirement.
const inner = await src.clone().resize(408, 408, { fit: "cover" }).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(path.join(iconsDir, "icon-512-maskable.png"));
console.log("wrote icon-512-maskable.png");
