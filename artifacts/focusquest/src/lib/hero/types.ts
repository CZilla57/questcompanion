export type Build = "slim" | "average" | "broad";
export type Skin = "light" | "tan" | "brown" | "dark" | "green" | "blue";
export type HairStyle = "bald" | "short" | "long" | "ponytail" | "mohawk";
export type HairColor = "brown" | "black" | "blonde" | "red" | "white" | "blue";
export type FaceId = "neutral" | "stern" | "smile";
export type AvatarClass = "fighter" | "mage" | "ranger" | "healer";
export type Rarity = "common" | "rare" | "epic" | "legendary";
export type GearSlot = "weapon" | "helmet" | "armor" | "boots" | "accessory";

export type LayerCategory =
  | "aura" | "body" | "face" | "hair" | "outfit"
  | "boots" | "armor" | "helmet" | "weapon" | "accessory";

export interface CatalogEntry {
  id: string;
  category: LayerCategory;
  zIndex: number;
  file: string;        // absolute public path, e.g. "/lpc/body/average_light.png"
  author: string;
  license: string;
  sourceUrl: string;
}

export interface EquippedGearLook {
  slot: GearSlot;
  spriteId: string;    // resolves to catalog id `gear:{spriteId}:{build}`
  rarity: Rarity;
}

export interface HeroLook {
  skin: Skin;
  build: Build;
  hairStyle: HairStyle;
  hairColor: HairColor;
  face: FaceId;
  avatarClass: AvatarClass;
  tier: 0 | 1 | 2 | 3;
  equipped: EquippedGearLook[];
}

export interface ResolvedLayer {
  file: string;
  zIndex: number;
  tint?: string;       // hex, gear layers only
}

export const RARITY_TINT: Record<Rarity, string | undefined> = {
  common: undefined,
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

const GEAR_CATEGORIES: ReadonlySet<LayerCategory> = new Set([
  "weapon", "helmet", "armor", "boots", "accessory",
]);

export function isGearCategory(c: LayerCategory): boolean {
  return GEAR_CATEGORIES.has(c);
}
