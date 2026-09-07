// The Campaign — Phase 2 (Party): the thin, pure bits of a SHARED co-op foe.
// The HP/phase/damage math already lives in encounter.ts, and sizing/naming/loot
// in encounter-progress.ts — this file only adds what is party-specific: how a
// pair's power combines into one tougher foe, how loot reaches every contributor
// (upside-only), and how to present both members' damage as teamwork.
//
// Pure — no I/O. The route owns the persisted rows.
import { felledCoins } from "./encounter-progress";

/**
 * Combined battle power for a party's shared foe: the sum of the members' power
 * (negatives clamped to zero). Feeding this to `encounterHp` yields a bar sized
 * for the whole party, so a shared foe is strictly tougher than any one member's
 * solo foe — it takes teamwork. Monotonic in each member's power.
 */
export function partyPower(powers: number[]): number {
  return powers.reduce((sum, p) => sum + Math.max(0, p), 0);
}

/**
 * Loot for felling a shared foe. Every member who dealt at least one point of
 * damage receives the FULL `felledCoins(tier)` — a generous co-op bonus, never a
 * split that would leave a member with less than they'd earn felling a foe solo
 * (anti-shame / upside-only law). Ids are deduped so no one is paid twice.
 */
export function partyLoot(
  tier: number,
  contributorIds: number[],
): { userId: number; coins: number }[] {
  const coins = felledCoins(tier);
  const seen = new Set<number>();
  const result: { userId: number; coins: number }[] = [];
  for (const userId of contributorIds) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    result.push({ userId, coins });
  }
  return result;
}

/**
 * Present each party member's damage against the shared foe. Returns exactly one
 * entry per member, in the given member order, with a member who has not struck
 * yet shown as 0 — never omitted, never sorted into a ranking. Stray rows for
 * non-members are ignored. This drives a "teamwork" display, not a leaderboard.
 */
export function rollUpContributions<T extends { userId: number; damage: number }>(
  rows: T[],
  members: number[],
): { userId: number; damage: number }[] {
  const byUser = new Map<number, number>();
  for (const r of rows) byUser.set(r.userId, r.damage);
  return members.map((userId) => ({ userId, damage: byUser.get(userId) ?? 0 }));
}
