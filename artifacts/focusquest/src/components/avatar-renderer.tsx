import React from "react";

export type AvatarClass = "fighter" | "mage" | "ranger" | "healer";

export interface EquippedSlot {
  slot: "weapon" | "helmet" | "armor" | "boots" | "accessory";
  rarity: "common" | "rare" | "epic" | "legendary";
  name: string;
  statPower: number;
}

interface AvatarRendererProps {
  color: string;
  avatarClass: AvatarClass;
  equipped?: EquippedSlot[];
  size?: number;
  showGlow?: boolean;
}

const RARITY_COLORS: Record<string, string> = {
  common: "#9ca3af",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

const CLASS_ACCENTS: Record<AvatarClass, { secondary: string; symbol: string }> = {
  fighter: { secondary: "#ef4444", symbol: "⚔" },
  mage:    { secondary: "#8b5cf6", symbol: "✦" },
  ranger:  { secondary: "#22c55e", symbol: "◎" },
  healer:  { secondary: "#f59e0b", symbol: "✚" },
};

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function lighten(hex: string, amount: number): string {
  const [h, s, l] = hexToHsl(hex);
  return `hsl(${h},${s}%,${Math.min(l + amount, 90)}%)`;
}
function darken(hex: string, amount: number): string {
  const [h, s, l] = hexToHsl(hex);
  return `hsl(${h},${s}%,${Math.max(l - amount, 5)}%)`;
}

export function AvatarRenderer({
  color,
  avatarClass,
  equipped = [],
  size = 200,
  showGlow = true,
}: AvatarRendererProps) {
  const accent = CLASS_ACCENTS[avatarClass]?.secondary ?? "#6366f1";
  const symbol = CLASS_ACCENTS[avatarClass]?.symbol ?? "⚔";
  const bodyLight = lighten(color, 15);
  const bodyDark = darken(color, 15);
  const skinColor = "#e8c49a";
  const skinDark = "#d4a574";

  const equippedMap = new Map(equipped.map(e => [e.slot, e]));
  const helmet = equippedMap.get("helmet");
  const armor = equippedMap.get("armor");
  const weapon = equippedMap.get("weapon");
  const boots = equippedMap.get("boots");
  const accessory = equippedMap.get("accessory");

  const scale = size / 200;

  return (
    <svg
      viewBox="0 0 200 240"
      width={size}
      height={size * 1.2}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`${avatarClass} avatar`}
      style={{ filter: showGlow ? `drop-shadow(0 0 12px ${color}55)` : undefined }}
    >
      <defs>
        <radialGradient id={`aura-${color.slice(1)}`} cx="50%" cy="60%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="bodyGrad" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor={bodyLight} />
          <stop offset="100%" stopColor={bodyDark} />
        </radialGradient>
        <radialGradient id="skinGrad" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor={skinColor} />
          <stop offset="100%" stopColor={skinDark} />
        </radialGradient>
      </defs>

      {/* Background aura */}
      <ellipse cx="100" cy="145" rx="80" ry="85" fill={`url(#aura-${color.slice(1)})`} />

      {/* Accessory glow (behind everything) */}
      {accessory && (
        <circle cx="28" cy="130" r="18"
          fill={RARITY_COLORS[accessory.rarity] + "33"}
          stroke={RARITY_COLORS[accessory.rarity]}
          strokeWidth="1.5"
          opacity="0.7"
        />
      )}

      {/* Left arm */}
      <rect x="38" y="118" width="24" height="14" rx="7" fill="url(#bodyGrad)" />

      {/* Right arm (weapon side) */}
      <rect x="138" y="118" width="24" height="14" rx="7" fill="url(#bodyGrad)" />

      {/* Weapon held in right hand */}
      {weapon && (
        <g>
          <rect x="163" y="108" width="6" height="32" rx="3"
            fill={RARITY_COLORS[weapon.rarity]}
            opacity="0.9"
          />
          <polygon points="166,100 162,112 170,112"
            fill={RARITY_COLORS[weapon.rarity]}
          />
          <circle cx="166" cy="138" r="4"
            fill={RARITY_COLORS[weapon.rarity] + "88"}
          />
        </g>
      )}
      {!weapon && (
        <rect x="164" y="110" width="5" height="26" rx="2.5" fill="#374151" opacity="0.5" />
      )}

      {/* Body / torso */}
      <rect x="62" y="116" width="76" height="74" rx="12" fill="url(#bodyGrad)" />

      {/* Armor overlay on body */}
      {armor ? (
        <rect x="68" y="122" width="64" height="62" rx="10"
          fill={RARITY_COLORS[armor.rarity] + "40"}
          stroke={RARITY_COLORS[armor.rarity]}
          strokeWidth="1.5"
        />
      ) : (
        <rect x="68" y="122" width="64" height="62" rx="10"
          fill="none" stroke={accent + "60"} strokeWidth="1"
        />
      )}

      {/* Class symbol on chest */}
      <text
        x="100" y="164"
        textAnchor="middle"
        fontSize="18"
        fill={armor ? RARITY_COLORS[armor.rarity] : accent}
        opacity={armor ? 0.9 : 0.7}
        style={{ userSelect: "none" }}
      >
        {symbol}
      </text>

      {/* Legs */}
      <rect x="72" y="186" width="22" height="40" rx="11" fill="url(#bodyGrad)" />
      <rect x="106" y="186" width="22" height="40" rx="11" fill="url(#bodyGrad)" />

      {/* Boots overlays */}
      {boots && (
        <>
          <rect x="72" y="210" width="22" height="18" rx="9"
            fill={RARITY_COLORS[boots.rarity] + "60"}
            stroke={RARITY_COLORS[boots.rarity]}
            strokeWidth="1.5"
          />
          <rect x="106" y="210" width="22" height="18" rx="9"
            fill={RARITY_COLORS[boots.rarity] + "60"}
            stroke={RARITY_COLORS[boots.rarity]}
            strokeWidth="1.5"
          />
        </>
      )}

      {/* Neck */}
      <rect x="91" y="96" width="18" height="22" rx="9" fill="url(#skinGrad)" />

      {/* Head */}
      <circle cx="100" cy="82" r="30" fill="url(#skinGrad)" />

      {/* Helmet overlay */}
      {helmet ? (
        <path
          d={`M70,82 A30,30 0 0,1 130,82 L134,78 Q100,48 66,78 Z`}
          fill={RARITY_COLORS[helmet.rarity] + "cc"}
          stroke={RARITY_COLORS[helmet.rarity]}
          strokeWidth="1.5"
        />
      ) : (
        // Hair / class-specific head detail
        <path
          d={`M71,80 A29,29 0 0,1 129,80 L131,74 Q100,50 69,74 Z`}
          fill={darken(color, 5)}
          opacity="0.85"
        />
      )}

      {/* Eyes */}
      <circle cx="90" cy="82" r="5" fill="white" />
      <circle cx="110" cy="82" r="5" fill="white" />
      <circle cx="91" cy="83" r="3" fill="#1f2937" />
      <circle cx="111" cy="83" r="3" fill="#1f2937" />
      {/* Eye shine */}
      <circle cx="92" cy="82" r="1" fill="white" />
      <circle cx="112" cy="82" r="1" fill="white" />

      {/* Mouth */}
      <path d="M93 94 Q100 100 107 94" stroke={skinDark} fill="none" strokeWidth="1.8" strokeLinecap="round" />

      {/* Accessory badge (left side) */}
      {accessory && (
        <g>
          <circle cx="28" cy="130" r="11"
            fill="#0f172a"
            stroke={RARITY_COLORS[accessory.rarity]}
            strokeWidth="2"
          />
          <text x="28" y="135" textAnchor="middle" fontSize="11" fill={RARITY_COLORS[accessory.rarity]}>◆</text>
        </g>
      )}

      {/* Helmet rarity gem (top of helmet) */}
      {helmet && (
        <polygon
          points="100,47 104,55 100,59 96,55"
          fill={RARITY_COLORS[helmet.rarity]}
          filter={`drop-shadow(0 0 3px ${RARITY_COLORS[helmet.rarity]})`}
        />
      )}
    </svg>
  );
}
