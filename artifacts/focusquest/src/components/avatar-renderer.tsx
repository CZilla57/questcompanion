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

const CLASS_ACCENTS: Record<AvatarClass, string> = {
  fighter: "#ef4444",
  mage:    "#8b5cf6",
  ranger:  "#22c55e",
  healer:  "#f59e0b",
};

// ── Colour utilities ────────────────────────────────────────────────────────

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

function adjustL(hex: string, delta: number): string {
  const [h, s, l] = hexToHsl(hex);
  return `hsl(${h},${s}%,${Math.min(Math.max(l + delta, 5), 92)}%)`;
}

// ── Colour map ──────────────────────────────────────────────────────────────

type ColorMap = Record<string, string>;

function buildColorMap(avatarColor: string, skin: AvatarSkin, accent: string): ColorMap {
  const { base: S, dark: s } = SKIN_PALETTES[skin] ?? SKIN_PALETTES.light;
  return {
    S, s,
    H:  adjustL(avatarColor, -22),
    h:  adjustL(avatarColor, -35),
    A:  avatarColor,
    a:  adjustL(avatarColor, -18),
    L:  adjustL(avatarColor,  22),
    W:  "#ffffff",
    E:  "#111827",
    P:  "#374151",
    p:  "#1f2937",
    B:  "#1e293b",
    b:  "#334155",
    X:  accent,
    x:  adjustL(accent, -18),
    G:  "#f59e0b",
    g:  "#d97706",
    M:  "#9ca3af",
    m:  "#6b7280",
    C:  "#dbeafe",
    c:  "#93c5fd",
    R:  "#ef4444",
    N:  "#0f172a",
  };
}

function fill(key: string, cm: ColorMap): string {
  return cm[key] ?? (key.startsWith("#") ? key : "transparent");
}

// ── Pixel block type ────────────────────────────────────────────────────────
// [x, y, width, height, colorKey]
type PB = [number, number, number, number, string];

// ── FIGHTER sprite ──────────────────────────────────────────────────────────
// Stocky armored warrior with shield emblem on chest
const FIGHTER_BODY: PB[] = [
  // Hair
  [5,0,10,2,"H"], [4,2,1,5,"H"], [15,2,1,5,"H"],
  // Face
  [5,2,10,7,"S"],
  // Neck
  [8,9,4,1,"S"],
  // Collar
  [6,10,8,1,"A"],
  // Shoulders (wide, 14 px)
  [3,11,14,1,"A"], [3,11,2,1,"L"], [15,11,2,1,"L"],
  // Arms
  [3,12,2,4,"A"], [15,12,2,4,"A"],
  [3,12,1,1,"L"], [16,12,1,1,"L"],
  [4,15,1,1,"a"], [15,15,1,1,"a"],
  // Torso
  [5,12,10,5,"A"], [5,12,1,5,"L"], [14,12,1,5,"a"],
  // Shield emblem (class X)
  [8,13,4,1,"X"], [8,16,4,1,"X"],
  [8,13,1,4,"X"], [11,13,1,4,"X"],
  [9,14,2,2,"x"], [9,14,2,1,"G"],
  // Belt (gold)
  [4,17,12,1,"G"], [5,17,1,1,"g"], [14,17,1,1,"g"],
  // Legs
  [5,18,3,5,"P"], [12,18,3,5,"P"],
  [5,18,1,1,"p"], [12,18,1,1,"p"],
  // Boots (wide, 5 px each)
  [4,23,5,3,"B"], [11,23,5,3,"B"],
  [4,23,1,1,"b"], [11,23,1,1,"b"],
  [4,25,5,1,"b"], [11,25,5,1,"b"],
];
const FIGHTER_FACE: PB[] = [
  [5,3,3,2,"W"], [12,3,3,2,"W"],
  [6,4,1,1,"E"], [13,4,1,1,"E"],
  [8,7,4,1,"s"],
];

// ── MAGE sprite ─────────────────────────────────────────────────────────────
// Robed wizard with tall pointed hat; staff on right
const MAGE_BODY: PB[] = [
  // Hat (pointed, 5 rows narrowing to tip)
  [9,0,2,1,"A"], [8,1,4,1,"A"], [7,2,6,1,"A"], [6,3,8,1,"A"], [5,4,10,1,"A"],
  [5,4,1,1,"L"], [9,0,1,1,"L"],
  // Hat band (accent, 2 rows, wider than hat)
  [4,5,12,2,"X"], [4,5,1,1,"x"],
  // Face (8 px wide)
  [6,7,8,6,"S"],
  // Neck
  [9,13,2,1,"S"],
  // Collar
  [7,14,6,1,"A"],
  // Sleeves
  [5,15,2,6,"A"], [13,15,2,6,"A"],
  // Hands
  [5,21,2,1,"S"], [13,21,2,1,"S"],
  // Robe body: narrows then widens
  [7,15,6,3,"A"], [8,18,4,3,"A"],
  [6,21,8,2,"A"], [5,23,10,3,"A"],
  // Robe shading
  [7,15,1,9,"L"], [12,15,1,9,"a"],
  // Magic emblem (gold cross / orb on chest)
  [10,16,1,5,"G"], [8,18,4,1,"G"], [9,17,2,1,"X"],
  // Staff (right of character)
  [17,13,1,13,"M"], [15,12,4,2,"G"],
  [16,11,2,2,"X"], [16,11,1,1,"W"],
];
const MAGE_FACE: PB[] = [
  [7,8,2,2,"W"], [11,8,2,2,"W"],
  [8,9,1,1,"E"], [12,9,1,1,"E"],
  [9,11,2,1,"s"],
];

// ── RANGER sprite ───────────────────────────────────────────────────────────
// Hooded archer with quiver and target emblem; slim build, knee-high boots
const RANGER_BODY: PB[] = [
  // Hood
  [8,0,4,1,"H"], [7,1,6,1,"H"], [6,2,8,5,"H"], [6,7,8,1,"H"],
  [6,2,1,5,"h"], [13,2,1,5,"h"],
  // Face (visible inside hood, 6 px wide)
  [7,2,6,5,"S"],
  // Neck
  [9,8,2,1,"S"],
  // Quiver (left, accent coloured)
  [4,7,1,7,"X"], [3,6,2,4,"H"],
  [3,6,1,1,"G"], [3,7,1,1,"G"], [3,8,1,1,"G"],
  // Dark collar
  [7,9,6,1,"H"],
  // Torso (slim)
  [7,10,6,8,"A"], [7,10,1,8,"L"], [12,10,1,8,"a"],
  // Arms (1 px slim)
  [6,10,1,7,"A"], [13,10,1,7,"A"],
  // Hands
  [5,17,2,1,"S"], [13,17,2,1,"S"],
  // Target emblem (concentric pixel rings)
  [9,12,2,1,"G"],
  [8,13,4,1,"G"], [8,15,4,1,"G"],
  [9,16,2,1,"G"],
  [8,13,1,3,"G"], [11,13,1,3,"G"],
  [9,14,2,1,"X"],
  // Belt
  [7,18,6,1,"G"],
  // Legs (slim)
  [7,19,3,3,"P"], [10,19,3,3,"P"],
  // Knee-high boots
  [6,22,4,4,"B"], [10,22,4,4,"B"],
  [6,22,1,1,"b"], [10,22,1,1,"b"],
  [6,25,4,1,"b"], [10,25,4,1,"b"],
];
const RANGER_FACE: PB[] = [
  [7,3,2,1,"W"], [11,3,2,1,"W"],
  [8,3,1,1,"E"], [12,3,1,1,"E"],
  [8,5,4,1,"s"],
];

// ── HEALER sprite ───────────────────────────────────────────────────────────
// White-robed cleric with wide hair, big red cross, gold trim
const HEALER_BODY: PB[] = [
  // Hair (wide and flowing — wider than other classes)
  [4,0,12,2,"H"],
  [4,2,1,7,"H"], [15,2,1,7,"H"],
  [3,3,1,5,"H"], [16,3,1,5,"H"],
  // Face (10 px wide)
  [5,2,10,7,"S"],
  // Neck
  [9,9,2,1,"S"],
  // Gold collar
  [6,10,8,1,"G"], [6,10,1,1,"g"],
  // White robe torso
  [7,11,6,7,"C"], [7,11,1,7,"W"], [12,11,1,7,"c"],
  // Sleeves
  [5,11,2,6,"C"], [13,11,2,6,"C"],
  [5,11,1,1,"W"], [14,11,1,1,"W"],
  // Hands
  [5,17,2,1,"S"], [13,17,2,1,"S"],
  // Red cross (prominent!)
  [9,12,2,6,"R"], [7,14,6,2,"R"], [9,12,1,1,"W"],
  // Gold trim band
  [7,18,6,1,"G"],
  // Wide skirt
  [6,19,8,5,"C"], [5,22,10,4,"C"],
  [6,19,1,5,"W"], [13,19,1,5,"c"],
  // Gold hem
  [5,25,10,1,"G"],
];
const HEALER_FACE: PB[] = [
  [5,3,3,2,"W"], [12,3,3,2,"W"],
  [6,4,1,1,"E"], [13,4,1,1,"E"],
  [5,3,1,1,"W"], [12,3,1,1,"W"],
  [7,7,6,1,"s"],
];

const SPRITE_BODY: Record<AvatarClass, PB[]> = {
  fighter: FIGHTER_BODY,
  mage:    MAGE_BODY,
  ranger:  RANGER_BODY,
  healer:  HEALER_BODY,
};
const SPRITE_FACE: Record<AvatarClass, PB[]> = {
  fighter: FIGHTER_FACE,
  mage:    MAGE_FACE,
  ranger:  RANGER_FACE,
  healer:  HEALER_FACE,
};

// ── Gear overlays ───────────────────────────────────────────────────────────

type GearBlock = [number, number, number, number, string]; // x,y,w,h,hexColor

function helmetBlocks(cls: AvatarClass, rc: string): GearBlock[] {
  const regions: Record<AvatarClass, [number,number,number,number]> = {
    fighter: [5, 0, 10, 6],
    mage:    [4, 5, 12, 2],
    ranger:  [6, 0,  8, 7],
    healer:  [5, 0, 10, 6],
  };
  const [x, y, w, h] = regions[cls];
  return [
    [x,   y,   w,   h,   "#1a1f2e"],
    [x,   y,   w,   1,   rc],
    [x,   y+h-1, w, 1,   rc],
    [x,   y,   1,   h,   rc],
    [x+w-1, y, 1,   h,   rc],
    [x+1, y+1, w-2, h-2, "#0d1220"],
    ...(h > 2 ? [
      [x+2, y+2,         w-4, 1, rc]       as GearBlock,
      [x+Math.floor(w/2)-1, y+1, 2, 1, "#f59e0b"] as GearBlock,
    ] : []),
  ];
}

function armorBlocks(cls: AvatarClass, rc: string): GearBlock[] {
  const regions: Record<AvatarClass, [number,number,number,number]> = {
    fighter: [5, 12, 10, 5],
    mage:    [7, 15,  6, 5],
    ranger:  [7, 10,  6, 7],
    healer:  [7, 11,  6, 7],
  };
  const [x, y, w, h] = regions[cls];
  return [
    [x,   y,   w, 1, rc],
    [x,   y+h-1, w, 1, rc],
    [x,   y,   1, h, rc],
    [x+w-1, y, 1, h, rc],
    [x+1, y+2, w-2, 1, rc],
    [x+1, y+4, w-2, 1, rc],
  ];
}

function weaponBlocks(cls: AvatarClass, rc: string): GearBlock[] {
  if (cls === "mage") {
    return [
      [16, 10, 2, 3, rc],
      [17, 13, 1, 12, rc],
      [15, 12, 4,  2, "#f59e0b"],
    ];
  }
  const sx = 17;
  return [
    [sx,   10, 1, 2, "#f59e0b"],
    [sx,   12, 1, 9, rc],
    [sx-1, 16, 3, 1, "#f59e0b"],
    [sx,   21, 1, 1, rc],
    [sx,   22, 1, 2, "#6b7280"],
  ];
}

function bootsBlocks(cls: AvatarClass, rc: string): GearBlock[] {
  const regions: Record<AvatarClass, [[number,number,number,number],[number,number,number,number]]> = {
    fighter: [[4,23,5,3], [11,23,5,3]],
    mage:    [[7,21,3,5], [10,21,3,5]],
    ranger:  [[6,22,4,4], [10,22,4,4]],
    healer:  [[7,22,3,4], [10,22,3,4]],
  };
  const [L, R] = regions[cls];
  const edge = (r: [number,number,number,number]): GearBlock[] => [
    [r[0], r[1], r[2], 1, rc],
    [r[0], r[1]+r[3]-1, r[2], 1, rc],
    [r[0], r[1], 1, r[3], rc],
    [r[0]+r[2]-1, r[1], 1, r[3], rc],
    [r[0], r[1], r[2], r[3], "#1a1f2e"],
  ];
  return [...edge(L), ...edge(R),
    [L[0], L[1], L[2], 1, rc],
    [R[0], R[1], R[2], 1, rc],
    [L[0], L[1]+L[3]-1, L[2], 1, rc],
    [R[0], R[1]+R[3]-1, R[2], 1, rc],
  ];
}

function accessoryBlocks(rc: string): GearBlock[] {
  return [
    [1, 12, 3, 5, "#0f1523"],
    [1, 12, 3, 1, rc], [1, 16, 3, 1, rc],
    [1, 12, 1, 5, rc], [3, 12, 1, 5, rc],
    [2, 13, 1, 1, "#f59e0b"],
    [2, 15, 1, 1, "#ffffff"],
  ];
}

// ── Main component ──────────────────────────────────────────────────────────

export function AvatarRenderer({
  color,
  skin = "light",
  avatarClass,
  equipped = [],
  size = 200,
  showGlow = true,
}: AvatarRendererProps) {
  const accent = CLASS_ACCENTS[avatarClass] ?? "#6366f1";
  const cm = buildColorMap(color, skin, accent);

  const equippedMap = new Map(equipped.map(e => [e.slot, e]));

  const gearBlocks: GearBlock[] = [];
  const helmet  = equippedMap.get("helmet");
  const armor   = equippedMap.get("armor");
  const weapon  = equippedMap.get("weapon");
  const boots   = equippedMap.get("boots");
  const accessory = equippedMap.get("accessory");

  if (helmet)    gearBlocks.push(...helmetBlocks(avatarClass, RARITY_COLORS[helmet.rarity]));
  if (armor)     gearBlocks.push(...armorBlocks(avatarClass, RARITY_COLORS[armor.rarity]));
  if (weapon)    gearBlocks.push(...weaponBlocks(avatarClass, RARITY_COLORS[weapon.rarity]));
  if (boots)     gearBlocks.push(...bootsBlocks(avatarClass, RARITY_COLORS[boots.rarity]));
  if (accessory) gearBlocks.push(...accessoryBlocks(RARITY_COLORS[accessory.rarity]));

  const bodyBlocks = SPRITE_BODY[avatarClass] ?? [];
  const faceBlocks = SPRITE_FACE[avatarClass] ?? [];

  const glowFilter = showGlow
    ? `drop-shadow(0 0 ${Math.max(3, size / 24)}px ${color}99)`
    : undefined;

  return (
    <svg
      viewBox="0 0 20 28"
      width={size}
      height={size * 1.4}
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`${avatarClass} avatar`}
      style={{ filter: glowFilter, imageRendering: "pixelated" }}
    >
      {/* Body layer */}
      {bodyBlocks.map(([x, y, w, h, key], i) => (
        <rect key={`b${i}`} x={x} y={y} width={w} height={h} fill={fill(key, cm)} />
      ))}

      {/* Gear overlay layer */}
      {gearBlocks.map(([x, y, w, h, hexColor], i) => (
        <rect key={`g${i}`} x={x} y={y} width={w} height={h} fill={hexColor} />
      ))}

      {/* Face layer (always on top so gear doesn't cover eyes) */}
      {faceBlocks.map(([x, y, w, h, key], i) => (
        <rect key={`f${i}`} x={x} y={y} width={w} height={h} fill={fill(key, cm)} />
      ))}
    </svg>
  );
}
