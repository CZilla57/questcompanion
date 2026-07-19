import { and, eq, sql, or } from "drizzle-orm";
import {
  db, badgesTable, userBadgesTable, activityTable,
  partnershipsTable, allyNudgesTable, worldBossAttacksTable,
} from "@workspace/db";
import { qualifyingBadges, type BadgeMetric, type BadgeStats } from "./badge-rules";

export type { BadgeMetric, BadgeStats } from "./badge-rules";

/** A full badge row as stored. */
export type BadgeRow = typeof badgesTable.$inferSelect;

/**
 * Grants every badge the user newly qualifies for under `stats`, writing an
 * activity row per grant.  Returns the badges actually inserted.
 *
 * `onConflictDoNothing` + the `user_badges` unique index make concurrent calls
 * safe: only the insert that wins records activity, so a badge can never be
 * announced twice.
 */
export async function grantQualifyingBadges(
  userId: number,
  stats: BadgeStats,
  opts: { activityPrefix?: string } = {},
): Promise<BadgeRow[]> {
  const metrics = Object.keys(stats) as BadgeMetric[];
  if (metrics.length === 0) return [];

  const candidates = await db.select().from(badgesTable)
    .where(or(...metrics.map((m) => eq(badgesTable.metric, m))));
  if (candidates.length === 0) return [];

  const owned = await db.select({ badgeId: userBadgesTable.badgeId })
    .from(userBadgesTable).where(eq(userBadgesTable.userId, userId));
  const ownedIds = new Set(owned.map((r) => r.badgeId));

  const toAward = qualifyingBadges(candidates, stats, ownedIds);
  const prefix = opts.activityPrefix ?? "Earned badge";

  const awarded: BadgeRow[] = [];
  for (const badge of toAward) {
    const [inserted] = await db.insert(userBadgesTable)
      .values({ userId, badgeId: badge.id })
      .onConflictDoNothing()
      .returning();
    if (!inserted) continue;
    await db.insert(activityTable).values({
      userId,
      type: "badge_earned",
      description: `${prefix}: ${badge.name}`,
      points: 0,
    });
    awarded.push(badge);
  }
  return awarded;
}

/** Counts the user's social activity: accepted allies, nudges sent, boss attacks. */
export async function loadSocialStats(userId: number): Promise<BadgeStats> {
  const [[allies], [nudges], [attacks]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(partnershipsTable)
      .where(and(
        eq(partnershipsTable.status, "accepted"),
        or(eq(partnershipsTable.requesterId, userId), eq(partnershipsTable.recipientId, userId)),
      )),
    db.select({ n: sql<number>`count(*)::int` }).from(allyNudgesTable)
      .where(eq(allyNudgesTable.senderId, userId)),
    db.select({ n: sql<number>`count(*)::int` }).from(worldBossAttacksTable)
      .where(eq(worldBossAttacksTable.userId, userId)),
  ]);

  return {
    allies: allies?.n ?? 0,
    nudges_sent: nudges?.n ?? 0,
    boss_attacks: attacks?.n ?? 0,
  };
}

/**
 * Recomputes the user's social counters and grants any newly-earned social
 * badges.  Safe to call after any social action; never throws into the caller's
 * response path.
 */
export async function awardSocialBadges(userId: number): Promise<BadgeRow[]> {
  try {
    return await grantQualifyingBadges(userId, await loadSocialStats(userId));
  } catch (err) {
    // A badge grant must never fail the social action that triggered it.
    console.error("[badges] social award failed for user", userId, err);
    return [];
  }
}
