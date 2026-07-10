import type {
  CatalogEntry, HeroLook, ResolvedLayer, LayerCategory,
} from "./types";
import { RARITY_TINT, isGearCategory } from "./types";

function collectIds(look: HeroLook): string[] {
  const ids: string[] = [
    `body:${look.build}:${look.skin}`,
    `face:${look.face}`,
  ];
  if (look.hairStyle !== "bald") {
    ids.push(`hair:${look.hairStyle}:${look.hairColor}`);
  }
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
    if (!entry) {
      console.warn(`[hero] missing catalog asset: ${id}`);
      continue;
    }
    const layer: ResolvedLayer = { file: entry.file, zIndex: entry.zIndex };
    if (isGearCategory(entry.category)) {
      const tint = tints.get(entry.category);
      if (tint) layer.tint = tint;
    }
    layers.push(layer);
  }

  return layers.sort((a, b) => a.zIndex - b.zIndex);
}
