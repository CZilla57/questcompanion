import {
  ReflectionHelpedChip, ReflectionHinderedChip, type ReflectionChip,
} from "@workspace/api-client-react";

export const HELPED_CHIPS = Object.values(ReflectionHelpedChip) as ReflectionChip[];
export const HINDERED_CHIPS = Object.values(ReflectionHinderedChip) as ReflectionChip[];

// Record<ReflectionChip, string> is exhaustive — a new enum key without a
// label is a compile error, keeping client copy in lockstep with the contract.
export const CHIP_LABELS: Record<ReflectionChip, string> = {
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
