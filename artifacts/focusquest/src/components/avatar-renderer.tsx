import React from "react";

export type AvatarClass = "fighter" | "mage" | "ranger" | "healer";
export type AvatarSkin  = "light" | "tan" | "brown" | "dark" | "green" | "blue";

export interface EquippedSlot {
  slot: "weapon" | "helmet" | "armor" | "boots" | "accessory";
  rarity: "common" | "rare" | "epic" | "legendary";
  name: string;
  statPower: number;
}

interface AvatarRendererProps {
  color: string;
  skin?: AvatarSkin;
  avatarClass: AvatarClass;
  equipped?: EquippedSlot[];
  level?: number;
  size?: number;
  showGlow?: boolean;
}

export const SKIN_PALETTES: Record<AvatarSkin, { base: string; dark: string; label: string }> = {
  light:  { base: "#FDBCB4", dark: "#C8825A", label: "Fair"    },
  tan:    { base: "#D4956A", dark: "#A36B3E", label: "Tan"     },
  brown:  { base: "#8D5524", dark: "#6B3A18", label: "Brown"   },
  dark:   { base: "#4A2512", dark: "#2D1309", label: "Ebony"   },
  green:  { base: "#7BC47F", dark: "#4A8C4E", label: "Verdant" },
  blue:   { base: "#89C4E1", dark: "#4A8DB0", label: "Azure"   },
};

const RARITY_COLORS: Record<string, string> = {
  common:    "#9ca3af",
  rare:      "#3b82f6",
  epic:      "#a855f7",
  legendary: "#f59e0b",
};

const RARITY_ORDER = ["legendary", "epic", "rare", "common"] as const;

function getTier(level: number): 0 | 1 | 2 | 3 {
  if (level <= 5)  return 0;
  if (level <= 15) return 1;
  if (level <= 30) return 2;
  return 3;
}

export function AvatarRenderer({
  color,
  avatarClass,
  equipped = [],
  level = 1,
  size = 200,
  showGlow = true,
}: AvatarRendererProps) {
  const tier = getTier(level);
  const src = `/avatars/${avatarClass}-t${tier}.png?v=2`;

  const highestRarity = equipped.length > 0
    ? RARITY_ORDER.find(r => equipped.some(e => e.rarity === r)) ?? null
    : null;

  const glowColor = highestRarity ? RARITY_COLORS[highestRarity] : color;
  const glowRadius = Math.max(4, size / 20);
  const glowFilter = showGlow
    ? `drop-shadow(0 0 ${glowRadius}px ${glowColor}bb)`
    : undefined;

  const dotSize = Math.max(5, Math.round(size / 28));
  const width = size;
  const height = Math.round(size * 1.4);

  return (
    <div
      role="img"
      aria-label={`${avatarClass} tier ${tier + 1} avatar`}
      style={{ width, height, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <img
        src={src}
        alt={`${avatarClass} tier ${tier + 1}`}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          imageRendering: "pixelated",
          filter: glowFilter,
          userSelect: "none",
        }}
        draggable={false}
      />

      {equipped.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 2,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            gap: 3,
            pointerEvents: "none",
          }}
        >
          {equipped.slice(0, 5).map((slot, i) => (
            <div
              key={i}
              title={`${slot.name} (${slot.rarity})`}
              style={{
                width: dotSize,
                height: dotSize,
                borderRadius: "50%",
                backgroundColor: RARITY_COLORS[slot.rarity] ?? "#9ca3af",
                boxShadow: `0 0 ${dotSize}px ${RARITY_COLORS[slot.rarity] ?? "#9ca3af"}`,
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
