import type { ReflectionChip } from "@workspace/api-zod";

// Record<ReflectionChip, string> is exhaustive — a new enum key without a
// label is a compile error. Mirrors the client's CHIP_LABELS in
// artifacts/focusquest/src/lib/reflection-chips.ts; keep both in sync.
const CHIP_LABELS: Record<ReflectionChip, string> = {
  timer: "A timer",
  small_steps: "Small steps",
  body_double: "Someone with me",
  right_time: "Right time of day",
  low_stakes: "Low stakes",
  treat_reward: "A reward waiting",
  low_energy: "Low energy",
  too_many_switches: "Too much switching",
  too_big: "Too big to start",
  distractions: "Distractions",
  time_slipped: "Time slipped away",
  pressure: "Pressure",
};

/** Human label for a reflection chip key. Raw chip keys (e.g. "small_steps")
 * are an internal contract detail — they must never reach a user-facing
 * surface or an LLM prompt verbatim. Unknown keys fall back to a
 * best-effort underscore→space label rather than throwing. */
export function chipLabel(key: string): string {
  return (CHIP_LABELS as Record<string, string>)[key] ?? key.replace(/_/g, " ");
}
