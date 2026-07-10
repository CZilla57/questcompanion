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
const Z = { aura: 5, body: 10, hair: 30, outfit: 40, boots: 50, armor: 60, helmet: 70, weapon: 80, accessory: 90 };
const GEAR_Z = { boots: Z.boots, armor: Z.armor, helmet: Z.helmet, weapon: Z.weapon, accessory: Z.accessory };

// A clothing/gear part: a def path (relative to sheet_definitions/) + optional color variant.
// Use { male, female } when a def only covers one body type and a per-build override is needed.
type DefRef = { def: string; variant?: string };
type PartRef = DefRef | { male: DefRef; female: DefRef };
const perBuild = (r: PartRef, build) => ("def" in r ? r : r[build]);

const defCache = new Map();
async function fetchDef(defPath) {
  if (!defCache.has(defPath)) defCache.set(defPath, await fetchJson(`${RAW}/sheet_definitions/${defPath}`));
  return defCache.get(defPath);
}
const defCredit = (def) => {
  const cs = def.credits ?? [];
  const authors = [...new Set(cs.flatMap((c) => c.authors ?? []))];
  const licenses = [...new Set(cs.flatMap((c) => c.licenses ?? []))];
  const sourceUrl = cs.flatMap((c) => c.urls ?? [])[0] ?? "";
  return { author: authors.join("; "), license: licenses.join(", "), sourceUrl };
};

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

// Load the south standing frame for a def's layer_1 for a given build.
//
// WRINKLE (confirmed empirically against the live repo during the Task 1 spike — this
// overrides the "{prefix}{variant}/walk.png" leaf assumed in the plan's LPC path model):
// a def with NO `variants` (recolor/palette-based, e.g. the longsleeve shirt) resolves at the
// bare `{prefix}walk.png`. A def WITH `variants` (e.g. pants, shoes, tunic, the sword) does NOT
// have a `{variant}/walk.png` subfolder — instead `walk` itself is a directory and the pre-colored
// sheet lives at `{prefix}walk/{variant}.png`. Confirmed via the GitHub contents API for
// legs/pants, feet/shoes/basic, torso/clothes/tunic, and weapon/sword/arming (male + female).
async function loadDefFrame({ def: defPath, variant }, build) {
  const def = await fetchDef(defPath);
  const layer = def.layer_1;
  const prefix = layer[build];
  if (!prefix) throw new Error(`def ${defPath} has no '${build}' layer — supply a per-build override in the manifest`);
  const url = variant ? `${RAW}/spritesheets/${prefix}walk/${variant}.png` : `${RAW}/spritesheets/${prefix}walk.png`;
  const sheet = await loadSheet(url);
  if (!sheet) throw new Error(`no sheet at ${url} for def ${defPath} (build ${build}) — check variant/leaf path`);
  return { frame: cropSouth(sheet), credit: defCredit(def), zPos: layer.zPos };
}

// Union author/license/url across the parts of a baked sprite.
function mergeCredits(creds) {
  return {
    author: [...new Set(creds.flatMap((c) => c.author.split("; ")).filter(Boolean))].join("; "),
    license: [...new Set(creds.flatMap((c) => c.license.split(", ")).filter(Boolean))].join(", "),
    sourceUrl: creds.find((c) => c.sourceUrl)?.sourceUrl ?? "",
  };
}

// Shared with main()'s body/hair loops — populated across the whole build, emitted to catalog.ts at the end.
const entries = [];
// Attribution rows for outfit/gear parts, collected alongside `entries` and appended to CREDITS.csv.
const gearCreditRows = [];

// Composite an ordered list of parts (feet, legs, torso...) into one baked outfit sprite per build.
async function buildOutfit(cls, tier, parts /* PartRef[] in draw order: feet→legs→torso */) {
  for (const build of BUILDS) {
    let img = new PNG({ width: 64, height: 64 }); // transparent base
    const creds = [];
    for (const part of parts) {
      const { frame, credit } = await loadDefFrame(perBuild(part, build), build);
      img = over(img, frame);
      creds.push(credit);
    }
    writePng("outfit", `${cls}_t${tier}_${build}`, img);
    const c = mergeCredits(creds);
    entries.push({ id: `outfit:${cls}:t${tier}:${build}`, category: "outfit", zIndex: Z.outfit, file: `/lpc/outfit/${cls}_t${tier}_${build}.png`, ...c });
    gearCreditRows.push([`outfit/${cls}_t${tier}_${build}`, c.author, c.license, c.sourceUrl]);
  }
  console.log(`✓ outfit ${cls} t${tier}`);
}

// Export a single gear archetype shape per build. Rarity tint is applied at runtime.
async function buildGear(spriteId, category, part /* PartRef */) {
  for (const build of BUILDS) {
    const { frame, credit } = await loadDefFrame(perBuild(part, build), build);
    writePng("gear", `${spriteId}_${build}`, frame);
    entries.push({ id: `gear:${spriteId}:${build}`, category, zIndex: GEAR_Z[category], file: `/lpc/gear/${spriteId}_${build}.png`, ...credit });
    gearCreditRows.push([`gear/${spriteId}_${build}`, credit.author, credit.license, credit.sourceUrl]);
  }
  console.log(`✓ gear ${spriteId} (${category})`);
}

async function main() {
  mkdirSync(join(LPC_OUT, "body"), { recursive: true });
  mkdirSync(join(LPC_OUT, "hair"), { recursive: true });
  mkdirSync(join(LPC_OUT, "outfit"), { recursive: true });
  mkdirSync(join(LPC_OUT, "gear"), { recursive: true });

  const bodyPal = await fetchJson(`${RAW}/tools/palettes/ulpc-body-palettes.json`);
  const hairPal = await fetchJson(`${RAW}/tools/palettes/ulpc-hair-palettes.json`);
  const hairColorMap = {};
  for (const [ours, cands] of Object.entries(HAIR_COLOR_CANDS)) hairColorMap[ours] = cands.find((c) => hairPal[c]) || null;

  let eyes = await loadSheet(`${RAW}/spritesheets/eyes/human/adult/default/walk.png`);
  if (!eyes) eyes = await loadSheet(`${RAW}/spritesheets/eyes/human/adult/neutral/walk.png`);
  const eyeLayer = eyes ? cropSouth(eyes) : null;
  if (!eyeLayer) throw new Error("eyes layer failed to load");

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

  // --- SPIKE manifest (fighter t0 + sword). Expanded in Tasks 2–3. ---
  await buildOutfit("fighter", 0, [
    { def: "feet/shoes/feet_shoes_basic.json", variant: "brown" },
    { def: "legs/pants/legs_pants.json", variant: "brown" },
    { def: "torso/shirts/longsleeve/torso_clothes_longsleeve.json" },
  ]);
  await buildGear("sword", "weapon", { def: "weapons/sword/weapon_sword_arming.json", variant: "steel" });

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
  for (const [asset, author, license, sourceUrl] of gearCreditRows) {
    credRows.push([asset, author.replace(/; /g, " | "), license.replace(/, /g, " | "), sourceUrl]);
  }
  const preamble = `# Character art: Universal LPC Spritesheet (art assets only, not generator code).\n` +
    `# Full per-asset credits: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/CREDITS.csv\n`;
  writeFileSync(CREDITS_OUT, preamble + credRows.map((r) => r.map(csv).join(",")).join("\n") + "\n");

  console.log(`\nDONE: ${entries.length} assets → public/lpc; catalog.ts + CREDITS.csv written.`);
}
main().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
