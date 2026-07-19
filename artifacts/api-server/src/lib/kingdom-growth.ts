import { sql } from "drizzle-orm";
import { kingdomPointsTable } from "@workspace/db";
import { kingdomForCategory, type KingdomId } from "./kingdoms";

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

// Structurally typed against the transaction handle rather than importing
// drizzle's PgTransaction generics, which are painful to name at a call site
// and would couple this lib to the driver.
type InsertCapableTx = { insert: (table: typeof kingdomPointsTable) => any };

/**
 * Persist the growth decision, creating the row on first contact. Called inside
 * the completion transaction.
 *
 * INVARIANT: only ever adds. There is deliberately no matching shrink function —
 * uncomplete and delete leave kingdom points untouched, which is what makes a
 * quiet kingdom read as asleep rather than ruined.
 */
export async function growKingdom(
  tx: InsertCapableTx,
  userId: number,
  category: string,
  basePoints: number,
): Promise<void> {
  const growth = kingdomGrowth(category, basePoints);
  if (!growth) return;
  await tx
    .insert(kingdomPointsTable)
    .values({ userId, kingdomId: growth.kingdomId, lifetimePoints: growth.points })
    .onConflictDoUpdate({
      target: [kingdomPointsTable.userId, kingdomPointsTable.kingdomId],
      set: {
        lifetimePoints: sql`${kingdomPointsTable.lifetimePoints} + ${growth.points}`,
        updatedAt: new Date(),
      },
    });
}
