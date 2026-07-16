import { localHour, localDateKey } from "./date-buckets";
import { ReflectionHelpedChip, ReflectionHinderedChip } from "@workspace/api-zod";

export const PATTERN_WINDOW_DAYS = 28;

export type PatternConfidence = "none" | "low" | "ok";
export type DayBlock = "morning" | "afternoon" | "evening" | "night";

export interface PatternInputs {
  now: Date;
  timeZone: string;
  completions: { completedAt: Date; category: string; estimatedMinutes: number | null; actualMinutes: number | null }[];
  focusSessions: { startedAt: Date; focusedSeconds: number }[];
  checkins: { mode: string; createdAt: Date }[];
  /** Answered reflections only, PRE-FILTERED by the caller to the same
   * 28-day window — rows carry no timestamp, so derivePatterns cannot
   * enforce the window itself (completions/focus/checkins are filtered
   * internally; this input is trusted). */
  reflections: { chips: string[] }[];
}

export interface PatternSummary {
  windowDays: number;
  sampleSize: { completions: number; focusMinutes: number; checkins: number; reflections: number };
  confidence: PatternConfidence;
  powerHours: { hour: number; score: number }[];
  bestDay: number | null;
  medianQuestMinutes: number | null;
  categoryMinutes: { category: string; medianActual: number; count: number }[];
  modeByBlock: { block: DayBlock; dominantMode: string | null }[];
  topHelpers: string[];
  topBlockers: string[];
}

const BLOCKS: { block: DayBlock; hours: number[] }[] = [
  { block: "morning",   hours: [6, 7, 8, 9, 10, 11] },
  { block: "afternoon", hours: [12, 13, 14, 15, 16] },
  { block: "evening",   hours: [17, 18, 19, 20] },
  { block: "night",     hours: [21, 22, 23, 0, 1, 2, 3, 4, 5] },
];

export function blockOfHour(hour: number): DayBlock {
  return BLOCKS.find((b) => b.hours.includes(hour))!.block;
}

const HELPED = new Set<string>(Object.values(ReflectionHelpedChip));
const HINDERED = new Set<string>(Object.values(ReflectionHinderedChip));

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Top-N keys by count desc, then key asc — deterministic. */
function topCounts<K extends string>(counts: Map<K, number>, n: number): K[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([k]) => k);
}

export function derivePatterns(inputs: PatternInputs): PatternSummary {
  const { now, timeZone } = inputs;
  const cutoff = new Date(now.getTime() - PATTERN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const completions = inputs.completions.filter((c) => c.completedAt >= cutoff && c.completedAt <= now);
  const focusSessions = inputs.focusSessions.filter((f) => f.startedAt >= cutoff && f.startedAt <= now);
  const checkins = inputs.checkins.filter((c) => c.createdAt >= cutoff && c.createdAt <= now);
  const reflections = inputs.reflections;

  const focusMinutes = Math.round(focusSessions.reduce((s, f) => s + f.focusedSeconds, 0) / 60);

  const confidence: PatternConfidence =
    completions.length < 5 ? "none" : completions.length < 15 ? "low" : "ok";

  // Power hours: completions weigh 1, a completed pomodoro's worth of focus (~25 min) weighs 1.
  const hourScore = new Map<number, number>();
  for (const c of completions) {
    const h = localHour(c.completedAt, timeZone);
    hourScore.set(h, (hourScore.get(h) ?? 0) + 1);
  }
  for (const f of focusSessions) {
    const h = localHour(f.startedAt, timeZone);
    hourScore.set(h, (hourScore.get(h) ?? 0) + f.focusedSeconds / 60 / 25);
  }
  const powerHours = [...hourScore.entries()]
    .map(([hour, score]) => ({ hour, score: Math.round(score * 100) / 100 }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.hour - b.hour)
    .slice(0, 3);

  // Best weekday: strict max, only past the 'none' tier.
  let bestDay: number | null = null;
  if (confidence !== "none") {
    const dayCounts = new Array<number>(7).fill(0);
    for (const c of completions) {
      const dow = new Date(localDateKey(c.completedAt, timeZone) + "T12:00:00Z").getUTCDay();
      dayCounts[dow]!++;
    }
    const max = Math.max(...dayCounts);
    const winners = dayCounts.flatMap((n, d) => (n === max && n > 0 ? [d] : []));
    bestDay = winners.length === 1 ? winners[0]! : null;
  }

  // Durations: only rows that actually recorded actualMinutes.
  const timed = completions.filter((c) => c.actualMinutes != null);
  const medianQuestMinutes =
    timed.length >= 3 ? median(timed.map((c) => c.actualMinutes!).sort((a, b) => a - b)) : null;

  const byCategory = new Map<string, number[]>();
  for (const c of timed) {
    byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c.actualMinutes!]);
  }
  const categoryMinutes = [...byCategory.entries()]
    .map(([category, mins]) => ({
      category,
      medianActual: median(mins.sort((a, b) => a - b)),
      count: mins.length,
    }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));

  // Dominant brain mode per day-block: >=2 checkins in the block, strict winner.
  const modeByBlock = BLOCKS.map(({ block }) => {
    const inBlock = checkins.filter((c) => blockOfHour(localHour(c.createdAt, timeZone)) === block);
    if (inBlock.length < 2) return { block, dominantMode: null };
    const counts = new Map<string, number>();
    for (const c of inBlock) counts.set(c.mode, (counts.get(c.mode) ?? 0) + 1);
    const max = Math.max(...counts.values());
    const winners = [...counts.entries()].filter(([, n]) => n === max);
    return { block, dominantMode: winners.length === 1 ? winners[0]![0] : null };
  });

  const helperCounts = new Map<string, number>();
  const blockerCounts = new Map<string, number>();
  for (const r of reflections) {
    for (const chip of r.chips) {
      if (HELPED.has(chip)) helperCounts.set(chip, (helperCounts.get(chip) ?? 0) + 1);
      if (HINDERED.has(chip)) blockerCounts.set(chip, (blockerCounts.get(chip) ?? 0) + 1);
    }
  }

  return {
    windowDays: PATTERN_WINDOW_DAYS,
    sampleSize: {
      completions: completions.length,
      focusMinutes,
      checkins: checkins.length,
      reflections: reflections.length,
    },
    confidence,
    powerHours,
    bestDay,
    medianQuestMinutes,
    categoryMinutes,
    modeByBlock,
    topHelpers: topCounts(helperCounts, 3),
    topBlockers: topCounts(blockerCounts, 3),
  };
}
