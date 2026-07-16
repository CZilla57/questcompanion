import type { PatternSummary } from "@workspace/api-client-react";
import { CHIP_LABELS } from "./reflection-chips";

export type RhythmsState = "empty" | "early" | "full";

export function rhythmsState(s: PatternSummary): RhythmsState {
  if (s.confidence === "none") return "empty";
  if (s.confidence === "low") return "early";
  return "full";
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function hourLabel(h: number): string {
  const norm = ((h % 24) + 24) % 24;
  if (norm === 0) return "12am";
  if (norm < 12) return `${norm}am`;
  if (norm === 12) return "12pm";
  return `${norm - 12}pm`;
}

/** "9–11am" style ranges: sort, merge contiguous hours, end is exclusive.
 * Shared am/pm suffix collapses ("9–11am"), mixed keeps both ("11am–1pm"). */
export function formatPowerHours(powerHours: { hour: number }[]): string {
  if (powerHours.length === 0) return "";
  const hours = [...new Set(powerHours.map((p) => p.hour))].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const h of hours) {
    const last = runs[runs.length - 1];
    if (last && h === last[1]) last[1] = h + 1;
    else runs.push([h, h + 1]);
  }
  return runs
    .map(([start, endEx]) => {
      const a = hourLabel(start);
      const b = hourLabel(endEx);
      const aSuffix = a.slice(-2);
      const bSuffix = b.slice(-2);
      return aSuffix === bSuffix ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`;
    })
    .join(", ");
}

/** Positive framings only — blockers never render here (spec §7). */
export function rhythmsLines(s: PatternSummary): string[] {
  const lines: string[] = [];
  if (s.powerHours.length > 0) lines.push(`You're strongest ${formatPowerHours(s.powerHours)}`);
  if (s.bestDay != null) lines.push(`${DAY_NAMES[s.bestDay]}s are your day`);
  if (s.medianQuestMinutes != null) lines.push(`Most quests take you ~${s.medianQuestMinutes} min`);
  const topHelper = s.topHelpers[0];
  if (topHelper) lines.push(`"${CHIP_LABELS[topHelper]}" helps you most`);
  return lines;
}
