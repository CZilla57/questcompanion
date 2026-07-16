import { struggleDeltaOnReschedule } from "./difficulty";

/** A quest worth steering into a power window (spec: any of the three). */
export function isBigSwing(t: {
  difficulty: string;
  priority: string;
  estimatedMinutes: number | null;
}): boolean {
  return t.difficulty === "hard" || t.priority === "high" || (t.estimatedMinutes ?? 0) >= 25;
}

/** powerHours are the top-3 hours from derivePatterns and may be non-contiguous;
 * "in a window" is per-hour set membership, not a range. Not yet consumed by
 * routes (momentum inlines the check on pre-mapped hours) — kept exported as
 * the import surface for quest 3's Context-Aware Notifications. */
export function inPowerWindow(localHour: number, powerHours: { hour: number }[]): boolean {
  return powerHours.some((p) => p.hour === localHour);
}

/** Struggle delta for a reschedule. A steered reschedule (the "save it for your
 * power window" affordance) is planning, not avoidance — it never counts. */
export function rescheduleStruggleDelta(
  existingDueDate: string | null,
  newDueDate: string,
  viaSteering: boolean,
): number {
  return viaSteering ? 0 : struggleDeltaOnReschedule(existingDueDate, newDueDate);
}
