import { Router, type IRouter } from "express";
import { db, dopamineRewardsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dopamine-rewards", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const rewards = await db
    .select()
    .from(dopamineRewardsTable)
    .where(eq(dopamineRewardsTable.userId, userId))
    .orderBy(dopamineRewardsTable.createdAt);

  res.json(rewards);
});

router.post("/dopamine-rewards", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const rewardText: unknown = req.body?.rewardText;
  if (typeof rewardText !== "string" || rewardText.trim().length === 0) {
    res.status(400).json({ error: "rewardText must be a non-empty string" });
    return;
  }
  const trimmed = rewardText.trim().slice(0, 100);

  const [existing] = await db
    .select({ total: count() })
    .from(dopamineRewardsTable)
    .where(eq(dopamineRewardsTable.userId, userId));

  if ((existing?.total ?? 0) >= 20) {
    res.status(400).json({ error: "Maximum of 20 rewards allowed" });
    return;
  }

  const [reward] = await db
    .insert(dopamineRewardsTable)
    .values({ userId, rewardText: trimmed })
    .returning();

  res.status(201).json(reward);
});

router.delete("/dopamine-rewards/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const id = parseInt(req.params.id!, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [deleted] = await db
    .delete(dopamineRewardsTable)
    .where(and(eq(dopamineRewardsTable.id, id), eq(dopamineRewardsTable.userId, userId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Reward not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
