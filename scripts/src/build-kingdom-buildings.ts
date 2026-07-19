// @ts-nocheck
// AUTO-BUILD TOOL — composites Life Kingdoms building sprites from the vendored
// [LPC Revised] buildings tileset and writes them to the focusquest public dir.
//
// WHY THIS EXISTS: the LPC Revised buildings sheet is a COMPONENT KIT (roof
// slabs, eaves, wall panels, doors) with no pre-assembled houses on it. The
// kingdom renderer wants simple whole-building sprites, so the fiddly tile
// composition happens once here, at build time, rather than in the runtime
// scene resolver where it would balloon every scene's layer list.
//
// The sheet repeats the same kit in colour variants on a regular grid, so one
// recipe parameterised by a variant offset yields the whole building roster.
//
// Run: pnpm --filter @workspace/scripts build-kingdom-buildings
import pngjs from "pngjs";
const { PNG } = pngjs;
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SHEET = join(REPO, "artifacts", "focusquest", "public", "kingdoms", "buildings.png");
const OUT_DIR = join(REPO, "artifacts", "focusquest", "public", "kingdoms", "buildings");

/** Colour variants are laid out on a regular grid within the sheet. */
type Variant = { id: string; dx: number; dy: number };

const VARIANTS: Variant[] = [
  { id: "stone", dx: 0,   dy: 0 },
  { id: "gold",  dx: 576, dy: 0 },
  { id: "slate", dx: 0,   dy: 256 },
  { id: "brown", dx: 576, dy: 256 },
  { id: "dark",  dx: 0,   dy: 512 },
  { id: "brick", dx: 576, dy: 512 },
];

/** Source rects within the base (stone) variant; other variants add their offset. */
const SRC = {
  // A gable roof unit from the roof kit: peak plus both shingled slopes. This is
  // what gives a building its silhouette — an earlier attempt used the flat roof
  // TEXTURE block at (24,0) and the results read as featureless slabs.
  // The cut-out along its lower edge is intentional in the source art: it is
  // where the wall shows through, so the roof is drawn OVER the wall body with
  // a slight overlap rather than stacked above it.
  roof: { x: 224, y: 32, w: 96, h: 64 },
  // A clean interior patch of the long wall run, away from panel borders.
  wall: { x: 224, y: 192, w: 32, h: 32 },
};

/** Doorway, painted rather than blitted — the sheet's doors are transparent
 *  cut-outs, which would show the terrain through the building. */
const DOOR = { w: 16, h: 22, rgb: [38, 30, 34] as const };

/**
 * Building roster: wall body size plus how much of the gable to keep.
 *
 * Sizes are deliberately modest. An earlier pass used bodies up to 160px wide,
 * and five of those in a 320px scene overlapped into one undifferentiated wall
 * of roof — it stopped reading as a village. At these sizes the five tiers total
 * ~376px of width across a 320px scene, so they overlap just enough to read as
 * depth rather than as a barricade.
 *
 * `roofH` crops the 64px gable from the BOTTOM, keeping the peak (which carries
 * the silhouette) and trimming slope the wall would hide anyway.
 */
type BuildingSpec = { id: string; bodyW: number; bodyH: number; roofH: number };

const BUILDINGS: BuildingSpec[] = [
  { id: "hut",   bodyW: 40, bodyH: 28, roofH: 40 },
  { id: "house", bodyW: 56, bodyH: 36, roofH: 48 },
  { id: "hall",  bodyW: 76, bodyH: 40, roofH: 52 },
  { id: "tower", bodyW: 28, bodyH: 72, roofH: 44 },
  { id: "keep",  bodyW: 96, bodyH: 48, roofH: 56 },
];

function loadSheet(): PNG {
  return PNG.sync.read(readFileSync(SHEET));
}

/** Copy a source rect from `src` onto `dst` at (dx,dy), skipping transparent pixels. */
function blit(
  src: PNG, sx: number, sy: number, sw: number, sh: number,
  dst: PNG, dx: number, dy: number,
): void {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const px = sx + x, py = sy + y;
      const tx = dx + x, ty = dy + y;
      if (px < 0 || py < 0 || px >= src.width || py >= src.height) continue;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      const si = (src.width * py + px) << 2;
      if (src.data[si + 3]! < 16) continue; // transparent source pixel
      const di = (dst.width * ty + tx) << 2;
      dst.data[di] = src.data[si]!;
      dst.data[di + 1] = src.data[si + 1]!;
      dst.data[di + 2] = src.data[si + 2]!;
      dst.data[di + 3] = src.data[si + 3]!;
    }
  }
}

/** How far the roof's lower edge sits over the wall body. */
const ROOF_OVERLAP = 8;

function compose(sheet: PNG, spec: BuildingSpec, variant: Variant): PNG {
  const roofW = SRC.roof.w;
  const roofH = Math.min(spec.roofH, SRC.roof.h);
  // Eaves overhang the wall by 8px a side. Narrow buildings get a centre-cropped
  // roof rather than a full-width one, which otherwise reads as a lollipop.
  const roofSpan = spec.bodyW + 16;
  const canvasW = Math.max(spec.bodyW, roofSpan);
  const canvasH = roofH + spec.bodyH - ROOF_OVERLAP;
  const out = new PNG({ width: canvasW, height: canvasH, fill: true });
  // fill:true gives opaque black; clear to fully transparent instead.
  out.data.fill(0);

  const bodyX = Math.floor((canvasW - spec.bodyW) / 2);
  const bodyY = roofH - ROOF_OVERLAP;

  // Wall body: tile the wall patch across the body rect.
  for (let y = 0; y < spec.bodyH; y += SRC.wall.h) {
    for (let x = 0; x < spec.bodyW; x += SRC.wall.w) {
      const w = Math.min(SRC.wall.w, spec.bodyW - x);
      const h = Math.min(SRC.wall.h, spec.bodyH - y);
      blit(sheet, SRC.wall.x + variant.dx, SRC.wall.y + variant.dy, w, h, out, bodyX + x, bodyY + y);
    }
  }

  // Doorway at the base, centred: a painted dark opening. Drawn before the roof
  // so an overhanging eave can clip it, as it would in life.
  const doorX = bodyX + Math.floor((spec.bodyW - DOOR.w) / 2);
  const doorY = bodyY + spec.bodyH - DOOR.h;
  for (let y = 0; y < DOOR.h; y++) {
    for (let x = 0; x < DOOR.w; x++) {
      const tx = doorX + x, ty = doorY + y;
      if (tx < 0 || ty < 0 || tx >= out.width || ty >= out.height) continue;
      const di = (out.width * ty + tx) << 2;
      if (out.data[di + 3]! < 16) continue; // only carve into existing wall
      out.data[di] = DOOR.rgb[0];
      out.data[di + 1] = DOOR.rgb[1];
      out.data[di + 2] = DOOR.rgb[2];
      out.data[di + 3] = 255;
    }
  }

  // Roof, drawn last so it sits over the wall top and the door lintel.
  const roofX = Math.floor((canvasW - roofSpan) / 2);
  if (roofSpan <= roofW) {
    // Centre-crop keeps the gable's peak, which is what carries the silhouette.
    const inset = Math.floor((roofW - roofSpan) / 2);
    blit(sheet, SRC.roof.x + variant.dx + inset, SRC.roof.y + variant.dy, roofSpan, roofH, out, roofX, 0);
  } else {
    // Wider bodies repeat the gable, which reads as a terraced row.
    for (let x = 0; x < roofSpan; x += roofW) {
      const w = Math.min(roofW, roofSpan - x);
      blit(sheet, SRC.roof.x + variant.dx, SRC.roof.y + variant.dy, w, roofH, out, roofX + x, 0);
    }
  }

  return out;
}

/** Fails the build rather than shipping an invisible sprite. */
function assertNotBlank(png: PNG, name: string): void {
  let opaque = 0;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i]! > 16) opaque++;
  if (opaque === 0) throw new Error(`blank sprite: ${name}`);
}

const CATALOG_OUT = join(
  REPO, "artifacts", "focusquest", "src", "lib", "kingdom-buildings-catalog.ts",
);

function main(): void {
  const sheet = loadSheet();
  mkdirSync(OUT_DIR, { recursive: true });

  const entries: string[] = [];
  for (const variant of VARIANTS) {
    for (const spec of BUILDINGS) {
      const png = compose(sheet, spec, variant);
      const name = `${spec.id}-${variant.id}`;
      assertNotBlank(png, name);
      writeFileSync(join(OUT_DIR, `${name}.png`), PNG.sync.write(png));
      entries.push(
        `  "build.${name}": { url: "/kingdoms/buildings/${name}.png", w: ${png.width}, h: ${png.height} },`,
      );
    }
  }

  // Generated catalog — the renderer needs each sprite's intrinsic size to lay
  // scenes out without loading the images first.
  const ts = `// GENERATED by scripts/src/build-kingdom-buildings.ts — do not edit by hand.
// Regenerate with: pnpm --filter @workspace/scripts build-kingdom-buildings

export type BuildingSprite = { url: string; w: number; h: number };

export const BUILDING_SPRITES: Record<string, BuildingSprite> = {
${entries.join("\n")}
};

export const BUILDING_SHAPES = [${BUILDINGS.map((b) => `"${b.id}"`).join(", ")}] as const;
export const BUILDING_VARIANTS = [${VARIANTS.map((v) => `"${v.id}"`).join(", ")}] as const;
`;
  writeFileSync(CATALOG_OUT, ts);

  console.log(`wrote ${entries.length} building sprites to ${OUT_DIR}`);
  console.log(`wrote catalog to ${CATALOG_OUT}`);
}

main();
