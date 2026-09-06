import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, personalEncountersTable, type PersonalEncounter } from "@workspace/db";
import { awardCoins } from "../lib/award-coins";
import { encounterView, damageForCheck, type EncounterView } from "../lib/encounter";
import { encounterName, encounterHp, felledCoins, nextTier } from "../lib/encounter-progress";
import { getUserPower } from "./battle";
import type { CheckBand } from "../lib/roll-engine";

const router: IRouter = Router();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Get the user's active (unfelled) encounter, lazily spawning a tier-1 foe when
 * there is none. The insert relies on the partial unique index so two concurrent
 * spawns can't create two active foes — on conflict we re-read the winner.
 */
async function activeEncounter(tx: Tx, userId: number, power: number): Promise<PersonalEncounter> {
  const existing = await tx
    .select()
    .from(personalEncountersTable)
    .where(and(eq(personalEncountersTable.userId, userId), isNull(personalEncountersTable.felledAt)));
  if (existing[0]) return existing[0];

  await tx
    .insert(personalEncountersTable)
    .values({ userId, name: encounterName(1), tier: 1, hp: encounterHp(1, power) })
    .onConflictDoNothing();

  const [created] = await tx
    .select()
    .from(personalEncountersTable)
    .where(and(eq(personalEncountersTable.userId, userId), isNull(personalEncountersTable.felledAt)));
  return created!;
}

export interface EncounterHit {
  name: string;
  tier: number;
  damage: number;
  felled: boolean;
  /** Coins granted for felling (0 when not felled). Upside-only loot. */
  coins: number;
  encounter: EncounterView;
}

/**
 * Chip the user's active encounter by one quest completion. Damage is the
 * completion's skill-check band scaled by the hero's battle power. On felling:
 * stamp the foe, grant upside-only loot, and spawn the next (tougher) foe.
 *
 * Best-effort by contract — callers wrap this so a failure never fails a
 * completion. Transactional so damage + felling + loot + spawn commit together.
 */
export async function chipPersonalEncounter(
  userId: number,
  power: number,
  band: CheckBand,
): Promise<EncounterHit> {
  return db.transaction(async (tx) => {
    const enc = await activeEncounter(tx, userId, power);
    const damage = damageForCheck(power, band);
    const newTotal = enc.totalDamage + damage;
    const felled = newTotal >= enc.hp;

    if (!felled) {
      await tx
        .update(personalEncountersTable)
        .set({ totalDamage: newTotal })
        .where(eq(personalEncountersTable.id, enc.id));
      return { name: enc.name, tier: enc.tier, damage, felled: false, coins: 0, encounter: encounterView(enc.hp, newTotal) };
    }

    await tx
      .update(personalEncountersTable)
      .set({ totalDamage: newTotal, felledAt: new Date() })
      .where(eq(personalEncountersTable.id, enc.id));

    const coins = felledCoins(enc.tier);
    await awardCoins(tx, userId, coins, "boss_win");

    const nt = nextTier(enc.tier);
    await tx
      .insert(personalEncountersTable)
      .values({ userId, name: encounterName(nt), tier: nt, hp: encounterHp(nt, power) })
      .onConflictDoNothing();

    return { name: enc.name, tier: enc.tier, damage, felled: true, coins, encounter: encounterView(enc.hp, newTotal) };
  });
}

// GET the current personal encounter (spawns a tier-1 foe on first view).
router.get("/encounter/current", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const power = await getUserPower(userId);
  const enc = await db.transaction((tx) => activeEncounter(tx, userId, power));
  res.json({
    name: enc.name,
    tier: enc.tier,
    encounter: encounterView(enc.hp, enc.totalDamage),
  });
});

export default router;
