import { useGetAvatar, useGetHeroStatus } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Swords, ChevronRight } from "lucide-react";
import { PixelHero } from "@/components/pixel-hero";
import { HeroVitality } from "@/components/hero-vitality";
import { heroSpriteEffect, type HungerStage } from "@/lib/hero-vitality";
import type {
  HeroLook, AvatarClass, Build, Skin, HairStyle, HairColor, FaceId, EquippedGearLook,
} from "@/lib/hero/types";

const CLASS_LABEL: Record<string, string> = {
  fighter: "Fighter", mage: "Mage", ranger: "Ranger", healer: "Healer",
};

/**
 * Compact hero portrait + core stats, shown on the dashboard beside the activity heatmap.
 * Reuses the live avatar data + PixelHero compositor; links out to the full Hero page.
 */
export function HeroSummary() {
  const { data: a, isLoading } = useGetAvatar();
  const { data: heroStatus } = useGetHeroStatus();

  if (isLoading) {
    return <div className="w-full h-[120px] rounded-lg bg-muted/20 animate-pulse" />;
  }
  if (!a) return null;

  const look: HeroLook = {
    skin: (a.avatarSkin ?? "light") as Skin,
    build: (a.avatarBodyBuild ?? "male") as Build,
    hairStyle: (a.avatarHairStyle ?? "short") as HairStyle,
    hairColor: (a.avatarHairColor ?? "brown") as HairColor,
    face: (a.avatarFace ?? "neutral") as FaceId,
    beardStyle: (a.avatarBeardStyle ?? "none") as HeroLook["beardStyle"],
    beardColor: (a.avatarBeardColor ?? "brown") as HeroLook["beardColor"],
    glasses: (a.avatarGlasses ?? "none") as HeroLook["glasses"],
    earrings: (a.avatarEarrings ?? "none") as HeroLook["earrings"],
    avatarClass: (a.avatarClass ?? "fighter") as AvatarClass,
    tier: Math.min(3, Math.floor(((a.level ?? 1) - 1) / 10)) as 0 | 1 | 2 | 3,
    equipped: (a.equippedGear ?? [])
      .filter((g) => g.spriteId)
      .map((g) => ({
        slot: g.slot as EquippedGearLook["slot"],
        spriteId: g.spriteId as string,
        rarity: g.rarity as EquippedGearLook["rarity"],
      })),
  };

  const accent = a.avatarColor ?? "#00FFFF";

  return (
    <div className="flex items-center gap-5 w-full">
      {/* Portrait with a soft accent-colored glow for presence */}
      <div className="relative flex-shrink-0">
        <div
          className="absolute -inset-2 rounded-2xl blur-xl opacity-25"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <div
          className="relative rounded-2xl border border-border/60 bg-card/40 p-2"
          style={{ boxShadow: `0 0 20px ${accent}33` }}
        >
          <div className="relative" style={heroSpriteEffect(heroStatus?.stage as HungerStage | undefined)}>
            <PixelHero look={look} size={128} celebrateOn="questCompleted" />
          </div>
          {heroStatus?.stage === "fainted" && (
            <span className="absolute top-1 right-1 text-lg" aria-hidden>💫</span>
          )}
        </div>
      </div>
      <div className="min-w-0 space-y-2.5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your Hero</div>
          <div className="font-bold text-xl text-foreground leading-tight">
            Level {a.level}
            <span className="text-primary"> {CLASS_LABEL[a.avatarClass] ?? ""}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Swords className="w-4 h-4 text-primary" aria-hidden />
          <span className="font-bold text-primary tabular-nums text-base">{a.battlePower}</span>
          <span className="text-xs text-muted-foreground">battle power</span>
        </div>
        <HeroVitality compact />
        <Link
          href="/avatar"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
        >
          Customize <ChevronRight className="w-3 h-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
