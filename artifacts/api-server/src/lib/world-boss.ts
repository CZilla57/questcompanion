// Tunable economy knobs for the co-op World Boss. HP right-sizes to last
// week's turnout (Act VII q6); tune HP_PER_CONTRIBUTOR to real cadence.
// See docs/superpowers/specs/2026-07-15-world-boss-coop-design.md and the
// Act VII spec §Quest 6.
export const WORLD_BOSS = {
  HP_PER_CONTRIBUTOR: 300, // ≈ one member attacking 4–5 of 7 days at modest power
  HP_MIN: 300,             // 0- or 1-person prior week: still solo-winnable
  ATTACK_XP: 15,     // participation XP per daily attack (always earned)
  DEFEAT_COINS: 50,  // flat, to every contributor, when the boss is felled
  DEFEAT_XP: 250,    // flat, to every contributor, when the boss is felled
} as const;

// Shared HP for a week, sized by the PRIOR week's active contributors.
// Linear with no cap: per-person effort stays constant as the population
// grows, so a 3-person week is winnable and a 300-person week isn't trivial.
export function worldBossHp(priorContributors: number): number {
  const n = Number.isFinite(priorContributors) ? Math.max(0, Math.floor(priorContributors)) : 0;
  return Math.max(WORLD_BOSS.HP_MIN, n * WORLD_BOSS.HP_PER_CONTRIBUTOR);
}

// UTC calendar day, "YYYY-MM-DD" — the once-per-day dedup key.
export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

// Damage for one attack: 75%–125% of battle power. RNG injected for tests.
export function rollDamage(power: number, rng: () => number = Math.random): number {
  return Math.round(power * (0.75 + rng() * 0.5));
}

// Did THIS attack land the felling blow? (crossed from below hp to >= hp)
export function crossedThreshold(prevTotal: number, newTotal: number, hp: number): boolean {
  return prevTotal < hp && newTotal >= hp;
}
