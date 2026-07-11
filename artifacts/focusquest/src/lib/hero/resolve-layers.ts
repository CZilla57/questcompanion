import type {
  CatalogEntry, HeroLook, ResolvedLayer, LayerCategory,
} from "./types";
import { RARITY_TINT, isGearCategory } from "./types";

function collectIds(look: HeroLook): string[] {
  // NB: the face is baked into the body sprite (LPC head + default eyes are composited into the
  // body asset at build time). `HeroLook.face` / `avatarFace` stay reserved for a future dedicated
  // face layer, but no `face:*` layer is emitted in v1.
  const ids: string[] = [`body:${look.build}:${look.skin}`];
  if (look.hairStyle !== "bald") {
    ids.push(`hair:${look.hairStyle}:${look.hairColor}`);
  }
  if (look.earrings !== "none") ids.push(`earrings:${look.earrings}`);
  if (look.beardStyle !== "none") ids.push(`beard:${look.beardStyle}:${look.beardColor}`);
  if (look.glasses !== "none") ids.push(`glasses:${look.glasses}`);
  ids.push(`outfit:${look.avatarClass}:t${look.tier}:${look.build}`);
  for (const g of look.equipped) {
    ids.push(`gear:${g.spriteId}:${look.build}`);
  }
  return ids;
}

/**
 * Map each gear catalog category to the rarity of the item occupying it.
 * Relies on the invariant that at most one equipped item maps to any given
 * category (one item per slot/category); if that ever changes, later entries
 * in `look.equipped` will silently overwrite earlier ones for the same category.
 */
function tintByCategory(
  look: HeroLook,
  catalogById: Map<string, CatalogEntry>,
): Map<LayerCategory, string | undefined> {
  const out = new Map<LayerCategory, string | undefined>();
  for (const g of look.equipped) {
    const entry = catalogById.get(`gear:${g.spriteId}:${look.build}`);
    if (entry) out.set(entry.category, RARITY_TINT[g.rarity]);
  }
  return out;
}

export function resolveLayers(
  look: HeroLook,
  catalogById: Map<string, CatalogEntry>,
): ResolvedLayer[] {
  const tints = tintByCategory(look, catalogById);
  const layers: ResolvedLayer[] = [];

  for (const id of collectIds(look)) {
    const entry = catalogById.get(id);
    // Not in the catalog (e.g. outfits/gear that aren't built yet) → skip silently. Required
    // assets are guarded at build time by the catalog-integrity test, not at runtime.
    if (!entry) continue;
    const layer: ResolvedLayer = { file: entry.file, zIndex: entry.zIndex };
    if (isGearCategory(entry.category)) {
      const tint = tints.get(entry.category);
      if (tint) layer.tint = tint;
    }
    layers.push(layer);
  }

  return layers.sort((a, b) => a.zIndex - b.zIndex);
}
