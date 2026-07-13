/**
 * Canned reactions for ally poke/cheer nudges, plus pure validation and
 * rate-limit logic. No free text is ever accepted from users; every reaction
 * must match one of the fixed keys below for its kind.
 */

export type NudgeKind = "poke" | "cheer";

export interface NudgeReaction {
  key: string;
  label: string;
}

export const POKE_REACTIONS: NudgeReaction[] = [
  { key: "get_moving",        label: "Get moving! 💪" },
  { key: "dont_break_streak", label: "Don't break the streak! 🔥" },
  { key: "still_time",        label: "Still time today! ⏳" },
  { key: "checking_in",       label: "Checking in on you 👀" },
];

export const CHEER_REACTIONS: NudgeReaction[] = [
  { key: "crushing_it",    label: "You're crushing it! 🎉" },
  { key: "nice_level",     label: "Level up! Nice! ⭐" },
  { key: "streak_respect", label: "Streak respect 🔥" },
  { key: "proud",          label: "Proud of you! 🙌" },
];

export function isValidKind(x: string): x is NudgeKind {
  return x === "poke" || x === "cheer";
}

export function reactionsFor(kind: NudgeKind): NudgeReaction[] {
  return kind === "poke" ? POKE_REACTIONS : CHEER_REACTIONS;
}

export function reactionLabel(kind: NudgeKind, key: string): string | null {
  return reactionsFor(kind).find((r) => r.key === key)?.label ?? null;
}

export function isValidReaction(kind: NudgeKind, key: string): boolean {
  return reactionLabel(kind, key) !== null;
}

/**
 * Rate limit: at most one nudge of a given kind per sender→recipient per local
 * calendar day. `sameKindCountToday` is the number of nudges of this kind the
 * sender has already sent this recipient since the start of the sender's day.
 */
export function canSendNudge(sameKindCountToday: number): boolean {
  return sameKindCountToday === 0;
}
