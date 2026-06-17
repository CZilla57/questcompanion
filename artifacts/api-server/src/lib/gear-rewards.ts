import { eq, and, lte } from "drizzle-orm";
import { db, gearItemsTable, userGearTable, activityTable } from "@workspace/db";
import type { GearRarity } from "@workspace/db";

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
