// Pure, renderer-agnostic scene resolution: (kingdom, tier, liveliness) -> a
// declarative display list. Knows nothing about canvas, React, or the DOM, so a
// future PixiJS renderer can consume the same output unchanged.
import { TILE, LANTERN_ID, spriteSize } from "./kingdom-sprites";

// Declared here rather than imported from the server: the frontend must not
// depend on api-server modules.
export type Liveliness = "dormant" | "stirring" | "steady" | "bustling";

export type SceneLayer = { spriteId: string; x: number; y: number; alpha?: number };

export type KingdomSceneSpec = {
  /** Repeating ground tile id. */
  ground: string;
  /** Scenery drawn at every tier, in draw order. */
  props: { spriteId: string; x: number; y: number }[];
  /** Buildings revealed in tier order — tier N shows the first N. */
  buildingSlots: { shape: string; x: number; y: number }[];
  /** Which composited colour variant this kingdom's buildings use. */
  variant: string;
};

// Both dimensions MUST stay whole multiples of TILE so the ground fill tiles
// exactly to the edge. A non-multiple height leaves the final row hanging past
// the canvas bottom, which is what the scene-bounds test exists to catch.
export const SCENE_W = 320;
export const SCENE_H = 192;
export const SCENE_KINGDOM_IDS = ["hearth", "wellspring", "forge", "athenaeum", "crossroads", "capital"] as const;
export const MAX_KINGDOM_TIER = 5;

/** The capital is a full-width band, not a tile: it is the only scene whose
 *  art fills the content column, so it has its own dimensions and its own
 *  deeper ladder. Both values stay whole multiples of TILE. */
export const CAPITAL_SCENE_W = 1024;
export const CAPITAL_SCENE_H = 192;
export const MAX_CAPITAL_TIER = 11;

export function sceneSize(kingdomId: string): { w: number; h: number } {
  return kingdomId === "capital"
    ? { w: CAPITAL_SCENE_W, h: CAPITAL_SCENE_H }
    : { w: SCENE_W, h: SCENE_H };
}

export function maxTierFor(kingdomId: string): number {
  return kingdomId === "capital" ? MAX_CAPITAL_TIER : MAX_KINGDOM_TIER;
}

export function resolveSceneImageUrl(kingdomId: string, tier: number): string | null {
  if (!SCENE_KINGDOM_IDS.includes(kingdomId as (typeof SCENE_KINGDOM_IDS)[number])) return null;
  const safeTier = Math.max(0, Math.min(maxTierFor(kingdomId), Math.trunc(tier)));
  return `/kingdoms/scenes/${kingdomId}/tier-${safeTier}.png`;
}

/**
 * Buildings are anchored by their BOTTOM-CENTRE, because the composited sprites
 * have different heights per shape — anchoring by top-left would leave taller
 * buildings floating above the ground line.
 */
function anchor(shape: string, variant: string, x: number, y: number): SceneLayer | null {
  const id = `build.${shape}-${variant}`;
  const size = spriteSize(id);
  if (!size) return null;
  return { spriteId: id, x: Math.round(x - size.w / 2), y: Math.round(y - size.h) };
}

export const KINGDOM_SCENES: Record<string, KingdomSceneSpec> = {
  hearth: {
    ground: "ground.grass",
    variant: "brown",
    props: [
      { spriteId: "prop.tree", x: 4, y: 24 },
      { spriteId: "prop.bush", x: 224, y: 96 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 76,  y: 168 },
      { shape: "house", x: 176, y: 156 },
      { shape: "hut",   x: 262, y: 172 },
      { shape: "hall",  x: 128, y: 176 },
      { shape: "tower", x: 284, y: 170 },
    ],
  },
  wellspring: {
    ground: "ground.water",
    variant: "stone",
    props: [
      { spriteId: "prop.bush", x: 0, y: 92 },
      { spriteId: "prop.tree", x: 220, y: 16 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 64,  y: 166 },
      { shape: "house", x: 160, y: 152 },
      { shape: "hall",  x: 246, y: 170 },
      { shape: "tower", x: 108, y: 168 },
      { shape: "keep",  x: 196, y: 176 },
    ],
  },
  forge: {
    ground: "ground.cobble",
    variant: "slate",
    props: [
      { spriteId: "prop.boulder", x: 8, y: 128 },
      { spriteId: "prop.boulder-pale", x: 248, y: 40 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 68,  y: 170 },
      { shape: "tower", x: 148, y: 170 },
      { shape: "hall",  x: 236, y: 168 },
      { shape: "keep",  x: 108, y: 176 },
      { shape: "tower", x: 284, y: 168 },
    ],
  },
  athenaeum: {
    ground: "ground.grass",
    variant: "gold",
    props: [
      { spriteId: "prop.pine", x: 0, y: 20 },
      { spriteId: "prop.tree", x: 216, y: 8 },
      { spriteId: "prop.bush", x: 116, y: 96 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 80,  y: 168 },
      { shape: "house", x: 168, y: 154 },
      { shape: "hall",  x: 246, y: 172 },
      { shape: "tower", x: 120, y: 170 },
      { shape: "keep",  x: 200, y: 176 },
    ],
  },
  crossroads: {
    ground: "ground.dirt",
    variant: "brick",
    props: [
      { spriteId: "prop.stump", x: 24, y: 132 },
      { spriteId: "prop.bush", x: 212, y: 96 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 72,  y: 170 },
      { shape: "house", x: 184, y: 152 },
      { shape: "hall",  x: 244, y: 174 },
      { shape: "tower", x: 40,  y: 170 },
      { shape: "keep",  x: 148, y: 176 },
    ],
  },
  capital: {
    ground: "ground.cobble",
    variant: "stone",
    props: [
      { spriteId: "prop.bush", x: 8, y: 96 },
      { spriteId: "prop.tree", x: 224, y: 12 },
    ],
    buildingSlots: [
      { shape: "house", x: 88,  y: 164 },
      { shape: "hall",  x: 176, y: 156 },
      { shape: "tower", x: 44,  y: 170 },
      { shape: "keep",  x: 230, y: 176 },
      { shape: "hut",   x: 276, y: 170 },
    ],
  },
};

/** Dormant dims the scene toward night. It NEVER swaps in damaged art — the
 *  anti-shame grammar is "asleep", not "ruined". */
const ALPHA_BY_LIVELINESS: Record<Liveliness, number> = {
  dormant: 0.55,
  stirring: 0.75,
  steady: 0.9,
  bustling: 1,
};

/**
 * How many buildings show a lit window. A dormant kingdom deliberately keeps ONE
 * light on — "someone left a lamp burning" reads as a place waiting for you,
 * where a fully dark village reads as abandoned. That single lantern is the
 * difference between asleep and dead, so do not optimise it away.
 */
function lanternCount(liveliness: Liveliness, revealed: number): number {
  if (revealed === 0) return 0;
  switch (liveliness) {
    case "dormant":  return 1;
    case "stirring": return Math.max(1, Math.ceil(revealed * 0.34));
    case "steady":   return Math.max(1, Math.ceil(revealed * 0.67));
    case "bustling": return revealed;
  }
}

export function resolveScene(kingdomId: string, tier: number, liveliness: Liveliness): SceneLayer[] {
  const spec = KINGDOM_SCENES[kingdomId];
  if (!spec) return [];

  const alpha = ALPHA_BY_LIVELINESS[liveliness];
  const layers: SceneLayer[] = [];

  // Ground fill.
  for (let y = 0; y < SCENE_H; y += TILE) {
    for (let x = 0; x < SCENE_W; x += TILE) {
      layers.push({ spriteId: spec.ground, x, y, alpha });
    }
  }

  for (const p of spec.props) layers.push({ ...p, alpha });

  // Tier N reveals the first N slots; earned buildings are never withdrawn.
  const revealed = Math.max(0, Math.min(tier, spec.buildingSlots.length));
  const placed: SceneLayer[] = [];
  for (let i = 0; i < revealed; i++) {
    const slot = spec.buildingSlots[i]!;
    const layer = anchor(slot.shape, spec.variant, slot.x, slot.y);
    if (layer) placed.push(layer);
  }
  // Painter's order: buildings further back drawn first so nearer ones overlap.
  // Depth is the GROUND line (bottom edge), not the top-left corner — sprite
  // heights differ per shape, so comparing top edges can sort a tall building
  // further forward behind a short building further back.
  placed.sort((a, b) => (a.y + spriteSize(a.spriteId)!.h) - (b.y + spriteSize(b.spriteId)!.h));
  for (const p of placed) layers.push({ ...p, alpha });

  // Liveliness overlay: lit windows, drawn at full opacity so the light reads
  // against a dimmed scene.
  const count = lanternCount(liveliness, placed.length);
  for (let i = 0; i < count; i++) {
    const b = placed[i]!;
    const size = spriteSize(b.spriteId)!;
    layers.push({
      spriteId: LANTERN_ID,
      x: b.x + Math.round(size.w / 2) - 12,
      y: b.y + size.h - 30,
      alpha: 1,
    });
  }

  return layers;
}
