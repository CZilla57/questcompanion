import { Router, type IRouter } from "express";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  db, partyEncountersTable, partyEncounterContributionsTable, partnershipsTable,
  usersTable, type PartyEncounter,
} from "@workspace/db";
import { awardCoins } from "../lib/award-coins";
import { encounterView, damageForCheck, type EncounterView } from "../lib/encounter";
import { encounterName, encounterHp, nextTier } from "../lib/encounter-progress";
import { partyPower, partyLoot, rollUpContributions } from "../lib/party-encounter";
import { awardLoot, type LootDrop } from "../lib/gear-rewards";
import { formatUserSummary } from "./accountability";
import { getUserPower } from "./battle";
import type { CheckBand } from "../lib/roll-engine";

const router: IRouter = Router();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The accepted partnerships this user belongs to (either direction). */
async function acceptedPartnerships(userId: number) {
  return db.select().from(partnershipsTable).where(and(
    eq(partnershipsTable.status, "accepted"),
    or(eq(partnershipsTable.requesterId, userId), eq(partnershipsTable.recipientId, userId)),
  ));
}

/**
 * The party's active (unfelled) shared foe, lazily spawning a tier-1 foe when
 * there is none. Sized to the party's COMBINED power so a shared foe is tougher
 * than a solo one. The insert relies on the partial unique index so two
 * concurrent spawns can't create two active foes — on conflict we re-read.
 */
async function activePartyEncounter(
  tx: Tx, partnershipId: number, combinedPower: number,
): Promise<PartyEncounter> {
  const existing = await tx.select().from(partyEncountersTable).where(and(
    eq(partyEncountersTable.partnershipId, partnershipId),
    isNull(partyEncountersTable.felledAt),
  ));
  if (existing[0]) return existing[0];

  await tx.insert(partyEncountersTable)
    .values({ partnershipId, name: encounterName(1), tier: 1, hp: encounterHp(1, combinedPower) })
    .onConflictDoNothing();

  const [created] = await tx.select().from(partyEncountersTable).where(and(
    eq(partyEncountersTable.partnershipId, partnershipId),
    isNull(partyEncountersTable.felledAt),
  ));
  return created!;
}

export interface PartyEncounterHit {
  partnershipId: number;
  foeName: string;
  tier: number;
  /** Damage THIS completion dealt to the shared foe. */
  damage: number;
  felled: boolean;
  /** Coins THIS user earned for felling (0 when not felled). Upside-only. */
  coins: number;
  /** THIS user's treasure reveal on a fell (each contributor rolls their own).
   *  null when not felled. */
  loot: LootDrop | null;
  encounter: EncounterView;
}

/**
 * Chip every one of the user's shared party foes by one quest completion. The
 * completing user's blow (scaled by the roll's band) lands on each accepted
 * partnership's shared foe; their contribution accumulates. On felling: stamp the
 * foe, pay EVERY contributor the full felled coins (upside-only co-op loot), and
 * spawn the next, tougher foe.
 *
 * Best-effort by contract — the caller wraps this so a failure never fails a
 * completion. Each party is its own transaction so one party's error can't roll
 * back another's damage.
 */
export async function chipPartyEncounters(
  userId: number, power: number, band: CheckBand,
): Promise<PartyEncounterHit[]> {
  const partnerships = await acceptedPartnerships(userId);
  const hits: PartyEncounterHit[] = [];

  for (const p of partnerships) {
    const partnerId = p.requesterId === userId ? p.recipientId : p.requesterId;
    const combinedPower = partyPower([power, await getUserPower(partnerId)]);

    const { hit, felledInfo } = await db.transaction(async (tx): Promise<{ hit: PartyEncounterHit; felledInfo: { encId: number; tier: number; contributorIds: number[] } | null }> => {
      const enc = await activePartyEncounter(tx, p.id, combinedPower);
      const damage = damageForCheck(power, band);
      const newTotal = enc.totalDamage + damage;
      const felled = newTotal >= enc.hp;

      await tx.update(partyEncountersTable)
        .set({ totalDamage: newTotal, ...(felled ? { felledAt: new Date() } : {}) })
        .where(eq(partyEncountersTable.id, enc.id));

      // Accumulate this member's contribution (monotonic; upsert is the dedup).
      await tx.insert(partyEncounterContributionsTable)
        .values({ partyEncounterId: enc.id, userId, damage })
        .onConflictDoUpdate({
          target: [partyEncounterContributionsTable.partyEncounterId, partyEncounterContributionsTable.userId],
          set: { damage: sql`${partyEncounterContributionsTable.damage} + ${damage}` },
        });

      let coins = 0;
      let contributorIds: number[] = [];
      if (felled) {
        const contribs = await tx.select().from(partyEncounterContributionsTable)
          .where(eq(partyEncounterContributionsTable.partyEncounterId, enc.id));
        contributorIds = contribs.filter((c) => c.damage > 0).map((c) => c.userId);
        for (const award of partyLoot(enc.tier, contributorIds)) {
          await awardCoins(tx, award.userId, award.coins, "boss_win");
          if (award.userId === userId) coins = award.coins;
        }
        const nt = nextTier(enc.tier);
        await tx.insert(partyEncountersTable)
          .values({ partnershipId: p.id, name: encounterName(nt), tier: nt, hp: encounterHp(nt, combinedPower) })
          .onConflictDoNothing();
      }

      return {
        hit: {
          partnershipId: p.id,
          foeName: enc.name,
          tier: enc.tier,
          damage,
          felled,
          coins,
          loot: null,
          encounter: encounterView(enc.hp, newTotal),
        },
        felledInfo: felled ? { encId: enc.id, tier: enc.tier, contributorIds } : null,
      };
    });

    // Treasure reveal — after the fell commits, every contributor rolls their
    // own seeded drop (co-op loot, like the coins above). This user's drop rides
    // back on the hit; partners' drops land silently in their inventory.
    // Best-effort: a loot failure never fails the completion.
    if (felledInfo) {
      for (const cid of felledInfo.contributorIds) {
        try {
          const drop = await awardLoot(cid, felledInfo.encId, felledInfo.tier);
          if (cid === userId) hit.loot = drop;
        } catch { /* swallow — the fell + coins already landed */ }
      }
    }

    hits.push(hit);
  }

  return hits;
}

// GET the user's parties and their shared foes (spawns a tier-1 foe on first
// view). Contributions render as teamwork — one entry per member, never a rank.
router.get("/party/encounters", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const partnerships = await acceptedPartnerships(userId);
  const result = await Promise.all(partnerships.map(async (p) => {
    const partnerId = p.requesterId === userId ? p.recipientId : p.requesterId;
    const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, partnerId));
    const combinedPower = partyPower([await getUserPower(userId), await getUserPower(partnerId)]);

    const enc = await db.transaction((tx) => activePartyEncounter(tx, p.id, combinedPower));
    const contribs = await db.select().from(partyEncounterContributionsTable)
      .where(eq(partyEncounterContributionsTable.partyEncounterId, enc.id));

    // Self first, then partner — a stable order, never a ranking.
    const rolled = rollUpContributions(contribs, [userId, partnerId]);
    // `displayName` is nullable; fall back to the (non-null) username so the
    // member name is never null — the contract requires it, and a null crashes
    // strict clients (the iOS decoder rejects a null String).
    const partnerName = partner ? (partner.displayName ?? partner.username) : "Ally";
    const nameFor = (id: number) => (id === userId ? "You" : partnerName);

    return {
      partnershipId: p.id,
      partner: partner ? formatUserSummary(partner) : null,
      foeName: enc.name,
      tier: enc.tier,
      encounter: encounterView(enc.hp, enc.totalDamage),
      members: rolled.map((r) => ({ userId: r.userId, name: nameFor(r.userId), damage: r.damage })),
    };
  }));

  res.json(result);
});

export default router;
