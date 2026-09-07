import { eq, and, lte } from "drizzle-orm";
import { db, gearItemsTable, userGearTable, activityTable, usersTable } from "@workspace/db";
import type { GearRarity } from "@workspace/db";
import { rollLoot, lootSeed, LOOT_BONUS_COINS } from "./loot-tables";
import { getLevelInfo } from "./gamification";
import { awardCoins } from "./award-coins";

export interface GearRewardInfo {
  gearItemId: number;
  name: string;
  slot: string;
  rarity: string;
  statPower: number;
  icon: string;
}

// Ordered best → worst for fallback chain
const RARITY_CHAIN: GearRarity[] = ["legendary", "epic", "rare", "common"];

/**
 * Determine target gear rarity for an account-streak milestone.
 * isHighValue: the completing task awards >= 50 XP (hard / high-priority task).
 */
export function getStreakGearRarity(streak: number, isHighValue: boolean): GearRarity {
  if (streak >= 100) return "legendary";
  if (streak >= 60)  return "epic";
  if (streak >= 30)  return isHighValue ? "epic" : "rare";
  if (streak >= 14)  return "rare";
  if (streak >= 7)   return isHighValue ? "rare" : "common";
  return "common"; // 3-day milestone
}

/**
 * Determine target gear rarity for a habit-streak milestone (by totalCompletions).
 * More completions of the same recurring task = more substantial commitment.
 */
export function getHabitGearRarity(totalCompletions: number): GearRarity {
  if (totalCompletions >= 100) return "legendary";
  if (totalCompletions >= 60)  return "epic";
  if (totalCompletions >= 15)  return "rare";
  return "common"; // 5-completion milestone
}

/** Returns true when totalCompletions crosses a habit gear reward threshold. */
export function isHabitGearMilestone(totalCompletions: number): boolean {
  return (
    [5, 15, 30, 60, 100].includes(totalCompletions) ||
    (totalCompletions > 100 && totalCompletions % 50 === 0)
  );
}

/**
 * Select and award a free gear item from the catalog.
 *
 * Selection rules (in priority order):
 *   1. Target the requested rarity; fall back one tier at a time if nothing qualifies.
 *   2. Only consider items the user does NOT already own.
 *   3. Within the rarity tier, prefer items in slots the user has no gear for at all
 *      (fill empty slots first so the award is immediately useful).
 *   4. Among the remaining pool, pick randomly.
 *
 * Returns null only when every qualifying item at every rarity tier is already owned.
 */
export async function awardStreakGear(
  userId: number,
  userLevel: number,
  targetRarity: GearRarity,
  reason: string,
): Promise<GearRewardInfo | null> {
  const startIdx = RARITY_CHAIN.indexOf(targetRarity);
  const rarityChain = RARITY_CHAIN.slice(startIdx);

  // Pre-fetch everything in two queries to avoid N+1s inside the loop.
  const ownedRows = await db
    .select({ gearItemId: userGearTable.gearItemId })
    .from(userGearTable)
    .where(eq(userGearTable.userId, userId));
  const ownedIds = new Set(ownedRows.map((r) => r.gearItemId));

  const ownedSlotRows = await db
    .select({ slot: gearItemsTable.slot })
    .from(gearItemsTable)
    .innerJoin(
      userGearTable,
      and(
        eq(userGearTable.gearItemId, gearItemsTable.id),
        eq(userGearTable.userId, userId),
      ),
    );
  const ownedSlots = new Set(ownedSlotRows.map((r) => r.slot));

  for (const rarity of rarityChain) {
    const candidates = await db
      .select()
      .from(gearItemsTable)
      .where(
        and(
          eq(gearItemsTable.rarity, rarity),
          lte(gearItemsTable.levelRequired, userLevel),
        ),
      );

    const unowned = candidates.filter((g) => !ownedIds.has(g.id));
    if (unowned.length === 0) continue;

    // Prefer slots the user hasn't unlocked anything for
    const emptySlotItems = unowned.filter((g) => !ownedSlots.has(g.slot));
    const pool = emptySlotItems.length > 0 ? emptySlotItems : unowned;
    const item = pool[Math.floor(Math.random() * pool.length)];

    await db
      .insert(userGearTable)
      .values({ userId, gearItemId: item.id, equipped: false })
      .onConflictDoNothing();

    await db.insert(activityTable).values({
      userId,
      type: "gear_earned",
      description: `Gear reward: ${item.name} (${item.rarity}) — ${reason}`,
      points: 0,
    });

    return {
      gearItemId: item.id,
      name: item.name,
      slot: item.slot,
      rarity: item.rarity,
      statPower: item.statPower,
      icon: item.icon,
    };
  }

  return null; // All qualifying items already owned
}

/** A resolved treasure drop for an encounter fell — a gear item, or a coins-only
 *  "small find" (rarity/gear null). Rides back on the encounter hit for the reveal. */
export interface LootDrop {
  rarity: GearRarity | null;
  gear: GearRewardInfo | null;
  bonusCoins: number;
}

/**
 * The Campaign — second wave (Loot Tables): resolve and grant a fell's treasure.
 * Seeded drop roll (loot-tables) → award gear at the rolled rarity via the same
 * unowned/empty-slot selection above; if nothing drops (or every item at that
 * rarity is already owned), grant a small coins-only find so the fell still
 * rewards. Upside-only — this only ever adds, never touching base felled coins.
 *
 * DB-only (its own connection); call it AFTER the fell transaction, best-effort.
 */
export async function awardLoot(
  userId: number,
  encounterId: number,
  tier: number,
): Promise<LootDrop> {
  const roll = rollLoot({ tier, seed: lootSeed(userId, encounterId, tier) });
  if (roll.rarity) {
    const [u] = await db
      .select({ totalPoints: usersTable.totalPoints })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    const level = getLevelInfo(u?.totalPoints ?? 0).level;
    const gear = await awardStreakGear(userId, level, roll.rarity, "loot_drop");
    if (gear) return { rarity: gear.rarity as GearRarity, gear, bonusCoins: 0 };
    // Every item at/under that rarity is already owned — fall through to a coin find.
  }
  await db.transaction((tx) => awardCoins(tx, userId, LOOT_BONUS_COINS, "boss_win"));
  return { rarity: null, gear: null, bonusCoins: LOOT_BONUS_COINS };
}
