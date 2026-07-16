// Tunable economy knobs for the co-op World Boss. HP is the primary balance knob;
// tune to real turnout. See docs/superpowers/specs/2026-07-15-world-boss-coop-design.md.
export const WORLD_BOSS = {
  HP_BASE: 1500,
  HP_STEP: 300,
  HP_CAP: 5000,
  ATTACK_XP: 15,     // participation XP per daily attack (always earned)
  DEFEAT_COINS: 50,  // flat, to every contributor, when the boss is felled
  DEFEAT_XP: 250,    // flat, to every contributor, when the boss is felled
} as const;

// Shared HP for a given ISO week: escalates gently by week number, clamped.
export function worldBossHp(weekKey: string): number {
  const match = weekKey.match(/W(\d+)$/);
  const weekNo = match ? parseInt(match[1], 10) : 1;
  return Math.min(WORLD_BOSS.HP_BASE + (weekNo - 1) * WORLD_BOSS.HP_STEP, WORLD_BOSS.HP_CAP);
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
