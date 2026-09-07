import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, gearItemsTable, userGearTable, activityTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { gearCoinCost } from "../lib/coins";
import { spendCoins, awardCoins } from "../lib/award-coins";
import { salvageValue } from "../lib/salvage";
import { ATTUNEMENT_CAP, isAttunable, attunementBonus } from "../lib/attunement";
import type { GearSlot } from "@workspace/db";

const router: IRouter = Router();

// Canonical slot order for the loadout summary — matches the web equipment grid.
const SLOT_ORDER: GearSlot[] = ["weapon", "helmet", "armor", "boots", "accessory"];

router.get("/gear/store", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Only the curated buy-your-way-up ladder shows in the store; drop-only treasures
  // (in_store = false) are found via loot/streak rewards, never sold.
  const allItems = await db.select().from(gearItemsTable)
    .where(eq(gearItemsTable.inStore, true))
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

// Owned-only inventory: every gear item the user owns, joined with its detail,
// grouped for a loadout summary. Read-only depth over the same tables the store
// uses — the `id` is the gear item id, matching the equip/unequip/salvage routes.
router.get("/gear/inventory", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db
    .select({ userGear: userGearTable, gear: gearItemsTable })
    .from(userGearTable)
    .innerJoin(gearItemsTable, eq(userGearTable.gearItemId, gearItemsTable.id))
    .where(eq(userGearTable.userId, userId))
    .orderBy(gearItemsTable.slot, gearItemsTable.statPower);

  const items = rows.map(({ userGear, gear }) => ({
    id: gear.id,
    name: gear.name,
    description: gear.description,
    slot: gear.slot,
    rarity: gear.rarity,
    statPower: gear.statPower,
    icon: gear.icon,
    spriteId: gear.spriteId ?? null,
    equipped: userGear.equipped,
    attuned: userGear.attuned,
    attunable: isAttunable(gear.rarity),
    // The extra battle power this item would grant while equipped + attuned.
    attunementBonus: attunementBonus(gear.statPower),
    salvageValue: salvageValue(gear.rarity),
    acquiredAt: userGear.acquiredAt.toISOString(),
  }));

  // Per-slot loadout: the equipped item in each slot (or null), in grid order.
  const loadout = SLOT_ORDER.map((slot) => ({
    slot,
    item: items.find((it) => it.slot === slot && it.equipped) ?? null,
  }));
  const equippedItems = items.filter((it) => it.equipped);
  // Equipped stat power plus the attunement bonus for each attuned attunable item —
  // the same figure that feeds battle power (see the attunement lib).
  const equippedPower = equippedItems.reduce(
    (sum, it) => sum + it.statPower + (it.attuned && it.attunable ? it.attunementBonus : 0),
    0,
  );
  const attunedCount = equippedItems.filter((it) => it.attuned && it.attunable).length;

  res.json({
    items,
    loadout,
    equippedCount: equippedItems.length,
    equippedPower,
    attunedCount,
    attunementCap: ATTUNEMENT_CAP,
    ownedCount: items.length,
    coinBalance: user.coinBalance,
  });
});

// Salvage an owned, UNEQUIPPED item for coins. Permanent — the item row is
// removed — so equipped items are rejected (unequip first) to protect the
// loadout from an accidental tap. Refund is always positive (upside-only) and,
// by the salvage lib's invariant, strictly less than the buy cost (no arbitrage).
router.post("/gear/:id/salvage", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const gearId = parseInt(req.params.id, 10);

  const [item] = await db.select().from(gearItemsTable).where(eq(gearItemsTable.id, gearId));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  type SalvageOutcome =
    | { status: "not_owned" }
    | { status: "equipped" }
    | { status: "ok"; balance: number; coinsGained: number };

  let outcome: SalvageOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<SalvageOutcome> => {
      // Lock the user row so a concurrent salvage/equip serializes here.
      const [locked] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, userId)).for("update");
      if (!locked) return { status: "not_owned" };

      const owned = await tx.select().from(userGearTable)
        .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));
      if (owned.length === 0) return { status: "not_owned" };
      if (owned.some((g) => g.equipped)) return { status: "equipped" };

      // Remove every owned row for this item (normally one; guards stale
      // pre-unique-constraint duplicates too).
      await tx.delete(userGearTable)
        .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));

      const coinsGained = salvageValue(item.rarity);
      await awardCoins(tx, userId, coinsGained, "gear_salvage");
      const balance = locked.coinBalance + coinsGained;

      await tx.insert(activityTable).values({
        userId,
        type: "gear_salvaged",
        description: `Salvaged ${item.name} for ${coinsGained} coins`,
        points: 0,
      });

      return { status: "ok", balance, coinsGained };
    });
  } catch (err) {
    console.error("gear salvage failed", err);
    res.status(500).json({ error: "Salvage failed" });
    return;
  }

  if (outcome.status === "not_owned") { res.status(403).json({ error: "Item not owned" }); return; }
  if (outcome.status === "equipped") {
    res.status(409).json({ error: "Unequip before salvaging" }); return;
  }
  res.status(200).json({
    salvaged: true,
    coinsGained: outcome.coinsGained,
    balance: outcome.balance,
  });
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
    // Displacing a same-slot item also clears its attunement — attunement only
    // holds while equipped.
    await db.update(userGearTable)
      .set({ equipped: false, attuned: false })
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

  // Unequipping clears attunement too — attunement only holds while equipped.
  await db.update(userGearTable)
    .set({ equipped: false, attuned: false })
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));

  res.json({ success: true });
});

// Attune an owned, equipped, epic/legendary item to draw extra battle power from
// it. Upside-only: the bonus is purely additive and capped at ATTUNEMENT_CAP
// items. The cap is re-checked inside the user-locked tx so concurrent attunes
// can't overshoot it.
router.post("/gear/:id/attune", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const gearId = parseInt(req.params.id, 10);

  const [item] = await db.select().from(gearItemsTable).where(eq(gearItemsTable.id, gearId));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  type AttuneOutcome =
    | { status: "not_owned" }
    | { status: "not_equipped" }
    | { status: "not_attunable" }
    | { status: "cap_full" }
    | { status: "ok" };

  let outcome: AttuneOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<AttuneOutcome> => {
      // Lock the user row so concurrent attunes serialize against the cap.
      const [locked] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, userId)).for("update");
      if (!locked) return { status: "not_owned" };

      if (!isAttunable(item.rarity)) return { status: "not_attunable" };

      const [owned] = await tx.select().from(userGearTable)
        .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));
      if (!owned) return { status: "not_owned" };
      if (!owned.equipped) return { status: "not_equipped" };
      if (owned.attuned) return { status: "ok" }; // idempotent

      // Count currently-attuned items and enforce the cap inside the lock.
      const attuned = await tx.select({ id: userGearTable.id }).from(userGearTable)
        .where(and(eq(userGearTable.userId, userId), eq(userGearTable.attuned, true)));
      if (attuned.length >= ATTUNEMENT_CAP) return { status: "cap_full" };

      await tx.update(userGearTable)
        .set({ attuned: true })
        .where(eq(userGearTable.id, owned.id));
      return { status: "ok" };
    });
  } catch (err) {
    console.error("gear attune failed", err);
    res.status(500).json({ error: "Attune failed" });
    return;
  }

  if (outcome.status === "not_owned") { res.status(403).json({ error: "Item not owned" }); return; }
  if (outcome.status === "not_equipped") { res.status(409).json({ error: "Equip it first" }); return; }
  if (outcome.status === "not_attunable") {
    res.status(409).json({ error: "Only epic and legendary gear can be attuned" }); return;
  }
  if (outcome.status === "cap_full") {
    res.status(409).json({ error: `All ${ATTUNEMENT_CAP} attunement slots are full` }); return;
  }
  res.json({ success: true });
});

router.post("/gear/:id/unattune", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const gearId = parseInt(req.params.id, 10);

  const owned = await db.select().from(userGearTable)
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));
  if (owned.length === 0) { res.status(403).json({ error: "Item not owned" }); return; }

  await db.update(userGearTable)
    .set({ attuned: false })
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));

  res.json({ success: true });
});

export default router;
