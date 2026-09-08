// The Campaign — Phase 2: personal-encounter sizing, naming, and loot. Pure and
// tested; the route owns the persisted rows and calls these to size a new foe,
// name it, and decide the reward when it is felled.

/**
 * A named, arc'd foe (Act III — the Living World). Playful and EXTERNAL — the
 * friction of an ADHD day made monstrous. They are never the player: felling
 * "The Doomscroller" is beating the pull to scroll, not beating yourself.
 *
 * - `motive`: why it stands against you — shown while it lives, so you have a
 *   reason to want it beaten (never a reason to feel watched or judged).
 * - `defeatBeat`: the celebratory line on felling. Anti-shame: it only ever
 *   marks a win; there is no lose state (an unbeaten foe merely rests).
 * - `worldNote`: the small way the realm shifts when it falls — a grounded nod
 *   to the Life Kingdom the friction belonged to.
 */
export interface Foe {
  name: string;
  motive: string;
  defeatBeat: string;
  worldNote: string;
}

/** The roster, rotated by tier so a run keeps meeting new foes. */
export const FOES: readonly Foe[] = [
  {
    name: "The Dust Gremlin",
    motive: "It thrives wherever the chores pile up and no one looks.",
    defeatBeat: "The Dust Gremlin scatters — the corners of your day are clear again.",
    worldNote: "The Hearth breathes easier.",
  },
  {
    name: "The Procrastigeist",
    motive: "It feeds on every “I'll do it later.”",
    defeatBeat: "The Procrastigeist thins to smoke — the laters it hoarded are yours to spend now.",
    worldNote: "The Forge's fires catch.",
  },
  {
    name: "The Doomscroller",
    motive: "It wants your attention, one endless feed at a time.",
    defeatBeat: "The Doomscroller goes dark — your focus returns to your own hands.",
    worldNote: "The Athenaeum's lanterns steady.",
  },
  {
    name: "The Inbox Hydra",
    motive: "Answer one and two more heads rise.",
    defeatBeat: "The Inbox Hydra's heads fall still — the flood is a trickle now.",
    worldNote: "The Crossroads clear.",
  },
  {
    name: "The Fog of Overwhelm",
    motive: "It hides the next step behind everything at once.",
    defeatBeat: "The Fog of Overwhelm lifts — the path ahead is visible again.",
    worldNote: "The whole realm comes into view.",
  },
  {
    name: "The Snooze Wraith",
    motive: "It trades your mornings for five more minutes.",
    defeatBeat: "The Snooze Wraith fades with the dawn — the day is yours from the start.",
    worldNote: "The Wellspring runs clear.",
  },
  {
    name: "The Clutter Golem",
    motive: "It builds itself from everything left unsorted.",
    defeatBeat: "The Clutter Golem crumbles — the space around you opens up.",
    worldNote: "The Hearth stands tidy.",
  },
  {
    name: "The Deadline Drake",
    motive: "It circles closer as the days run short.",
    defeatBeat: "The Deadline Drake is downed — the pressure in the air breaks.",
    worldNote: "The Forge rings with the win.",
  },
];

/** Names only — kept for callers/tests that just need the label rotation. */
export const BESTIARY: readonly string[] = FOES.map((f) => f.name);

/** The foe for a given tier (1-based), rotating through the roster. */
export function foeFor(tier: number): Foe {
  const i = Math.max(0, Math.floor(tier) - 1) % FOES.length;
  return FOES[i]!;
}

/** Resolve a foe by its stored name, so a persisted encounter maps back to its
 *  motive/defeat copy even if the roster order ever changes. */
export function foeByName(name: string): Foe | undefined {
  return FOES.find((f) => f.name === name);
}

export function encounterName(tier: number): string {
  return foeFor(tier).name;
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
