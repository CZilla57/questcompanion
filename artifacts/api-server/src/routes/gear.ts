import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, gearItemsTable, userGearTable, activityTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { gearCoinCost } from "../lib/coins";
import { spendCoins } from "../lib/award-coins";

const router: IRouter = Router();

router.get("/gear/store", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const allItems = await db.select().from(gearItemsTable)
    .orderBy(gearItemsTable.levelRequired, gearItemsTable.statPower);
  const owned = await db.select().from(userGearTable).where(eq(userGearTable.userId, userId));

  const ownedMap = new Map(owned.map(g => [g.gearItemId, g]));
  const levelInfo = getLevelInfo(user.totalPoints);

  const items = allItems.map(item => {
    const costCoins = gearCoinCost(item.rarity);
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      slot: item.slot,
      rarity: item.rarity,
      statPower: item.statPower,
      costCoins,
      levelRequired: item.levelRequired,
      icon: item.icon,
      spriteId: item.spriteId ?? null,
      owned: ownedMap.has(item.id),
      equipped: ownedMap.get(item.id)?.equipped ?? false,
      canAfford: user.coinBalance >= costCoins,
      meetsLevel: levelInfo.level >= item.levelRequired,
    };
  });

  res.json({ items, coinBalance: user.coinBalance, userLevel: levelInfo.level });
});

router.post("/gear/:id/buy", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const gearId = parseInt(req.params.id, 10);

  const [item] = await db.select().from(gearItemsTable).where(eq(gearItemsTable.id, gearId));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  // All economy checks and the write happen inside a single transaction with a row-level
  // lock on the user row.  This prevents concurrent purchase requests from reading a stale
  // coin balance and both passing the affordability check against the same pool of coins.
  type BuyOutcome =
    | { status: "insufficient_level" }
    | { status: "already_owned" }
    | { status: "insufficient"; balance: number; remaining: number }
    | { status: "ok"; balance: number; cost: number };

  let outcome: BuyOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<BuyOutcome> => {
      // Lock the user row so concurrent purchases serialize here.
      const [user] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, userId))
        .for("update");
      if (!user) return { status: "insufficient", balance: 0, remaining: gearCoinCost(item.rarity) };

      const levelInfo = getLevelInfo(user.totalPoints);
      if (levelInfo.level < item.levelRequired) return { status: "insufficient_level" };

      // Re-check ownership inside the transaction to prevent duplicate rows from a
      // concurrent purchase of the same item (the unique constraint is the hard guard;
      // this check provides a clean 409 error message before the insert).
      const existing = await tx.select({ id: userGearTable.id })
        .from(userGearTable)
        .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));
      if (existing.length > 0) return { status: "already_owned" };

      const cost = gearCoinCost(item.rarity);
      const spent = await spendCoins(tx, userId, cost, "gear");
      if (!spent.ok) return { status: "insufficient", balance: spent.balance, remaining: spent.remaining };

      await tx.insert(userGearTable)
        .values({ userId, gearItemId: gearId })
        .onConflictDoNothing();

      // Zero XP delta and an honest type — purchases are no longer disguised as
      // task_completed rows (Honest Coin).
      await tx.insert(activityTable).values({
        userId,
        type: "gear_bought",
        description: `Purchased ${item.name} from the Gear Store`,
        points: 0,
      });

      return { status: "ok", balance: spent.balance, cost };
    });
  } catch (err) {
    console.error("gear buy failed", err);
    res.status(500).json({ error: "Purchase failed" });
    return;
  }

  if (outcome.status === "insufficient_level") {
    res.status(403).json({ error: `Requires level ${item.levelRequired}` }); return;
  }
  if (outcome.status === "already_owned") {
    res.status(409).json({ error: "Already owned" }); return;
  }
  if (outcome.status === "insufficient") {
    // Gentle, not an error: "N more to go". HTTP 200 so it never reads as failure.
    res.status(200).json({
      purchased: false, reason: "insufficient",
      balance: outcome.balance, remaining: outcome.remaining,
    });
    return;
  }
  res.status(200).json({
    purchased: true, reason: "ok",
    balance: outcome.balance, remaining: 0, coinsSpent: outcome.cost,
  });
});

router.post("/gear/:id/equip", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const gearId = parseInt(req.params.id, 10);

  const [item] = await db.select().from(gearItemsTable).where(eq(gearItemsTable.id, gearId));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  const owned = await db.select().from(userGearTable)
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));
  if (owned.length === 0) { res.status(403).json({ error: "Item not owned" }); return; }

  // Unequip any other item in the same slot
  const slotGear = await db
    .select({ userGear: userGearTable, gear: gearItemsTable })
    .from(userGearTable)
    .innerJoin(gearItemsTable, eq(userGearTable.gearItemId, gearItemsTable.id))
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.equipped, true)));

  const sameSlot = slotGear.filter(g => g.gear.slot === item.slot);
  for (const g of sameSlot) {
    await db.update(userGearTable)
      .set({ equipped: false })
      .where(eq(userGearTable.id, g.userGear.id));
  }

  // Equip by the specific row ID (owned[0].id) rather than by (userId, gearItemId) to avoid
  // accidentally equipping any stale duplicate rows that existed before the unique constraint
  // was applied.
  await db.update(userGearTable)
    .set({ equipped: true })
    .where(eq(userGearTable.id, owned[0].id));

  res.json({ success: true });
});

router.post("/gear/:id/unequip", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const gearId = parseInt(req.params.id, 10);

  const owned = await db.select().from(userGearTable)
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));
  if (owned.length === 0) { res.status(403).json({ error: "Item not owned" }); return; }

  await db.update(userGearTable)
    .set({ equipped: false })
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));

  res.json({ success: true });
});

export default router;
