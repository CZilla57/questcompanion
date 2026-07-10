// @ts-nocheck
// AUTO-BUILD TOOL — fetches Universal LPC Spritesheet layers, crops the south standing
// frame, recolors via LPC palette ramps, composites body+head+eyes, and emits the
// focusquest hero assets + catalog + attribution.
//   run: pnpm --filter @workspace/scripts build-lpc
// LPC art is used under its per-asset licenses (OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0);
// see the generated public/lpc/CREDITS.csv. This tool vendors ART ONLY, never LPC code.
import pngjs from "pngjs";
const { PNG } = pngjs;
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FOCUS = join(ROOT, "artifacts", "focusquest");
const LPC_OUT = join(FOCUS, "public", "lpc");
const CATALOG_OUT = join(FOCUS, "src", "lib", "hero", "catalog.ts");
const CREDITS_OUT = join(LPC_OUT, "CREDITS.csv");
const RAW = "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master";

const BUILDS = ["male", "female"];
const SKIN_MAP = { light: "light", tan: "amber", brown: "brown", dark: "black", green: "green", blue: "blue" };
const HAIR_STYLE_MAP = { short: "plain", long: "long", ponytail: "ponytail", afro: "afro" };
const HAIR_COLOR_CANDS = {
  brown: ["brown", "light_brown", "dark_brown"], black: ["black", "raven"],
  blonde: ["blonde", "blond", "gold"], red: ["redhead", "red", "carrot", "ginger"],
  white: ["white", "platinum", "gray", "silver"], blue: ["blue", "navy"],
};
const Z = { body: 10, hair: 30 };

// Curated ULPC attribution (from sheet_definitions credit fields + the LPC base/hair OGA collections).
const CRED = {
  body: { authors: ["bluecarrot16", "JaidynReiman", "Benjamin K. Smith (BenCreating)", "ElizaWy"], licenses: ["OGA-BY 3.0", "CC-BY-SA 3.0", "GPL 3.0"], url: "https://opengameart.org/content/lpc-character-bases" },
  head: { authors: ["bluecarrot16", "JaidynReiman", "Benjamin K. Smith (BenCreating)", "ElizaWy"], licenses: ["OGA-BY 3.0", "CC-BY-SA 3.0", "GPL 3.0"], url: "https://opengameart.org/content/lpc-character-bases" },
  eyes: { authors: ["bluecarrot16", "ElizaWy", "Nila122"], licenses: ["CC-BY-SA 3.0", "GPL 3.0"], url: "https://opengameart.org/content/lpc-character-bases" },
  hair: { authors: ["bluecarrot16", "Manuel Riecke (MrBeast)", "JaidynReiman", "ElizaWy"], licenses: ["OGA-BY 3.0", "CC-BY-SA 3.0", "GPL 3.0"], url: "https://opengameart.org/content/lpc-hair" },
};
const merge = (...cs) => ({
  authors: [...new Set(cs.flatMap((c) => c.authors))],
  licenses: [...new Set(cs.flatMap((c) => c.licenses))],
  url: cs[0].url,
});
const BODY_CRED = merge(CRED.body, CRED.head, CRED.eyes);

async function fetchBuf(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return Buffer.from(await r.arrayBuffer()); }
async function fetchJson(url) { return (await fetch(url)).json(); }
const hexToRgb = (h) => { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const key = (r, g, b) => (r << 16) | (g << 8) | b;
async function loadSheet(url) { try { return PNG.sync.read(await fetchBuf(url)); } catch { return null; } }
function cropSouth(png) {
  const out = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const si = ((128 + y) * png.width + x) * 4, di = (y * 64 + x) * 4;
    out.data[di] = png.data[si]; out.data[di + 1] = png.data[si + 1]; out.data[di + 2] = png.data[si + 2]; out.data[di + 3] = png.data[si + 3];
  }
  return out;
}
function detectSource(png, palettes) {
  let best = null, bestN = -1;
  for (const k of Object.keys(palettes)) {
    const set = new Set(palettes[k].map((h) => { const [r, g, b] = hexToRgb(h); return key(r, g, b); }));
    let n = 0; for (let i = 0; i < png.data.length; i += 4) { if (png.data[i + 3] === 0) continue; if (set.has(key(png.data[i], png.data[i + 1], png.data[i + 2]))) n++; }
    if (n > bestN) { bestN = n; best = k; }
  }
  return best;
}
function recolor(png, srcRamp, dstRamp) {
  const lut = new Map();
  for (let i = 0; i < srcRamp.length && i < dstRamp.length; i++) { const [r, g, b] = hexToRgb(srcRamp[i]); lut.set(key(r, g, b), hexToRgb(dstRamp[i])); }
  const out = new PNG({ width: png.width, height: png.height }); png.data.copy(out.data);
  for (let i = 0; i < out.data.length; i += 4) { if (out.data[i + 3] === 0) continue; const t = lut.get(key(out.data[i], out.data[i + 1], out.data[i + 2])); if (t) { out.data[i] = t[0]; out.data[i + 1] = t[1]; out.data[i + 2] = t[2]; } }
  return out;
}
function over(base, top) {
  const out = new PNG({ width: 64, height: 64 }); base.data.copy(out.data);
  for (let i = 0; i < out.data.length; i += 4) { const ta = top.data[i + 3] / 255; if (ta === 0) continue; for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(top.data[i + c] * ta + out.data[i + c] * (1 - ta)); out.data[i + 3] = Math.max(out.data[i + 3], top.data[i + 3]); }
  return out;
}
const writePng = (dir, name, png) => writeFileSync(join(LPC_OUT, dir, name + ".png"), PNG.sync.write(png));
const csv = (s) => `"${String(s).replace(/"/g, '""')}"`;

async function main() {
  mkdirSync(join(LPC_OUT, "body"), { recursive: true });
  mkdirSync(join(LPC_OUT, "hair"), { recursive: true });

  const bodyPal = await fetchJson(`${RAW}/tools/palettes/ulpc-body-palettes.json`);
  const hairPal = await fetchJson(`${RAW}/tools/palettes/ulpc-hair-palettes.json`);
  const hairColorMap = {};
  for (const [ours, cands] of Object.entries(HAIR_COLOR_CANDS)) hairColorMap[ours] = cands.find((c) => hairPal[c]) || null;

  let eyes = await loadSheet(`${RAW}/spritesheets/eyes/human/adult/default/walk.png`);
  if (!eyes) eyes = await loadSheet(`${RAW}/spritesheets/eyes/human/adult/neutral/walk.png`);
  const eyeLayer = eyes ? cropSouth(eyes) : null;
  if (!eyeLayer) throw new Error("eyes layer failed to load");

  const entries = [];
  const cc = (c) => ({ author: c.authors.join("; "), license: c.licenses.join(", "), sourceUrl: c.url });

  // BODIES = body + head + eyes, recolored to the same skin tone
  for (const build of BUILDS) {
    const bodySheet = await loadSheet(`${RAW}/spritesheets/body/bodies/${build}/walk.png`);
    const headSheet = await loadSheet(`${RAW}/spritesheets/head/heads/human/${build}/walk.png`);
    if (!bodySheet || !headSheet) throw new Error(`missing body/head for ${build}`);
    const bodyBase = cropSouth(bodySheet), headBase = cropSouth(headSheet);
    const bodySrc = detectSource(bodyBase, bodyPal), headSrc = detectSource(headBase, bodyPal);
    for (const [ourSkin, variant] of Object.entries(SKIN_MAP)) {
      if (!bodyPal[variant]) throw new Error(`no body palette variant ${variant}`);
      let img = recolor(bodyBase, bodyPal[bodySrc], bodyPal[variant]);
      img = over(img, recolor(headBase, bodyPal[headSrc], bodyPal[variant]));
      img = over(img, eyeLayer);
      writePng("body", `${build}_${ourSkin}`, img);
      entries.push({ id: `body:${build}:${ourSkin}`, category: "body", zIndex: Z.body, file: `/lpc/body/${build}_${ourSkin}.png`, ...cc(BODY_CRED) });
    }
    console.log(`✓ bodies ${build} (6 tones)`);
  }

  // HAIR = style sheet recolored per color
  for (const [ourStyle, lpcStyle] of Object.entries(HAIR_STYLE_MAP)) {
    let sheet = await loadSheet(`${RAW}/spritesheets/hair/${lpcStyle}/adult/walk.png`);
    if (!sheet) sheet = await loadSheet(`${RAW}/spritesheets/hair/${lpcStyle}/adult/fg/walk.png`);
    if (!sheet) throw new Error(`missing hair ${lpcStyle}`);
    const base = cropSouth(sheet), src = detectSource(base, hairPal);
    for (const [ourColor, variant] of Object.entries(hairColorMap)) {
      if (!variant) throw new Error(`no hair palette variant for ${ourColor}`);
      writePng("hair", `${ourStyle}_${ourColor}`, recolor(base, hairPal[src], hairPal[variant]));
      entries.push({ id: `hair:${ourStyle}:${ourColor}`, category: "hair", zIndex: Z.hair, file: `/lpc/hair/${ourStyle}_${ourColor}.png`, ...cc(CRED.hair) });
    }
    console.log(`✓ hair ${ourStyle} (6 colors)`);
  }

  // catalog.ts
  const catalogTs = `// AUTO-GENERATED by scripts/src/build-lpc-assets.ts — do not edit by hand.\n` +
    `// Regenerate with: pnpm --filter @workspace/scripts build-lpc\n` +
    `import type { CatalogEntry } from "./types";\n\n` +
    `export const CATALOG: CatalogEntry[] = ${JSON.stringify(entries, null, 2)};\n\n` +
    `export const catalogById: Map<string, CatalogEntry> = new Map(\n  CATALOG.map((e) => [e.id, e]),\n);\n`;
  writeFileSync(CATALOG_OUT, catalogTs);

  // CREDITS.csv
  const credRows = [["asset", "authors", "licenses", "source_url"]];
  credRows.push(["body+head+eyes", BODY_CRED.authors.join(" | "), BODY_CRED.licenses.join(" | "), BODY_CRED.url]);
  credRows.push(["hair", CRED.hair.authors.join(" | "), CRED.hair.licenses.join(" | "), CRED.hair.url]);
  const preamble = `# Character art: Universal LPC Spritesheet (art assets only, not generator code).\n` +
    `# Full per-asset credits: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/CREDITS.csv\n`;
  writeFileSync(CREDITS_OUT, preamble + credRows.map((r) => r.map(csv).join(",")).join("\n") + "\n");

  console.log(`\nDONE: ${entries.length} assets → public/lpc; catalog.ts + CREDITS.csv written.`);
}
main().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
