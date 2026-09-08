import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, userConsumablesTable } from "@workspace/db";
import { spendCoins } from "../lib/award-coins";
import { redeemDecision } from "../lib/coins";
import {
  CONSUMABLES,
  consumableById,
  isConsumableId,
  CONSUMABLE_BUY_REASON,
} from "../lib/consumables";

const router: IRouter = Router();

// Act IV (Tactics & Stakes): the consumables economy. Buy potions/scrolls with
// coins, then queue ONE to boost your next quest's roll (upside-only).

router.get("/consumables", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const owned = await db.select().from(userConsumablesTable).where(eq(userConsumablesTable.userId, userId));
  const qtyById = new Map(owned.map((r) => [r.consumableId, r.quantity]));

  res.json({
    balance: user.coinBalance,
    pending: user.pendingConsumable,
    items: CONSUMABLES.map((c) => {
      const { affordable, remaining } = redeemDecision(user.coinBalance, c.coinCost);
      return {
        id: c.id,
        name: c.name,
        emoji: c.emoji,
        description: c.description,
        coinCost: c.coinCost,
        quantity: qtyById.get(c.id) ?? 0,
        affordable,
        remaining,
      };
    }),
  });
});

router.post("/consumables/:id/buy", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const id = req.params.id!;
  if (!isConsumableId(id)) { res.status(404).json({ error: "Unknown consumable" }); return; }
  const def = consumableById(id)!;

  type Outcome =
    | { status: "not_found" }
    | { status: "insufficient"; balance: number; remaining: number }
    | { status: "ok"; balance: number; quantity: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row: spend + grant must be atomic so a concurrent double-buy
    // can't overspend.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const spent = await spendCoins(tx, userId, def.coinCost, CONSUMABLE_BUY_REASON);
    if (!spent.ok) return { status: "insufficient", balance: spent.balance, remaining: spent.remaining };

    const [row] = await tx
      .insert(userConsumablesTable)
      .values({ userId, consumableId: id, quantity: 1 })
      .onConflictDoUpdate({
        target: [userConsumablesTable.userId, userConsumablesTable.consumableId],
        set: { quantity: sql`${userConsumablesTable.quantity} + 1`, updatedAt: new Date() },
      })
      .returning({ quantity: userConsumablesTable.quantity });

    return { status: "ok", balance: spent.balance, quantity: row!.quantity };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "User not found" }); return; }
  if (outcome.status === "insufficient") {
    // Gentle "N more to go" — HTTP 200 so it never reads as failure.
    res.status(200).json({ purchased: false, reason: "insufficient", balance: outcome.balance, remaining: outcome.remaining });
    return;
  }
  res.status(200).json({ purchased: true, reason: "ok", balance: outcome.balance, quantity: outcome.quantity });
});

// Queue a consumable for the next roll (requires owning at least one), or clear
// the queue when `id` is "none". Only one may be queued at a time.
router.post("/consumables/:id/activate", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const id = req.params.id!;

  if (id === "none") {
    await db.update(usersTable).set({ pendingConsumable: null }).where(eq(usersTable.id, userId));
    res.json({ pending: null });
    return;
  }
  if (!isConsumableId(id)) { res.status(404).json({ error: "Unknown consumable" }); return; }

  const outcome = await db.transaction(async (tx): Promise<{ ok: boolean }> => {
    const [row] = await tx.select().from(userConsumablesTable)
      .where(and(eq(userConsumablesTable.userId, userId), eq(userConsumablesTable.consumableId, id)));
    if (!row || row.quantity <= 0) return { ok: false };
    await tx.update(usersTable).set({ pendingConsumable: id }).where(eq(usersTable.id, userId));
    return { ok: true };
  });

  if (!outcome.ok) { res.status(409).json({ error: "You don't own that consumable yet" }); return; }
  res.json({ pending: id });
});

export default router;
