// Act VI Life Kingdoms: life areas as places. Structure (lifetime points) is
// persisted and monotonic; tier, liveliness and neglect are all derived at read
// time and stored nowhere — same discipline as companion.ts / hero-care.ts.

export type KingdomId = "hearth" | "wellspring" | "forge" | "athenaeum" | "crossroads" | "capital";

export type KingdomMeta = {
  id: KingdomId;
  name: string;
  /** The capital grows but is excluded from the balance reading. */
  isCapital: boolean;
};

export const KINGDOMS: KingdomMeta[] = [
  { id: "hearth",     name: "Hearth",     isCapital: false },
  { id: "wellspring", name: "Wellspring", isCapital: false },
  { id: "forge",      name: "Forge",      isCapital: false },
  { id: "athenaeum",  name: "Athenaeum",  isCapital: false },
  { id: "crossroads", name: "Crossroads", isCapital: false },
  { id: "capital",    name: "Capital",    isCapital: true  },
];

/** The five balance kingdoms, in display order. Excludes the capital. */
export const BALANCE_KINGDOMS: KingdomId[] = KINGDOMS.filter((k) => !k.isCapital).map((k) => k.id);

export const CATEGORY_TO_KINGDOM: Record<string, KingdomId> = {
  household: "hearth",
  errands:   "hearth",
  health:    "wellspring",
  self_care: "wellspring",
  deep_work: "forge",
  admin:     "forge",
  finance:   "forge",
  learning:  "athenaeum",
  creative:  "athenaeum",
  social:    "crossroads",
  travel:    "crossroads",
  default:   "capital",
};

/** Unknown categories fall to the capital — they carry no balance meaning. */
export function kingdomForCategory(category: string): KingdomId {
  return CATEGORY_TO_KINGDOM[category] ?? "capital";
}

export type KingdomTierInfo = { tier: number; name: string; minPoints: number };

const KINGDOM_TIERS: KingdomTierInfo[] = [
  { tier: 5, name: "Stronghold", minPoints: 8000 },
  { tier: 4, name: "Town",       minPoints: 3000 },
  { tier: 3, name: "Village",    minPoints: 1000 },
  { tier: 2, name: "Settlement", minPoints: 250 },
  { tier: 1, name: "Outpost",    minPoints: 1 },
  { tier: 0, name: "Wild",       minPoints: 0 },
];

/** Absolute thresholds — never relative to the user's other kingdoms, which
 *  would make the strongest kingdom permanently "the capital" and destroy the
 *  balance signal. */
export function kingdomTier(points: number): KingdomTierInfo {
  for (const t of KINGDOM_TIERS) {
    if (points >= t.minPoints) return t;
  }
  return KINGDOM_TIERS[KINGDOM_TIERS.length - 1]!;
}
