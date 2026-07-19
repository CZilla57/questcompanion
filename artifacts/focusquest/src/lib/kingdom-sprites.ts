// Life Kingdoms sprite catalog.
//
// Two kinds of sprite, unified behind one lookup:
//  - TERRAIN + PROPS are source rects into the vendored terrain sheet. Canvas
//    drawImage takes a source rectangle natively, so no slicing pipeline is
//    needed for these.
//  - BUILDINGS are standalone PNGs composited at build time by
//    scripts/src/build-kingdom-buildings.ts, because the vendored buildings
//    sheet is a component kit (roof slabs, walls, doors) with no assembled
//    houses on it. Their catalog is generated — see kingdom-buildings-catalog.
//
// Attribution for all vendored art lives in public/kingdoms/CREDITS.csv.
import { BUILDING_SPRITES } from "./kingdom-buildings-catalog";

export const TILE = 32;

export const TERRAIN_URL = "/kingdoms/terrain.png";

/** A rect into the terrain sheet. */
export type TerrainSprite = { kind: "terrain"; sx: number; sy: number; w: number; h: number };
/** A standalone composited image. */
export type ImageSprite = { kind: "image"; url: string; w: number; h: number };
export type Sprite = TerrainSprite | ImageSprite;

const t = (sx: number, sy: number, w: number, h: number): TerrainSprite =>
  ({ kind: "terrain", sx, sy, w, h });

/**
 * Ground fills and scenery props, with coordinates read off the real sheet.
 * Ground tiles are 32x32 and tile seamlessly; props are free-standing and are
 * drawn at their natural size.
 */
export const TERRAIN_SPRITES: Record<string, TerrainSprite> = {
  // ── Ground fills (32x32, tileable) ──
  "ground.grass":  t(128, 64, TILE, TILE),
  "ground.dirt":   t(192, 0, TILE, TILE),
  "ground.cobble": t(128, 128, TILE, TILE),
  "ground.sand":   t(288, 160, TILE, TILE),
  "ground.water":  t(416, 640, TILE, TILE),

  // ── Props (free-standing) ──
  "prop.boulder":      t(608, 608, 64, 32),
  "prop.boulder-pale": t(800, 608, 64, 32),
  "prop.tree":         t(704, 704, 96, 128),
  "prop.bush":         t(800, 656, 96, 80),
  "prop.pine":         t(800, 832, 96, 96),
  "prop.stump":        t(736, 872, TILE, TILE),
};

/** Every sprite the scene resolver may reference, terrain and buildings alike. */
export const SPRITES: Record<string, Sprite> = {
  ...TERRAIN_SPRITES,
  ...Object.fromEntries(
    Object.entries(BUILDING_SPRITES).map(([id, b]) => [
      id,
      { kind: "image", url: b.url, w: b.w, h: b.h } satisfies ImageSprite,
    ]),
  ),
};

export function spriteSize(id: string): { w: number; h: number } | null {
  const s = SPRITES[id];
  return s ? { w: s.w, h: s.h } : null;
}
