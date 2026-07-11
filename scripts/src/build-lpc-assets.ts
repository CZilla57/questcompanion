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
import { SKIN_MAP, HAIR_STYLE_MAP, HAIR_COLOR_CANDS, BEARD_STYLE_MAP } from "./lpc-mapping";
import * as heroOptions from "@workspace/hero-options";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FOCUS = join(ROOT, "artifacts", "focusquest");
const LPC_OUT = join(FOCUS, "public", "lpc");
const CATALOG_OUT = join(FOCUS, "src", "lib", "hero", "catalog.ts");
const CREDITS_OUT = join(LPC_OUT, "CREDITS.csv");
const RAW = "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master";

const BUILDS = ["male", "female"];
const Z = { aura: 5, body: 10, earrings: 15, beard: 20, hair: 30, glasses: 35, outfit: 40, boots: 50, armor: 60, helmet: 70, weapon: 80, accessory: 90 };
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
  // Union of the real per-sheet CREDITS.csv rows for the 4 baked beard/mustache sheets (verified
  // via the live LPC repo's CREDITS.csv during Task 8 — see task-8-report.md):
  //   beard/5oclock_shadow/walk.png → JaidynReiman, Thane Brimhall (pennomi), laetissima; CC-BY-SA 3.0, GPL 3.0; lpc-base-character-expressions
  //   beard/trimmed/walk.png        → ElizaWy; OGA-BY 3.0; LPC Hair repo / lpc-expanded-sit-run-jump-more
  //   beard/winter/{male,female}    → bluecarrot16; CC0; lpc-santa
  //   mustache/basic/walk.png       → JaidynReiman, Carlo Enrico Victoria (Nemisys); CC-BY-SA 3.0, GPL 3.0; lpc-brunet-mustache
  beard: { authors: ["JaidynReiman", "Thane Brimhall (pennomi)", "laetissima", "ElizaWy", "bluecarrot16", "Carlo Enrico Victoria (Nemisys)"], licenses: ["CC-BY-SA 3.0", "GPL 3.0", "OGA-BY 3.0", "CC0"], url: "https://opengameart.org/content/lpc-base-character-expressions" },
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
// Count pixels with alpha > 0. A fully-blank sprite (0 opaque pixels) means the source def's
// south walk frame (y=128..191) had no content — e.g. the def's layer_1 pointed at a
// "background"-only sub-layer with the actual art in an unread layer_2 (the crossbow defect).
// Ship nothing invisible: fail the build loudly instead of silently writing a blank asset.
function countOpaquePixels(png) {
  let n = 0;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 0) n++;
  return n;
}
const writePng = (dir, name, png) => {
  if (countOpaquePixels(png) === 0) {
    throw new Error(`blank sprite: ${dir}/${name} has no opaque pixels — check the source def's south frame`);
  }
  writeFileSync(join(LPC_OUT, dir, name + ".png"), PNG.sync.write(png));
};
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

// Fail the build if hero-options advertises an id the pipeline never baked.
function assertCoverage() {
  const built = new Set(entries.map((e) => e.id));
  const miss: string[] = [];
  for (const b of heroOptions.builds)
    for (const s of heroOptions.skins)
      if (!built.has(`body:${b.id}:${s.id}`)) miss.push(`body:${b.id}:${s.id}`);
  for (const st of heroOptions.hairStyles) {
    if (st.id === "bald") continue; // bald = no hair layer
    for (const c of heroOptions.hairColors)
      if (!built.has(`hair:${st.id}:${c.id}`)) miss.push(`hair:${st.id}:${c.id}`);
  }
  for (const st of heroOptions.beardStyles) {
    if (st.id === "none") continue;
    for (const c of heroOptions.beardColors)
      if (!built.has(`beard:${st.id}:${c.id}`)) miss.push(`beard:${st.id}:${c.id}`);
  }
  if (miss.length) throw new Error(`coverage gap — hero-options ids with no baked sprite:\n  ${miss.join("\n  ")}`);
}

async function main() {
  mkdirSync(join(LPC_OUT, "body"), { recursive: true });
  mkdirSync(join(LPC_OUT, "hair"), { recursive: true });
  mkdirSync(join(LPC_OUT, "beard"), { recursive: true });
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

  // BEARD = style sheet recolored per beard color (shares the hair palette). Real leaf paths
  // verified against the live repo during Task 8 (spritesheets/beards/{beard,mustache}/...) —
  // see BEARD_STYLE_MAP in lpc-mapping.ts for the per-style folder and why 'goatee' was dropped.
  const BEARD_LEAF = "spritesheets/beards";
  for (const [ourStyle, lpcStyle] of Object.entries(BEARD_STYLE_MAP)) {
    let sheet = await loadSheet(`${RAW}/${BEARD_LEAF}/${lpcStyle}/adult/walk.png`);
    if (!sheet) sheet = await loadSheet(`${RAW}/${BEARD_LEAF}/${lpcStyle}/walk.png`);
    if (!sheet) throw new Error(`missing beard ${lpcStyle}`);
    const base = cropSouth(sheet), src = detectSource(base, hairPal);
    for (const [ourColor, variant] of Object.entries(hairColorMap)) {
      if (!variant) throw new Error(`no hair palette variant for ${ourColor}`);
      writePng("beard", `${ourStyle}_${ourColor}`, recolor(base, hairPal[src], hairPal[variant]));
      entries.push({ id: `beard:${ourStyle}:${ourColor}`, category: "beard", zIndex: Z.beard, file: `/lpc/beard/${ourStyle}_${ourColor}.png`, ...cc(CRED.beard) });
    }
    console.log(`✓ beard ${ourStyle}`);
  }

  // --- Full class-outfit manifest (16 outfits × 2 builds = 32 sprites). ---
  //
  // Helper constructors return PartRef with verified defs. All variant names below were
  // confirmed to exist (both builds, exact filename) by listing the GitHub spritesheets dirs
  // for each def's male/female prefix — see task-2-report.md for the full verification table.
  const feetShoes = (v) => ({ def: "feet/shoes/feet_shoes_basic.json", variant: v });
  const feetSandals = (v) => ({ def: "feet/feet_sandals.json", variant: v });
  const feetArmour = () => ({ def: "feet/feet_armour.json" });
  const feetBoots = (v) => ({ def: "feet/boots/feet_boots_basic.json", variant: v });
  const pants = (v) => ({ def: "legs/pants/legs_pants.json", variant: v });
  const legsArmour = () => ({ def: "legs/legs_armour.json" });
  const robeLegs = (v) => ({ def: "legs/pants/legs_pantaloons.json", variant: v });
  const torsoLeather = () => ({ def: "torso/armour/torso_armour_leather.json" });
  const torsoChainmail = () => ({ def: "torso/torso_chainmail.json" });
  const torsoPlate = () => ({ def: "torso/armour/torso_armour_plate.json" });
  // Base-tier cloth shirt (fighter/ranger t0). torso_clothes_tunic is female-only and its
  // suggested male fallback in the plan (…verify…) doesn't exist; per Ambiguity Resolution #1
  // we instead use the longsleeve def, which is a *recolor* def (no variants) covering both
  // builds off one base sheet. The requested color intent (v) is accepted but intentionally
  // unused — class identity for fighter/ranger comes from the armor tiers (t1-t3), not t0 cloth.
  const shirt = (v) => ({ def: "torso/shirts/longsleeve/torso_clothes_longsleeve.json" });
  // Robe (mage/healer, all tiers). torso_clothes_robe is female-only, so the male build uses
  // the frock coat (torso/jacket/torso_jacket_frock.json) as a robe-like substitute — it has
  // every color name we need natively (confirmed via the real
  // spritesheets/torso/jacket/frock/male/walk/ directory listing: black, blue, bluegray, brown,
  // charcoal, forest, gray, green, lavender, leather, maroon, navy, orange, pink, purple, red,
  // rose, sky, slate, tan, teal, walnut, white, yellow — all 24 present).
  //
  // The female robe def's palette is narrower — confirmed via the real
  // spritesheets/torso/clothes/robe/female/walk/ directory listing: black, blue, brown,
  // dark_brown, dark_gray, forest_green, light_gray, purple, red, white (10 colors).
  //
  // DEFECT FIX (task-2 review): the previous map substituted several requested colors to the
  // SAME female fallback (navy→blue == blue→blue; lavender→purple == purple→purple), which,
  // combined with the robe occluding the legs layer in the south frame, made mage:t0:female ==
  // mage:t1:female and mage:t3 == healer:t3 (both builds, since both classes asked for
  // "lavender" on every layer at t3) byte-identical. Fixed by choosing a distinct color per
  // (class, tier) from each palette's *actual* colors — mage stays in the cool blue→black
  // "arcane" range, healer stays in the light white→warm "holy" range, and the two ranges never
  // share a color, so every mage/healer torso recolor (the layer that isn't occluded) differs.
  const ROBE_FEMALE_VARIANT = {
    // mage (cool / arcane, darkening with tier)
    blue: "blue",             // mage t0
    navy: "dark_gray",        // mage t1 — robe has no navy; dark_gray is the nearest cool dark tone (and, critically, distinct from t0's "blue")
    purple: "purple",         // mage t2
    black: "black",           // mage t3 — darkest, no substitute needed
    // healer (light / holy, warming with tier)
    white: "white",           // healer t0
    gray: "light_gray",       // healer t1
    tan: "brown",             // healer t2 — robe has no tan; brown is the nearest warm/gold-adjacent tone
    yellow: "dark_brown",     // healer t3 — robe has no yellow (gold); dark_brown is the richest warm tone available
  };
  const robe = (v) => {
    const femaleVariant = ROBE_FEMALE_VARIANT[v];
    if (!femaleVariant) throw new Error(`no female robe variant mapped for ${v}`);
    return {
      male: { def: "torso/jacket/torso_jacket_frock.json", variant: v },
      female: { def: "torso/shirts/torso_clothes_robe.json", variant: femaleVariant },
    };
  };

  const OUTFITS = {
    fighter: {
      0: [feetShoes("brown"), pants("brown"), shirt("brown")],
      1: [feetArmour(), legsArmour(), torsoLeather()],
      2: [feetArmour(), legsArmour(), torsoChainmail()],
      3: [feetArmour(), legsArmour(), torsoPlate()],
    },
    ranger: {
      0: [feetShoes("forest"), pants("forest"), shirt("forest")],
      1: [feetBoots("brown"), pants("brown"), torsoLeather()],
      2: [feetBoots("brown"), legsArmour(), torsoLeather()],
      3: [feetBoots("walnut"), legsArmour(), torsoLeather()],
    },
    // Mage = cool/arcane robe (blue → black), healer = light/holy robe (white → warm/gold).
    // The two classes' robe colors never overlap at any tier, and each class's four robe
    // colors are pairwise distinct — see ROBE_FEMALE_VARIANT above for the female-side mapping.
    mage: {
      0: [feetShoes("blue"), pants("blue"), robe("blue")],
      1: [feetShoes("blue"), pants("navy"), robe("navy")],
      2: [feetSandals("purple"), robeLegs("purple"), robe("purple")],
      3: [feetSandals("lavender"), robeLegs("lavender"), robe("black")],
    },
    healer: {
      0: [feetShoes("white"), pants("white"), robe("white")],
      1: [feetShoes("white"), pants("gray"), robe("gray")],
      2: [feetSandals("sky"), robeLegs("sky"), robe("tan")],
      3: [feetSandals("lavender"), robeLegs("lavender"), robe("yellow")],
    },
  };
  for (const [cls, tiers] of Object.entries(OUTFITS))
    for (const [tier, parts] of Object.entries(tiers))
      await buildOutfit(cls, Number(tier), parts);

  // --- Gear archetypes + signature legendaries (19 archetypes × 2 builds = 38 sprites). ---
  //
  // GEAR IS UN-TINTED, ONE SPRITE PER BUILD — rarity is a runtime tint, never baked here.
  // Every `…verify…` def from the plan was resolved by listing the real GitHub
  // sheet_definitions/spritesheets dirs (see task-3-report.md for the full verification table
  // and every rejected candidate). Two def substitutions from the plan's literal suggestion,
  // both reported in task-3-report.md:
  //   - excalibur: weapon_magic_wand → this task uses weapon_sword_glowsword ("blue"), not the
  //     plan's weapon_sword_katana — katana's layer_1 uses a non-standard `custom_animation:
  //     "walk_128"` sheet (1664×512, not the standard 576×256 9-frame walk row), which is
  //     incompatible with this pipeline's fixed y=128 south-frame crop.
  //   - archmage-staff: weapon_magic_wand has ONLY a "slash" animation (no "walk" sheet exists
  //     at all for it) — unusable for a south-standing-frame export. Substituted
  //     weapon_magic_crystal ("purple"/"blue"), a distinct-shaped magic weapon with a standard
  //     walk sheet.
  // spriteId strings are UNCHANGED from the contract in both cases — only the underlying def.
  //
  // Accessory ambiguity (cape/amulet): `headwear/neck/` (the plan's suggested dir) contains only
  // `meta_neck.json` — no real items. The actual neck-item defs live at `head/neck/` (NOT
  // `headwear/neck/`). `cape` uses `head/neck/neck_capetie.json` (the front-visible cloak-tie
  // clasp, zPos 90 — matches the accessory z-band and reads correctly drawn over the front,
  // unlike `torso/cape/cape_solid.json`'s back-spread bg layer, which would incorrectly occlude
  // the torso at z=90). `amulet` uses `head/neck/charms/neck_amulet_dangle.json`. Both have
  // real, distinct male+female layer_1 keys. No spriteId change — see task-3-report.md.
  //
  // Distinctness (build-level): a handful of archetypes (sword/staff/cap/crown/archmage-staff)
  // resolve to a def with MULTIPLE color variants but a body-type-*universal* path (identical
  // male/female source sheet) — without action, {spriteId}_male.png would be byte-identical to
  // {spriteId}_female.png. Where the source def offers more than one variant, a close in-family
  // {male,female} variant pair is used so every exported file is unique (steel/iron,
  // medium/light, brown/tan, crown_gold/gold, purple/blue) — mirrors the existing precedent of
  // per-build variation already used throughout the outfit manifest (e.g. `robe()` above).
  // `excalibur` (glowsword) only ships two variants total (blue/red) and both are used
  // (male=blue, female=red) for the same reason. `amulet` also has per-build-distinct source
  // paths but LPC head accessories render pixel-identical in the cropped south frame across
  // builds regardless (head shape is shared), so its variant is likewise split (gold_blue /
  // silver_purple) to guarantee a unique file.
  //
  // Four archetypes remain build-identical on purpose, not by omission — verified unfixable:
  //   - `greatsword` (longsword) and `slingshot`: exactly ONE upstream LPC asset exists, no
  //     alternate colorway or gendered variant at all (confirmed by listing the live
  //     spritesheets/weapon/sword/longsword/walk/ and .../ranged/slingshot/foreground/ dirs
  //     — each contains a single baked PNG). `slingshot` replaces the plan's `crossbow` — see the
  //     BLANK-SPRITE FIX comment above the GEAR entry for why.
  //   - `helm` (barbuta) and `greathelm`: layer_1 DOES have separate male/female source paths,
  //     but both defs have zero `variants` to pick from, AND — because LPC heads are unisex —
  //     the cropped south-standing frame renders pixel-identical between builds regardless of
  //     which of the two source sheets is read.
  // None of these are cross-spriteId collisions (the actual distinctness guarantee: no two
  // DIFFERENT archetypes look the same) — see task-3-report.md for the full accounting.
  const GEAR = [
    // weapon archetypes
    { spriteId: "sword", category: "weapon", part: {
      male: { def: "weapons/sword/weapon_sword_arming.json", variant: "steel" },
      female: { def: "weapons/sword/weapon_sword_arming.json", variant: "iron" },
    } },
    { spriteId: "greatsword", category: "weapon", part: { def: "weapons/sword/weapon_sword_longsword.json", variant: "longsword" } },
    { spriteId: "staff", category: "weapon", part: {
      male: { def: "weapons/magic/weapon_magic_gnarled.json", variant: "medium" },
      female: { def: "weapons/magic/weapon_magic_gnarled.json", variant: "light" },
    } },
    // BLANK-SPRITE FIX (post-Task-3 defect): the plan's `weapon_ranged_crossbow.json` reads its
    // `layer_1` (the "background" sub-layer, zPos -1) — verified empirically (fetched sheet +
    // counted opaque px in the y=128..191 south walk row) to be 100% transparent for BOTH builds.
    // The visible crossbow art lives in `layer_2` ("foreground", zPos 140, 1563 opaque px), which
    // `loadDefFrame` never reads (it only ever reads `def.layer_1`). Rather than special-case
    // layer selection per-def, swapped the archetype to a ranged weapon whose `layer_1` itself has
    // south-frame content. Checked every candidate the brief listed:
    //   - `weapon_ranged_bow_normal/recurve/great.json`: `layer_1`/`layer_2` ("universal/…") only
    //     have `hurt`/`shoot` sub-dirs, no `walk` sheet at all. The walk art lives in `layer_3`/
    //     `layer_4` under `custom_animation: "walk_128"` — a 1664×512px sheet (128px-tall frames),
    //     the same non-standard layout already rejected for `weapon_sword_katana` in the
    //     `excalibur` substitution above. Incompatible with `cropSouth`'s fixed y=128/64px-row crop.
    //   - `weapon_ranged_boomerang.json`: `animations: ["slash_reverse_oversize"]` only — no
    //     `walk` sheet exists for this def at all (same failure mode as `weapon_magic_wand`,
    //     rejected for `archmage-staff` above).
    //   - `weapon_ranged_slingshot.json`: `layer_1` ("foreground", zPos 140) IS a standard
    //     576×256 walk sheet with real south-frame content (748 opaque px in y=128..191),
    //     universal male/female path. WORKS — chosen.
    // spriteId renamed `crossbow` → `slingshot` to match the actual rendered weapon (a slingshot
    // is not a crossbow) — flagged for Task 4 to reconcile the "Hunter's Crossbow" roster entry's
    // `spriteId: "crossbow"` reference. Only one upstream variant exists (like `greatsword`), so
    // male/female are intentionally byte-identical — see Distinctness note below.
    { spriteId: "slingshot", category: "weapon", part: { def: "weapons/ranged/weapon_ranged_slingshot.json", variant: "slingshot" } },
    // helmet archetypes
    { spriteId: "cap", category: "helmet", part: {
      male: { def: "headwear/hats/caps/hat_cap_leather.json", variant: "brown" },
      female: { def: "headwear/hats/caps/hat_cap_leather.json", variant: "tan" },
    } },
    { spriteId: "helm", category: "helmet", part: { def: "headwear/helmets/helmets/hat_helmet_barbuta.json" } },
    { spriteId: "greathelm", category: "helmet", part: { def: "headwear/helmets/helmets/hat_helmet_greathelm.json" } },
    // armor (torso) archetypes
    { spriteId: "leather-armor", category: "armor", part: { def: "torso/armour/torso_armour_leather.json" } },
    { spriteId: "mail", category: "armor", part: { def: "torso/torso_chainmail.json" } },
    { spriteId: "plate", category: "armor", part: { def: "torso/armour/torso_armour_plate.json" } },
    // boots (feet) archetypes
    { spriteId: "shoes", category: "boots", part: { def: "feet/shoes/feet_shoes_basic.json", variant: "brown" } },
    { spriteId: "boots", category: "boots", part: { def: "feet/boots/feet_boots_basic.json", variant: "brown" } },
    { spriteId: "greaves", category: "boots", part: { def: "feet/feet_armour.json" } },
    // accessory archetypes (z=90 — drawn on top; must read correctly in front)
    { spriteId: "cape", category: "accessory", part: { def: "head/neck/neck_capetie.json", variant: "brown" } },
    { spriteId: "amulet", category: "accessory", part: {
      male: { def: "head/neck/charms/neck_amulet_dangle.json", variant: "gold_blue" },
      female: { def: "head/neck/charms/neck_amulet_dangle.json", variant: "silver_purple" },
    } },
    // signature legendaries (unique shapes; distinct def from their base archetype)
    { spriteId: "excalibur", category: "weapon", part: {
      male: { def: "weapons/sword/weapon_sword_glowsword.json", variant: "blue" },
      female: { def: "weapons/sword/weapon_sword_glowsword.json", variant: "red" },
    } },
    { spriteId: "archmage-staff", category: "weapon", part: {
      male: { def: "weapons/magic/weapon_magic_crystal.json", variant: "purple" },
      female: { def: "weapons/magic/weapon_magic_crystal.json", variant: "blue" },
    } },
    { spriteId: "dragon-plate", category: "armor", part: { def: "torso/armour/torso_armour_legion.json" } },
    { spriteId: "crown", category: "helmet", part: {
      male: { def: "headwear/hats/formal/hat_formal_crown.json", variant: "crown_gold" },
      female: { def: "headwear/hats/formal/hat_formal_crown.json", variant: "gold" },
    } },
  ];
  for (const g of GEAR) await buildGear(g.spriteId, g.category, g.part);

  assertCoverage();

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
  credRows.push(["beard", CRED.beard.authors.join(" | "), CRED.beard.licenses.join(" | "), CRED.beard.url]);
  for (const [asset, author, license, sourceUrl] of gearCreditRows) {
    credRows.push([asset, author.replace(/; /g, " | "), license.replace(/, /g, " | "), sourceUrl]);
  }
  const preamble = `# Character art: Universal LPC Spritesheet (art assets only, not generator code).\n` +
    `# Full per-asset credits: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/CREDITS.csv\n`;
  writeFileSync(CREDITS_OUT, preamble + credRows.map((r) => r.map(csv).join(",")).join("\n") + "\n");

  console.log(`\nDONE: ${entries.length} assets → public/lpc; catalog.ts + CREDITS.csv written.`);
}
main().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
