// Compact home status line (Act VII q2). Anti-shame: streak 0 is silence,
// not a zero — the row simply starts at level.

export interface StatusRowStats {
  streakDays: number;
  currentLevel: number;
  todayPoints: number;
}

export function statusRowParts(s: StatusRowStats): string[] {
  const parts: string[] = [];
  if (s.streakDays > 0) parts.push(`${s.streakDays}-day streak`);
  parts.push(`Lv ${s.currentLevel}`);
  parts.push(`${s.todayPoints} XP today`);
  return parts;
}
