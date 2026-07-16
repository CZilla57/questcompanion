import { Router, type IRouter } from "express";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import {
  db, usersTable, partnershipsTable, activityTable,
  worldBossWeeksTable, worldBossAttacksTable,
} from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { getWeekKey } from "../lib/week-key";
import { getUserPower } from "./battle";
import { WORLD_BOSS, worldBossHp, dayKey, rollDamage, crossedThreshold } from "../lib/world-boss";
import { awardCoins } from "../lib/award-coins";

const router: IRouter = Router();

// Lazily materialize this week's boss row and return it. The unique(weekKey)
// constraint makes the insert an atomic no-op if another request already created it.
async function ensureBossWeek(weekKey: string) {
  await db.insert(worldBossWeeksTable)
    .values({ weekKey, hp: worldBossHp(weekKey) })
    .onConflictDoNothing();
  const [boss] = await db.select().from(worldBossWeeksTable)
    .where(eq(worldBossWeeksTable.weekKey, weekKey));
  return boss!;
}

// Set of the viewer's accepted-ally user ids.
async function allyIds(userId: number): Promise<Set<number>> {
  const rows = await db.select().from(partnershipsTable)
    .where(and(
      eq(partnershipsTable.status, "accepted"),
      sql`(${partnershipsTable.requesterId} = ${userId} OR ${partnershipsTable.recipientId} = ${userId})`,
    ));
  const ids = new Set<number>();
  for (const p of rows) ids.add(p.requesterId === userId ? p.recipientId : p.requesterId);
  return ids;
}

router.get("/world-boss/current", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const weekKey = getWeekKey();
  const today = dayKey();
  const boss = await ensureBossWeek(weekKey);
  const yourPower = await getUserPower(userId);
  const allies = await allyIds(userId);

  // Per-user damage totals for the week, with display fields.
  const rows = await db
    .select({
      userId: worldBossAttacksTable.userId,
      damage: sql<number>`sum(${worldBossAttacksTable.damage})`.mapWith(Number),
      displayName: usersTable.displayName,
      username: usersTable.username,
      avatarColor: usersTable.avatarColor,
    })
    .from(worldBossAttacksTable)
    .innerJoin(usersTable, eq(usersTable.id, worldBossAttacksTable.userId))
    .where(eq(worldBossAttacksTable.weekKey, weekKey))
    .groupBy(worldBossAttacksTable.userId, usersTable.displayName, usersTable.username, usersTable.avatarColor)
    .orderBy(desc(sql`sum(${worldBossAttacksTable.damage})`));

  const contributors = rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName ?? r.username,
    avatarColor: r.avatarColor,
    damage: r.damage,
    isAlly: allies.has(r.userId),
  }));

  const [mine] = await db
    .select({ total: sql<number>`coalesce(sum(${worldBossAttacksTable.damage}), 0)`.mapWith(Number) })
    .from(worldBossAttacksTable)
    .where(and(eq(worldBossAttacksTable.userId, userId), eq(worldBossAttacksTable.weekKey, weekKey)));

  const [todayRow] = await db.select().from(worldBossAttacksTable)
    .where(and(eq(worldBossAttacksTable.userId, userId), eq(worldBossAttacksTable.dayKey, today)));

  res.json({
    weekKey,
    hp: boss.hp,
    totalDamage: boss.totalDamage,
    defeated: boss.defeatedAt !== null,
    defeatedAt: boss.defeatedAt ? boss.defeatedAt.toISOString() : null,
    attackedToday: !!todayRow,
    yourContribution: mine?.total ?? 0,
    yourPower,
    attackXp: WORLD_BOSS.ATTACK_XP,
    defeatCoins: WORLD_BOSS.DEFEAT_COINS,
    defeatXp: WORLD_BOSS.DEFEAT_XP,
    contributors,
  });
});

router.post("/world-boss/attack", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const weekKey = getWeekKey();
  const today = dayKey();
  await ensureBossWeek(weekKey);
  const power = await getUserPower(userId);
  const damage = rollDamage(power);

  type Outcome =
    | { kind: "already_today" }
    | { kind: "defeated_already" }
    | { kind: "ok"; totalDamage: number; hp: number; justDefeated: boolean; coinsAwarded: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [boss] = await tx.select().from(worldBossWeeksTable)
      .where(eq(worldBossWeeksTable.weekKey, weekKey));
    if (boss!.defeatedAt !== null) return { kind: "defeated_already" };

    // Atomic once-per-day dedup: the insert IS the guard.
    const [attack] = await tx.insert(worldBossAttacksTable)
      .values({ userId, weekKey, dayKey: today, damage })
      .onConflictDoNothing()
      .returning();
    if (!attack) return { kind: "already_today" };

    // Accumulate shared damage atomically; RETURNING gives the post-increment total.
    const [bumped] = await tx.update(worldBossWeeksTable)
      .set({ totalDamage: sql`${worldBossWeeksTable.totalDamage} + ${damage}` })
      .where(eq(worldBossWeeksTable.weekKey, weekKey))
      .returning();
    const newTotal = bumped!.totalDamage;

    // Participation XP for the attacker — always earned (anti-shame floor).
    const [attacker] = await tx.select().from(usersTable).where(eq(usersTable.id, userId));
    const aPoints = attacker!.totalPoints + WORLD_BOSS.ATTACK_XP;
    await tx.update(usersTable).set({
      totalPoints: aPoints,
      weeklyPoints: attacker!.weeklyPoints + WORLD_BOSS.ATTACK_XP,
      currentLevel: getLevelInfo(aPoints).level,
    }).where(eq(usersTable.id, userId));
    await tx.insert(activityTable).values({
      userId,
      type: "task_completed",
      description: `World Boss: dealt ${damage} damage.`,
      points: WORLD_BOSS.ATTACK_XP,
    });

    // Did this attack fell the boss? Claim the kill exactly once.
    let justDefeated = false;
    let coinsAwarded = 0;
    if (crossedThreshold(newTotal - damage, newTotal, boss!.hp)) {
      const [claimed] = await tx.update(worldBossWeeksTable)
        .set({ defeatedAt: new Date() })
        .where(and(eq(worldBossWeeksTable.weekKey, weekKey), sql`${worldBossWeeksTable.defeatedAt} IS NULL`))
        .returning();
      if (claimed) {
        justDefeated = true;
        coinsAwarded = WORLD_BOSS.DEFEAT_COINS;
        // Flat reward to EVERY contributor (dealt >= 1 damage this week).
        const contribRows = await tx.selectDistinct({ userId: worldBossAttacksTable.userId })
          .from(worldBossAttacksTable)
          .where(eq(worldBossAttacksTable.weekKey, weekKey));
        const contribIds = contribRows.map((r) => r.userId);
        const contributors = await tx.select().from(usersTable)
          .where(inArray(usersTable.id, contribIds));
        for (const c of contributors) {
          const cPoints = c.totalPoints + WORLD_BOSS.DEFEAT_XP;
          await tx.update(usersTable).set({
            totalPoints: cPoints,
            weeklyPoints: c.weeklyPoints + WORLD_BOSS.DEFEAT_XP,
            currentLevel: getLevelInfo(cPoints).level,
          }).where(eq(usersTable.id, c.id));
          await awardCoins(tx, c.id, WORLD_BOSS.DEFEAT_COINS, "world_boss_defeat");
          await tx.insert(activityTable).values({
            userId: c.id,
            type: "task_completed",
            description: `World Boss felled! +${WORLD_BOSS.DEFEAT_COINS} coins, +${WORLD_BOSS.DEFEAT_XP} XP.`,
            points: WORLD_BOSS.DEFEAT_XP,
          });
        }
      }
    }

    return { kind: "ok", totalDamage: newTotal, hp: boss!.hp, justDefeated, coinsAwarded };
  });

  if (outcome.kind === "already_today") {
    res.json({ attacked: false, reason: "already_today", damage: null, hp: 0, totalDamage: 0, defeated: false, justDefeated: false, xpAwarded: 0, coinsAwarded: 0 });
    return;
  }
  if (outcome.kind === "defeated_already") {
    res.json({ attacked: false, reason: "defeated", damage: null, hp: 0, totalDamage: 0, defeated: true, justDefeated: false, xpAwarded: 0, coinsAwarded: 0 });
    return;
  }
  res.json({
    attacked: true,
    reason: null,
    damage,
    hp: outcome.hp,
    totalDamage: outcome.totalDamage,
    defeated: outcome.totalDamage >= outcome.hp,
    justDefeated: outcome.justDefeated,
    xpAwarded: WORLD_BOSS.ATTACK_XP,
    coinsAwarded: outcome.coinsAwarded,
  });
});

export default router;
