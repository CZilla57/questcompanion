import { Router, type IRouter } from "express";
import { db, usersTable, dopamineRewardsTable, coinTransactionsTable } from "@workspace/db";
import { eq, and, sql, gte } from "drizzle-orm";
import { awardCoins } from "../lib/award-coins";
import { MYSTERY_COST, canOpenMystery, rollMystery } from "../lib/mystery-box";

const router: IRouter = Router();

// Card state: cost + whether a pull is possible right now, plus the gentle reason
// (empty menu / not enough coins) the UI renders as an invite or progress.
router.get("/mystery-box", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const [user] = await db
    .select({ balance: usersTable.coinBalance })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const [rewardRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(dopamineRewardsTable)
    .where(eq(dopamineRewardsTable.userId, userId));

  const balance = user?.balance ?? 0;
  const rewardCount = rewardRow?.total ?? 0;
  const gate = canOpenMystery(balance, rewardCount);

  res.json({
    cost: MYSTERY_COST,
    balance,
    rewardCount,
    canOpen: gate.canOpen,
    reason: gate.reason,
    remaining: gate.remaining,
  });
});

// Spend coins for a random pull from the Dopamine Menu. Non-auth outcomes are all
// HTTP 200 (anti-shame): empty menu and insufficient balance are gentle no-ops,
// never errors. The deduction is an atomic guarded write, so the balance can
// never go negative and a concurrent double-open can't overspend.
router.post("/mystery-box/open", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  type Outcome =
    | { status: "no_rewards"; balance: number }
    | { status: "insufficient"; balance: number; remaining: number }
    | { status: "ok"; balance: number; bonus: number; reward: { id: number; rewardText: string } };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const rewards = await tx
      .select()
      .from(dopamineRewardsTable)
      .where(eq(dopamineRewardsTable.userId, userId))
      .orderBy(dopamineRewardsTable.createdAt);

    if (rewards.length === 0) {
      const [u] = await tx.select({ balance: usersTable.coinBalance }).from(usersTable).where(eq(usersTable.id, userId));
      return { status: "no_rewards", balance: u?.balance ?? 0 };
    }

    const [updated] = await tx
      .update(usersTable)
      .set({ coinBalance: sql`${usersTable.coinBalance} - ${MYSTERY_COST}` })
      .where(and(eq(usersTable.id, userId), gte(usersTable.coinBalance, MYSTERY_COST)))
      .returning({ balance: usersTable.coinBalance });

    if (!updated) {
      const [u] = await tx.select({ balance: usersTable.coinBalance }).from(usersTable).where(eq(usersTable.id, userId));
      const bal = u?.balance ?? 0;
      return { status: "insufficient", balance: bal, remaining: Math.max(0, MYSTERY_COST - bal) };
    }

    await tx.insert(coinTransactionsTable).values({ userId, amount: -MYSTERY_COST, reason: "mystery_open" });

    const { rewardIndex, bonus } = rollMystery(rewards.length, Math.random);
    const reward = rewards[rewardIndex]!;

    // Upside-only bonus, capped at cost by rollMystery — this can never net a gain.
    if (bonus > 0) await awardCoins(tx, userId, bonus, "mystery_bonus");

    return {
      status: "ok",
      balance: updated.balance + bonus,
      bonus,
      reward: { id: reward.id, rewardText: reward.rewardText },
    };
  });

  if (outcome.status === "no_rewards") {
    res.status(200).json({ opened: false, reason: "no_rewards", cost: MYSTERY_COST, balance: outcome.balance, remaining: 0 });
    return;
  }
  if (outcome.status === "insufficient") {
    res.status(200).json({ opened: false, reason: "insufficient", cost: MYSTERY_COST, balance: outcome.balance, remaining: outcome.remaining });
    return;
  }
  res.status(200).json({
    opened: true,
    reason: "ok",
    cost: MYSTERY_COST,
    balance: outcome.balance,
    bonus: outcome.bonus,
    reward: outcome.reward,
  });
});

export default router;
