import { Router, type IRouter } from "express";
import { db, usersTable, coinTransactionsTable, type User } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { redeemDecision } from "../lib/coins";
import {
  PERKS,
  getPerk,
  isValidPerkId,
  isBoostActive,
  nextBoostExpiry,
  canBuyStreakShield,
  MAX_STREAK_FREEZES,
  type PerkDef,
} from "../lib/stat-perks";

const router: IRouter = Router();

/** Catalog entry + this user's live state (affordability, active/owned). */
function present(perk: PerkDef, user: User, now: Date) {
  const { affordable, remaining } = redeemDecision(user.coinBalance, perk.coinCost);
  const base = {
    id: perk.id,
    kind: perk.kind,
    label: perk.label,
    emoji: perk.emoji,
    description: perk.description,
    coinCost: perk.coinCost,
    affordable,
    remaining,
  };
  if (perk.kind === "streak_shield") {
    return {
      ...base,
      active: null,
      expiresAt: null,
      owned: user.streakFreezes,
      atMax: !canBuyStreakShield(user.streakFreezes),
    };
  }
  const expiresAt = perk.kind === "xp_boost" ? user.xpBoostExpiresAt : user.focusBoostExpiresAt;
  return {
    ...base,
    active: isBoostActive(expiresAt, now),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    owned: null,
    atMax: null,
  };
}

router.get("/stat-perks", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const now = new Date();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ balance: user.coinBalance, perks: PERKS.map((p) => present(p, user, now)) });
});

router.post("/stat-perks/:id/buy", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const id = req.params.id!;
  if (!isValidPerkId(id)) { res.status(404).json({ error: "Unknown perk" }); return; }
  const perk = getPerk(id)!;

  type Outcome =
    | { status: "not_found" }
    | { status: "insufficient"; balance: number; remaining: number }
    | { status: "at_max"; balance: number }
    | { status: "ok"; balance: number; expiresAt: string | null; owned: number | null };

  const now = new Date();

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row: the read-decide-write below (compute the stacked expiry /
    // check the shield cap, then decrement + apply + ledger) must be atomic so a
    // concurrent double-buy can neither overspend nor exceed the cap.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    // Shield stock cap takes precedence over affordability — being fully shielded
    // is reassurance, not a "you can't afford it" nudge.
    if (perk.kind === "streak_shield" && !canBuyStreakShield(user.streakFreezes)) {
      return { status: "at_max", balance: user.coinBalance };
    }
    if (user.coinBalance < perk.coinCost) {
      return {
        status: "insufficient",
        balance: user.coinBalance,
        remaining: Math.max(0, perk.coinCost - user.coinBalance),
      };
    }

    // Guaranteed affordable under the lock. Decrement coins, apply the effect.
    const decrement = { coinBalance: sql`${usersTable.coinBalance} - ${perk.coinCost}` };
    let expiresAt: string | null = null;
    let owned: number | null = null;

    if (perk.kind === "streak_shield") {
      const nextOwned = user.streakFreezes + 1;
      owned = nextOwned;
      await tx.update(usersTable).set({ ...decrement, streakFreezes: nextOwned }).where(eq(usersTable.id, userId));
    } else {
      const current = perk.kind === "xp_boost" ? user.xpBoostExpiresAt : user.focusBoostExpiresAt;
      const next = nextBoostExpiry(current, now, perk.durationHours!);
      expiresAt = next.toISOString();
      const col = perk.kind === "xp_boost"
        ? { xpBoostExpiresAt: next }
        : { focusBoostExpiresAt: next };
      await tx.update(usersTable).set({ ...decrement, ...col }).where(eq(usersTable.id, userId));
    }

    await tx.insert(coinTransactionsTable).values({ userId, amount: -perk.coinCost, reason: perk.reason });
    return { status: "ok", balance: user.coinBalance - perk.coinCost, expiresAt, owned };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "User not found" }); return; }
  if (outcome.status === "insufficient") {
    // Gentle, not an error: "N more to go". HTTP 200 so it never reads as failure.
    res.status(200).json({
      purchased: false, reason: "insufficient", affordable: false,
      balance: outcome.balance, remaining: outcome.remaining,
    });
    return;
  }
  if (outcome.status === "at_max") {
    res.status(200).json({
      purchased: false, reason: "at_max", affordable: true,
      balance: outcome.balance, remaining: 0, owned: MAX_STREAK_FREEZES,
    });
    return;
  }
  res.status(200).json({
    purchased: true, reason: "ok", affordable: true,
    balance: outcome.balance, remaining: 0,
    expiresAt: outcome.expiresAt, owned: outcome.owned,
  });
});

export default router;
