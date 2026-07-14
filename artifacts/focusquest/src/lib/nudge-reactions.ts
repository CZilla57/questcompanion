export type NudgeKind = "poke" | "cheer";
export interface NudgeReaction { key: string; label: string; }

export const POKE_REACTIONS: NudgeReaction[] = [
  { key: "get_moving",        label: "Get moving! 💪" },
  { key: "dont_break_streak", label: "Keep the streak alive! 🔥" },
  { key: "still_time",        label: "Still time today! ⏳" },
  { key: "checking_in",       label: "Checking in on you 👀" },
];

export const CHEER_REACTIONS: NudgeReaction[] = [
  { key: "crushing_it",    label: "You're crushing it! 🎉" },
  { key: "nice_level",     label: "Level up! Nice! ⭐" },
  { key: "streak_respect", label: "Streak respect 🔥" },
  { key: "proud",          label: "Proud of you! 🙌" },
];

export function reactionsFor(kind: NudgeKind): NudgeReaction[] {
  return kind === "poke" ? POKE_REACTIONS : CHEER_REACTIONS;
}
