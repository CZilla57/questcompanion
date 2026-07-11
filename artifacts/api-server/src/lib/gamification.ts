export interface LevelInfo {
  level: number;
  name: string;
  minPoints: number;
  maxPoints: number;
}

const LEVELS: LevelInfo[] = [
  { level: 1, name: "Spark", minPoints: 0, maxPoints: 99 },
  { level: 2, name: "Ignite", minPoints: 100, maxPoints: 249 },
  { level: 3, name: "Focus", minPoints: 250, maxPoints: 499 },
  { level: 4, name: "Flow", minPoints: 500, maxPoints: 849 },
  { level: 5, name: "Momentum", minPoints: 850, maxPoints: 1299 },
  { level: 6, name: "Drive", minPoints: 1300, maxPoints: 1849 },
  { level: 7, name: "Surge", minPoints: 1850, maxPoints: 2499 },
  { level: 8, name: "Blaze", minPoints: 2500, maxPoints: 3249 },
  { level: 9, name: "Vortex", minPoints: 3250, maxPoints: 4099 },
  { level: 10, name: "Apex", minPoints: 4100, maxPoints: Infinity },
];

export function getLevelInfo(totalPoints: number): LevelInfo {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (totalPoints >= LEVELS[i].minPoints) {
      return LEVELS[i];
    }
  }
  return LEVELS[0];
}

export function getPointsToNextLevel(totalPoints: number): number {
  const current = getLevelInfo(totalPoints);
  if (current.level >= LEVELS.length) return 0;
  return current.maxPoints + 1 - totalPoints;
}

/** Points earned since entering the current level band (0 at the band's start). */
export function getPointsIntoLevel(totalPoints: number): number {
  const current = getLevelInfo(totalPoints);
  return totalPoints - current.minPoints;
}

export const DAILY_BONUS_POINTS = 50;
export const ALL_DAY_BONUS_LABEL = "all_day_bonus";
