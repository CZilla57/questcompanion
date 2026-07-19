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

export type Liveliness = "dormant" | "stirring" | "steady" | "bustling";

/** Rolling window for the liveliness reading. */
export const LIVELINESS_WINDOW_DAYS = 14;

/**
 * Below this many recent balance-kingdom points, the world reads as *resting*
 * rather than producing per-kingdom verdicts. A plain zero-check is not enough:
 * with one quest in the window, share math would report that kingdom at 100%
 * and the other four as pointed neglect. The floor stops the instrument drawing
 * confident conclusions from a sample too small to support them.
 */
export const WORLD_RESTING_THRESHOLD = 100;

/** Sum of recent points across the five balance kingdoms. Excludes the capital. */
export function balanceRecentTotal(recentByKingdom: Partial<Record<KingdomId, number>>): number {
  return BALANCE_KINGDOMS.reduce((sum, id) => sum + (recentByKingdom[id] ?? 0), 0);
}

export function isWorldResting(recentByKingdom: Partial<Record<KingdomId, number>>): boolean {
  return balanceRecentTotal(recentByKingdom) < WORLD_RESTING_THRESHOLD;
}

/**
 * Share-based, never absolute. The denominator excludes the capital so that
 * uncategorized work cannot dilute every real kingdom's share.
 */
export function deriveLiveliness(kingdomRecentPoints: number, balanceTotal: number): Liveliness {
  if (kingdomRecentPoints <= 0 || balanceTotal <= 0) return "dormant";
  const share = kingdomRecentPoints / balanceTotal;
  if (share < 0.10) return "stirring";
  if (share <= 0.30) return "steady";
  return "bustling";
}

export type NeglectInvitation = { kingdomId: KingdomId; kingdomName: string };

/**
 * "You've built here before, and haven't visited lately." Self-calibrating: it
 * only ever names a kingdom the user has actually invested in, so it reflects
 * their pattern rather than prescribing a life.
 *
 * Suppressed entirely while the world is resting — telling someone who has been
 * away from everything that they have neglected one area is exactly wrong, and
 * absence is already hunger's and the companion's territory.
 */
export function deriveNeglectInvitation(args: {
  lifetimeByKingdom: Partial<Record<KingdomId, number>>;
  recentByKingdom: Partial<Record<KingdomId, number>>;
}): NeglectInvitation | null {
  if (isWorldResting(args.recentByKingdom)) return null;

  const total = balanceRecentTotal(args.recentByKingdom);

  const candidates = BALANCE_KINGDOMS
    .map((id) => ({
      id,
      lifetime: args.lifetimeByKingdom[id] ?? 0,
      liveliness: deriveLiveliness(args.recentByKingdom[id] ?? 0, total),
    }))
    .filter((k) => k.lifetime > 0 && k.liveliness === "dormant")
    .sort((a, b) => b.lifetime - a.lifetime);

  const top = candidates[0];
  if (!top) return null;
  return { kingdomId: top.id, kingdomName: KINGDOMS.find((k) => k.id === top.id)!.name };
}
