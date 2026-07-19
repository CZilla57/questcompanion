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

export const MAX_CAPITAL_TIER = 11;

/**
 * The capital's own ladder, twelve stages deep. Separate from KINGDOM_TIERS
 * because the capital accumulates roughly 5-6x faster than any single kingdom:
 * it is the sum of all of them. Tier 7 lands near "all five at Village" and
 * tier 11 near "all five at Stronghold", so the top of the ladder means
 * something specific rather than being an arbitrary ceiling.
 *
 * Absolute thresholds, never relative to the user's own history - same
 * discipline as KINGDOM_TIERS and for the same reason.
 */
export const CAPITAL_TIERS: KingdomTierInfo[] = [
  { tier: 11, name: "Eternal Capital", minPoints: 40000 },
  { tier: 10, name: "Crown City",      minPoints: 25000 },
  { tier: 9,  name: "Metropolis",      minPoints: 16000 },
  { tier: 8,  name: "Grand City",      minPoints: 10000 },
  { tier: 7,  name: "City",            minPoints: 6000 },
  { tier: 6,  name: "Borough",         minPoints: 3500 },
  { tier: 5,  name: "Town",            minPoints: 2000 },
  { tier: 4,  name: "Village",         minPoints: 1000 },
  { tier: 3,  name: "Hamlet",          minPoints: 400 },
  { tier: 2,  name: "Camp",            minPoints: 150 },
  { tier: 1,  name: "Waystation",      minPoints: 1 },
  { tier: 0,  name: "Wilds",           minPoints: 0 },
];

export function capitalTier(points: number): KingdomTierInfo {
  for (const t of CAPITAL_TIERS) {
    if (points >= t.minPoints) return t;
  }
  return CAPITAL_TIERS[CAPITAL_TIERS.length - 1]!;
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

/**
 * The capital is the realm's grand total: every base point ever earned,
 * including the uncategorized work held in its own row.
 *
 * Derived, never stored. A sum of monotonic values is monotonic, so the
 * capital can never regress, and no backfill is needed for existing users.
 *
 * Deliberately sums ALL SIX ids, not BALANCE_KINGDOMS — this is the one place
 * the capital is included on purpose. It must never be reused as a balance
 * denominator; see balanceRecentTotal for that.
 */
export function capitalLifetime(
  lifetimeByKingdom: Partial<Record<KingdomId, number>>,
): number {
  return KINGDOMS.reduce((sum, k) => sum + (lifetimeByKingdom[k.id] ?? 0), 0);
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

export type KingdomGrowth = { kingdomId: KingdomId; points: number };

/**
 * Pure growth decision: which kingdom a completed quest feeds, and by how much.
 * Null means "nothing to record".
 *
 * The caller MUST pass base `tasks.points`, never the multiplier-boosted
 * `pointsAwarded`: an instrument meant to reflect real life must not move
 * because the user bought an XP perk.
 */
export function kingdomGrowth(category: string, basePoints: number): KingdomGrowth | null {
  if (basePoints <= 0) return null;
  return { kingdomId: kingdomForCategory(category), points: basePoints };
}

export type KingdomStateView = {
  id: KingdomId;
  name: string;
  isCapital: boolean;
  lifetimePoints: number;
  tier: number;
  tierName: string;
  liveliness: Liveliness | null;
};

/**
 * Shapes the full six-kingdom payload. Pure and DB-free so it can be tested
 * directly - the route is then only DB reads plus one call to this.
 *
 * The capital is the realm's grand total on its own 12-stage ladder and
 * reports NO liveliness: liveliness is a share of recent activity, and a
 * cumulative total has no share. Null, never a fabricated value.
 *
 * `balanceRecentTotal` excludes the capital, so capital points can never
 * reach the denominator that decides the five kingdoms' liveliness.
 */
export function kingdomStates(
  lifetimeByKingdom: Partial<Record<KingdomId, number>>,
  recentByKingdom: Partial<Record<KingdomId, number>>,
): KingdomStateView[] {
  const total = balanceRecentTotal(recentByKingdom);
  return KINGDOMS.map((k) => {
    const lifetime = k.isCapital
      ? capitalLifetime(lifetimeByKingdom)
      : (lifetimeByKingdom[k.id] ?? 0);
    const t = k.isCapital ? capitalTier(lifetime) : kingdomTier(lifetime);
    return {
      id: k.id,
      name: k.name,
      isCapital: k.isCapital,
      lifetimePoints: lifetime,
      tier: t.tier,
      tierName: t.name,
      liveliness: k.isCapital ? null : deriveLiveliness(recentByKingdom[k.id] ?? 0, total),
    };
  });
}
