export interface LevelInfo {
  level: number;
  name: string;
  minPoints: number;
  maxPoints: number;
}

// Authored names for the curated tiers. Levels 1–10 are the originals; 11–26
// extend the motif from a spark of energy up through cosmic ascension, and are
// tuned so every gated catalog item (levelRequired up to 26) unlocks at a named
// milestone. Level 27+ is endless and labelled "Paragon N" (see levelName).
const LEVEL_NAMES = [
  "Spark", "Ignite", "Focus", "Flow", "Momentum", "Drive", "Surge", "Blaze",
  "Vortex", "Apex", "Nova", "Pulsar", "Quasar", "Zenith", "Eclipse", "Solstice",
  "Radiance", "Ascendant", "Celestial", "Empyrean", "Astral", "Cosmic",
  "Stellar", "Galactic", "Transcendent", "Eternal",
] as const;

/**
 * Cumulative points required to reach a level. Derived from the original 1–10
 * table, which fits exactly: minPoints(n) = 50·((n−1)² + 1) for n ≥ 2, and 0 at
 * level 1. Extending the same curve makes progression endless while keeping every
 * existing threshold byte-for-byte identical (e.g. L10 = 50·(81+1) = 4100).
 */
function minPointsForLevel(level: number): number {
  if (level <= 1) return 0;
  return 50 * ((level - 1) ** 2 + 1);
}

function levelName(level: number): string {
  return level <= LEVEL_NAMES.length
    ? LEVEL_NAMES[level - 1]
    : `Paragon ${level - LEVEL_NAMES.length}`;
}

export function getLevelInfo(totalPoints: number): LevelInfo {
  const p = Math.max(0, totalPoints);
  // Invert minPointsForLevel via the quadratic, then correct for float error so
  // exact boundary points always land on the right level.
  let level = Math.max(1, Math.floor(Math.sqrt(Math.max(0, p / 50 - 1))) + 1);
  while (minPointsForLevel(level + 1) <= p) level++;
  while (level > 1 && minPointsForLevel(level) > p) level--;
  return {
    level,
    name: levelName(level),
    minPoints: minPointsForLevel(level),
    maxPoints: minPointsForLevel(level + 1) - 1,
  };
}

export function getPointsToNextLevel(totalPoints: number): number {
  const current = getLevelInfo(totalPoints);
  // The ladder is endless, so there is always a next level to climb toward.
  return current.maxPoints + 1 - totalPoints;
}

/** Points earned since entering the current level band (0 at the band's start). */
export function getPointsIntoLevel(totalPoints: number): number {
  const current = getLevelInfo(totalPoints);
  return totalPoints - current.minPoints;
}

export const DAILY_BONUS_POINTS = 50;
export const ALL_DAY_BONUS_LABEL = "all_day_bonus";
