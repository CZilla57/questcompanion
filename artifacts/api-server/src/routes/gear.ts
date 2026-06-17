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

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const levelInfo = getLevelInfo(user.totalPoints);
  if (levelInfo.level < item.levelRequired) {
    res.status(403).json({ error: `Requires level ${item.levelRequired}` }); return;
  }
  if (user.totalPoints < item.costXp) {
    res.status(403).json({ error: "Not enough XP" }); return;
  }

  const existing = await db.select().from(userGearTable)
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));
  if (existing.length > 0) {
    res.status(409).json({ error: "Already owned" }); return;
  }

  const newPoints = user.totalPoints - item.costXp;
  const newLevel = getLevelInfo(newPoints).level;

  await db.transaction(async (tx) => {
    await tx.update(usersTable)
      .set({ totalPoints: newPoints, currentLevel: newLevel })
      .where(eq(usersTable.id, userId));
    await tx.insert(userGearTable).values({ userId, gearItemId: gearId });
    await tx.insert(activityTable).values({
      userId,
      type: "task_completed",
      description: `Purchased ${item.name} from the Gear Store`,
      points: -item.costXp,
    });
  });

  res.json({ success: true, xpSpent: item.costXp, remainingXp: newPoints, item });
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

  await db.update(userGearTable)
    .set({ equipped: true })
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));

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
