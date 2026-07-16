import { addDays, format, startOfDay } from "date-fns";
import type { PatternSummary, Task, BrainMode } from "@workspace/api-client-react";
import { hourLabel } from "./rhythms";

export interface PowerWindowSlot {
  dueDate: string;
  dueTime: string;
  label: string;
}

/** Nearest power hour strictly after `now`'s hour today, else the earliest
 * power hour tomorrow. "Today" derives from the `now` argument (never the
 * system clock) so the math is testable and DST-indifferent. */
export function nextPowerWindowSlot(
  now: Date,
  powerHours: { hour: number }[],
): PowerWindowSlot | null {
  const hours = [...new Set(powerHours.map((p) => p.hour))].sort((a, b) => a - b);
  if (hours.length === 0) return null;
  const todayNext = hours.find((h) => h > now.getHours());
  const hour = todayNext ?? hours[0]!;
  const day = todayNext !== undefined ? startOfDay(now) : addDays(startOfDay(now), 1);
  return {
    dueDate: format(day, "yyyy-MM-dd"),
    dueTime: `${String(hour).padStart(2, "0")}:00`,
    label: todayNext !== undefined ? hourLabel(hour) : `${hourLabel(hour)} tomorrow`,
  };
}

/** Is `now` inside a power window? (Per-hour membership; hours may be non-contiguous.) */
export function inWindowNow(now: Date, powerHours: { hour: number }[]): boolean {
  return powerHours.some((p) => p.hour === now.getHours());
}

/** Chip gate (spec §Client): big swing, confidence ok, OUTSIDE the window
 * (in-window is momentum's moment), unscheduled/today/past-due only (never
 * pulls a deliberately future-dated quest earlier), never completed/anchored,
 * and never under a frozen brain (pressure-free). */
export function showSteeringChip(
  task: Pick<Task, "bigSwing" | "completed" | "isAnchored" | "dueDate">,
  patterns: PatternSummary | undefined,
  now: Date,
  mode: BrainMode | undefined,
): boolean {
  if (!patterns || patterns.confidence !== "ok" || patterns.powerHours.length === 0) return false;
  if (!task.bigSwing || task.completed || task.isAnchored) return false;
  if (mode === "frozen") return false;
  if (inWindowNow(now, patterns.powerHours)) return false;
  const todayStr = format(startOfDay(now), "yyyy-MM-dd");
  return task.dueDate == null || task.dueDate <= todayStr;
}
