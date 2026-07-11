// One-off asset generator for the PWA icon set.
// Preferred source: public/icons/source.png (a square, full-bleed PNG, >=512px).
// Fallback: rasterize public/favicon.svg so the icons exist even before final art.
// Re-run after dropping in real art: `pnpm --filter @workspace/focusquest gen:icons`.
import sharp from "sharp";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const iconsDir = path.join(root, "public", "icons");
const sourcePng = path.join(iconsDir, "source.png");
const faviconSvg = path.join(root, "public", "favicon.svg");
const BG = "#090b15"; // app --background

async function loadSource() {
  if (existsSync(sourcePng)) {
    console.log("Using source.png");
    return sharp(sourcePng);
  }
  console.log("source.png not found — rasterizing favicon.svg as a placeholder");
  // density lifts the 180px SVG to a crisp 1024px raster.
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
// Android adaptive-icon cropping).
const inner = await src.clone().resize(410, 410, { fit: "cover" }).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(path.join(iconsDir, "icon-512-maskable.png"));
console.log("wrote icon-512-maskable.png");
