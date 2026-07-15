import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, gearItemsTable, userGearTable, weeklyBattlesTable, activityTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { calcBattlePower } from "./avatar";
import { awardCoins } from "../lib/award-coins";
import { COIN_EARN } from "../lib/coins";

const router: IRouter = Router();

const BATTLE_WIN_XP = 500;
const BATTLE_LOSE_XP = 75;

function getWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getBossPower(weekKey: string): number {
  const match = weekKey.match(/W(\d+)$/);
  const weekNo = match ? parseInt(match[1], 10) : 1;
  return Math.min(90 + (weekNo - 1) * 70, 750);
}

async function getUserPower(userId: number): Promise<number> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return 0;

  const equipped = await db
    .select({ gear: gearItemsTable })
    .from(userGearTable)
    .innerJoin(gearItemsTable, eq(userGearTable.gearItemId, gearItemsTable.id))
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.equipped, true)));

  const gearPower = equipped.reduce((sum, g) => sum + g.gear.statPower, 0);
  const level = getLevelInfo(user.totalPoints).level;
  return calcBattlePower(level, gearPower);
}

router.get("/battle/current", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const weekKey = getWeekKey();
  const bossPower = getBossPower(weekKey);
  const yourPower = await getUserPower(userId);

  const [existing] = await db.select()
    .from(weeklyBattlesTable)
    .where(and(eq(weeklyBattlesTable.userId, userId), eq(weeklyBattlesTable.weekKey, weekKey)));

  res.json({
    weekKey,
    bossPower,
    yourPower,
    entered: !!existing,
    result: existing?.result ?? null,
    xpAwarded: existing?.xpAwarded ?? null,
    roll: existing?.roll ?? null,
    foughtAt: existing?.foughtAt?.toISOString() ?? null,
    winXp: BATTLE_WIN_XP,
    loseXp: BATTLE_LOSE_XP,
  });
});

router.post("/battle/enter", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const weekKey = getWeekKey();

  const [already] = await db.select()
    .from(weeklyBattlesTable)
    .where(and(eq(weeklyBattlesTable.userId, userId), eq(weeklyBattlesTable.weekKey, weekKey)));

  if (already) {
    res.status(409).json({ error: "Already fought this week", existing: already }); return;
  }

  const bossPower = getBossPower(weekKey);
  const yourPower = await getUserPower(userId);

  // Roll between 75% and 125% of player power
  const roll = Math.round(yourPower * (0.75 + Math.random() * 0.5));
  const result: "win" | "lose" = roll >= bossPower ? "win" : "lose";
  const xpAwarded = result === "win" ? BATTLE_WIN_XP : BATTLE_LOSE_XP;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const newPoints = user.totalPoints + xpAwarded;
  const newWeekly = user.weeklyPoints + xpAwarded;
  const newLevel = getLevelInfo(newPoints).level;

  await db.transaction(async (tx) => {
    await tx.insert(weeklyBattlesTable).values({
      userId,
      weekKey,
      powerScore: yourPower,
      bossPower,
      roll,
      result,
      xpAwarded,
    });
    await tx.update(usersTable)
      .set({ totalPoints: newPoints, weeklyPoints: newWeekly, currentLevel: newLevel })
      .where(eq(usersTable.id, userId));
    if (result === "win") {
      await awardCoins(tx, userId, COIN_EARN.bossWin, "boss_win");
    }
    await tx.insert(activityTable).values({
      userId,
      type: "task_completed",
      description: result === "win"
        ? `Weekly Battle: Victory! Rolled ${roll} vs boss ${bossPower}.`
        : `Weekly Battle: Defeated. Rolled ${roll} vs boss ${bossPower}.`,
      points: xpAwarded,
    });
  });

  res.json({ result, xpAwarded, bossPower, yourPower, roll, weekKey });
});

export default router;
