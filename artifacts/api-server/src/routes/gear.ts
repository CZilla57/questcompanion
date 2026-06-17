import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, gearItemsTable, userGearTable, activityTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";

const router: IRouter = Router();

router.get("/gear/store", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const allItems = await db.select().from(gearItemsTable).orderBy(gearItemsTable.costXp);
  const owned = await db.select().from(userGearTable).where(eq(userGearTable.userId, userId));

  const ownedMap = new Map(owned.map(g => [g.gearItemId, g]));
  const levelInfo = getLevelInfo(user.totalPoints);

  const items = allItems.map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    slot: item.slot,
    rarity: item.rarity,
    statPower: item.statPower,
    costXp: item.costXp,
    levelRequired: item.levelRequired,
    icon: item.icon,
    owned: ownedMap.has(item.id),
    equipped: ownedMap.get(item.id)?.equipped ?? false,
    canAfford: user.totalPoints >= item.costXp,
    meetsLevel: levelInfo.level >= item.levelRequired,
  }));

  res.json({ items, userXp: user.totalPoints, userLevel: levelInfo.level });
});

router.post("/gear/:id/buy", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const gearId = parseInt(req.params.id, 10);

  const [item] = await db.select().from(gearItemsTable).where(eq(gearItemsTable.id, gearId));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  // All economy checks and the write happen inside a single transaction with a row-level
  // lock on the user row.  This prevents concurrent purchase requests from reading a stale
  // XP balance and both passing the affordability check against the same pool of points.
  type BuyOutcome =
    | { status: "insufficient_level" }
    | { status: "insufficient_xp" }
    | { status: "already_owned" }
    | { status: "ok"; newPoints: number };

  let outcome: BuyOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<BuyOutcome> => {
      // Lock the user row so concurrent purchases serialize here.
      const [user] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, userId))
        .for("update");
      if (!user) return { status: "insufficient_xp" };

      const levelInfo = getLevelInfo(user.totalPoints);
      if (levelInfo.level < item.levelRequired) return { status: "insufficient_level" };
      if (user.totalPoints < item.costXp) return { status: "insufficient_xp" };

      // Re-check ownership inside the transaction to prevent duplicate rows from a
      // concurrent purchase of the same item (the unique constraint is the hard guard;
      // this check provides a clean 409 error message before the insert).
      const existing = await tx.select({ id: userGearTable.id })
        .from(userGearTable)
        .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));
      if (existing.length > 0) return { status: "already_owned" };

      // Deduct XP relative to the current locked balance (not a stale pre-read value).
      const newPoints = user.totalPoints - item.costXp;
      const newLevel = getLevelInfo(newPoints).level;

      await tx.update(usersTable)
        .set({ totalPoints: newPoints, currentLevel: newLevel })
        .where(eq(usersTable.id, userId));

      // The unique constraint on (user_id, gear_item_id) is the last-resort guard; the
      // onConflictDoNothing ensures we never surface a DB error if two requests somehow
      // both reach the insert despite the ownership check above.
      await tx.insert(userGearTable)
        .values({ userId, gearItemId: gearId })
        .onConflictDoNothing();

      await tx.insert(activityTable).values({
        userId,
        type: "task_completed",
        description: `Purchased ${item.name} from the Gear Store`,
        points: -item.costXp,
      });

      return { status: "ok", newPoints };
    });
  } catch {
    res.status(500).json({ error: "Purchase failed" });
    return;
  }

  if (outcome.status === "insufficient_level") {
    res.status(403).json({ error: `Requires level ${item.levelRequired}` }); return;
  }
  if (outcome.status === "insufficient_xp") {
    res.status(403).json({ error: "Not enough XP" }); return;
  }
  if (outcome.status === "already_owned") {
    res.status(409).json({ error: "Already owned" }); return;
  }

  res.json({ success: true, xpSpent: item.costXp, remainingXp: outcome.newPoints, item });
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
