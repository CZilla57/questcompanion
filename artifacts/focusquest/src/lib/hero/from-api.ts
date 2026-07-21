import type { HeroLook as ApiHeroLook } from "@workspace/api-client-react";
import type { HeroLook, Skin, Build, HairStyle, HairColor, FaceId, AvatarClass, EquippedGearLook } from "@/lib/hero/types";

/**
 * Adapt the API's HeroLook payload (avatar* columns + equipped gear) into the
 * renderer's HeroLook. Single source for every surface that draws another
 * user's hero (ally detail, body-double presence row).
 */
export function apiHeroToLook(h: ApiHeroLook | null | undefined): HeroLook | null {
  if (!h) return null;
  return {
    skin: (h.avatarSkin ?? "light") as Skin,
    build: (h.avatarBodyBuild ?? "male") as Build,
    hairStyle: (h.avatarHairStyle ?? "short") as HairStyle,
    hairColor: (h.avatarHairColor ?? "brown") as HairColor,
    face: (h.avatarFace ?? "neutral") as FaceId,
    beardStyle: (h.avatarBeardStyle ?? "none") as HeroLook["beardStyle"],
    beardColor: (h.avatarBeardColor ?? "brown") as HeroLook["beardColor"],
    glasses: (h.avatarGlasses ?? "none") as HeroLook["glasses"],
    earrings: (h.avatarEarrings ?? "none") as HeroLook["earrings"],
    avatarClass: (h.avatarClass ?? "fighter") as AvatarClass,
    tier: Math.min(3, Math.floor(((h.level ?? 1) - 1) / 10)) as 0 | 1 | 2 | 3,
    equipped: (h.equippedGear ?? [])
      .filter((g) => g.spriteId)
      .map((g) => ({
        slot: g.slot as EquippedGearLook["slot"],
        spriteId: g.spriteId as string,
        rarity: g.rarity as EquippedGearLook["rarity"],
      })),
  };
}
