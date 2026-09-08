import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, personalEncountersTable, type PersonalEncounter } from "@workspace/db";
import { awardCoins } from "../lib/award-coins";
import { encounterView, damageForCheck, type EncounterView } from "../lib/encounter";
import { encounterName, encounterHp, felledCoins, nextTier, foeByName, foeFor } from "../lib/encounter-progress";
import { awardLoot, type LootDrop } from "../lib/gear-rewards";
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
  /** Treasure reveal on a fell — gear and/or bonus coins. null when not felled. */
  loot: LootDrop | null;
  /** Why this foe stands against you (Act III) — shown while it lives. */
  motive: string;
  /** Celebratory defeat line, set only on a fell (null otherwise). Anti-shame. */
  defeatBeat: string | null;
  /** How the realm shifts when it falls, set only on a fell (null otherwise). */
  worldNote: string | null;
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
  const { hit, felledEncounterId } = await db.transaction(async (tx): Promise<{ hit: EncounterHit; felledEncounterId: number | null }> => {
    const enc = await activeEncounter(tx, userId, power);
    const foe = foeByName(enc.name) ?? foeFor(enc.tier);
    const damage = damageForCheck(power, band);
    const newTotal = enc.totalDamage + damage;
    const felled = newTotal >= enc.hp;

    if (!felled) {
      await tx
        .update(personalEncountersTable)
        .set({ totalDamage: newTotal })
        .where(eq(personalEncountersTable.id, enc.id));
      return {
        hit: { name: enc.name, tier: enc.tier, damage, felled: false, coins: 0, loot: null, motive: foe.motive, defeatBeat: null, worldNote: null, encounter: encounterView(enc.hp, newTotal) },
        felledEncounterId: null,
      };
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

    return {
      hit: { name: enc.name, tier: enc.tier, damage, felled: true, coins, loot: null, motive: foe.motive, defeatBeat: foe.defeatBeat, worldNote: foe.worldNote, encounter: encounterView(enc.hp, newTotal) },
      felledEncounterId: enc.id,
    };
  });

  // Treasure reveal — roll and grant loot AFTER the fell commits (awardLoot uses
  // its own connection). Best-effort: a loot failure never fails the completion,
  // and the fell + base coins have already landed.
  if (felledEncounterId !== null) {
    try {
      hit.loot = await awardLoot(userId, felledEncounterId, hit.tier);
    } catch { /* swallow — the fell already succeeded */ }
  }
  return hit;
}

// GET the current personal encounter (spawns a tier-1 foe on first view).
router.get("/encounter/current", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const power = await getUserPower(userId);
  const enc = await db.transaction((tx) => activeEncounter(tx, userId, power));
  const foe = foeByName(enc.name) ?? foeFor(enc.tier);
  res.json({
    name: enc.name,
    tier: enc.tier,
    motive: foe.motive,
    encounter: encounterView(enc.hp, enc.totalDamage),
  });
});

export default router;
