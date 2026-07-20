import { Router, type IRouter } from "express";
import { db, usersTable, rewardStoreItemsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { tierCost, isValidTier, redeemDecision } from "../lib/coins";
import { spendCoins } from "../lib/award-coins";

const router: IRouter = Router();
const MAX_ITEMS = 20;

function present(item: typeof rewardStoreItemsTable.$inferSelect, balance: number) {
  const d = redeemDecision(balance, item.coinCost);
  return {
    id: item.id,
    userId: item.userId,
    label: item.label,
    tier: item.tier,
    coinCost: item.coinCost,
    createdAt: item.createdAt.toISOString(),
    affordable: d.affordable,
    remaining: d.remaining,
  };
}

async function currentBalance(userId: number): Promise<number> {
  const [user] = await db.select({ balance: usersTable.coinBalance }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.balance ?? 0;
}

router.get("/rewards-store", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const balance = await currentBalance(userId);
  const items = await db
    .select()
    .from(rewardStoreItemsTable)
    .where(eq(rewardStoreItemsTable.userId, userId))
    .orderBy(rewardStoreItemsTable.createdAt);
  res.json(items.map((it) => present(it, balance)));
});

router.post("/rewards-store", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const label: unknown = req.body?.label;
  const tier: unknown = req.body?.tier;
  if (typeof label !== "string" || label.trim().length === 0) {
    res.status(400).json({ error: "label must be a non-empty string" }); return;
  }
  if (typeof tier !== "string" || !isValidTier(tier)) {
    res.status(400).json({ error: "tier must be one of small|medium|large|treat" }); return;
  }
  const trimmed = label.trim().slice(0, 100);

  const [existing] = await db
    .select({ total: count() })
    .from(rewardStoreItemsTable)
    .where(eq(rewardStoreItemsTable.userId, userId));
  if ((existing?.total ?? 0) >= MAX_ITEMS) {
    res.status(400).json({ error: `Maximum of ${MAX_ITEMS} rewards allowed` }); return;
  }

  const [item] = await db
    .insert(rewardStoreItemsTable)
    .values({ userId, label: trimmed, tier, coinCost: tierCost(tier) })
    .returning();
  const balance = await currentBalance(userId);
  res.status(201).json(present(item, balance));
});

router.delete("/rewards-store/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const id = parseInt(req.params.id!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db
    .delete(rewardStoreItemsTable)
    .where(and(eq(rewardStoreItemsTable.id, id), eq(rewardStoreItemsTable.userId, userId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Reward not found" }); return; }
  res.json({ success: true });
});

router.post("/rewards-store/:id/redeem", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const id = parseInt(req.params.id!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  type Outcome =
    | { status: "not_found" }
    | { status: "insufficient"; balance: number; remaining: number }
    | { status: "ok"; balance: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [item] = await tx
      .select()
      .from(rewardStoreItemsTable)
      .where(and(eq(rewardStoreItemsTable.id, id), eq(rewardStoreItemsTable.userId, userId)));
    if (!item) return { status: "not_found" };

    const spent = await spendCoins(tx, userId, item.coinCost, "redeem", { rewardItemId: item.id });
    if (!spent.ok) {
      return { status: "insufficient", balance: spent.balance, remaining: spent.remaining };
    }
    return { status: "ok", balance: spent.balance };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Reward not found" }); return; }
  if (outcome.status === "insufficient") {
    // Gentle, not an error: "N more to go". HTTP 200 so it never reads as failure.
    res.status(200).json({ redeemed: false, balance: outcome.balance, affordable: false, remaining: outcome.remaining });
    return;
  }
  res.status(200).json({ redeemed: true, balance: outcome.balance, affordable: true, remaining: 0 });
});

export default router;
