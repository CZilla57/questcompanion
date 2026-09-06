// The Campaign — Phase 2: personal-encounter sizing, naming, and loot. Pure and
// tested; the route owns the persisted rows and calls these to size a new foe,
// name it, and decide the reward when it is felled.

/** Playful, EXTERNAL foes — the friction of an ADHD day made monstrous. They are
 *  never the player: felling "The Doomscroller" is beating the pull to scroll,
 *  not beating yourself. Rotates by tier so a run keeps meeting new foes. */
export const BESTIARY: readonly string[] = [
  "The Dust Gremlin",
  "The Procrastigeist",
  "The Doomscroller",
  "The Inbox Hydra",
  "The Fog of Overwhelm",
  "The Snooze Wraith",
  "The Clutter Golem",
  "The Deadline Drake",
];

export function encounterName(tier: number): string {
  const i = Math.max(0, tier - 1) % BESTIARY.length;
  return BESTIARY[i]!;
}

export const HP_MIN = 200;
/** A base foe takes about this many solid (success) hits of your battle power. */
export const HP_POWER_MULT = 3;

/**
 * HP for the tier-th foe of a run, sized to the player's battle power so the
 * fight tracks the character's strength. Grows each tier (+1× power) so the run
 * ramps. Monotonic in both tier and power; floored so a level-1 hero still has a
 * real bar to chip.
 */
export function encounterHp(tier: number, power: number): number {
  const p = Math.max(0, power);
  const t = Math.max(1, Math.floor(tier));
  return Math.max(HP_MIN, Math.round(p * (HP_POWER_MULT + (t - 1))));
}

export const FELL_BASE_COINS = 15;
export const FELL_TIER_COINS = 5;

/** Coins granted for felling a tier-th foe. Upside-only; grows with tier. */
export function felledCoins(tier: number): number {
  const t = Math.max(1, Math.floor(tier));
  return FELL_BASE_COINS + (t - 1) * FELL_TIER_COINS;
}

export function nextTier(tier: number): number {
  return Math.max(1, Math.floor(tier)) + 1;
}
