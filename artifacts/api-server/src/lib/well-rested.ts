// Act IV (Tactics & Stakes) — "Well-Rested": the upside-framed reconciliation of
// the roadmap's attrition/exhaustion idea. The literal roadmap wanted a roll
// PENALTY while a broken streak leaves you "exhausted"; that collides head-on
// with the non-negotiable anti-shame law. So we invert it: keeping a good run
// (advancing your streak) leaves you WELL-RESTED for a while — a small, purely
// additive roll bonus. Breaking the run simply means the bonus lapses. There is
// never a penalty, only the presence or absence of upside.
//
// State lives as a single timestamp on the user (`wellRestedExpiresAt`), active
// iff non-null and in the future — the same derive-at-read pattern as the stat
// perks (no cron sweep). Pure and tested; the completion path grants/reads it.

/** Flat bonus added to a completion's roll while Well-Rested. Upside-only. */
export const WELL_RESTED_BONUS = 1;

/** How long a granted Well-Rested lasts. Long enough to carry "yesterday's good
 *  run" into today's quests (a full day plus slack), so the felt loop is
 *  "I kept my rhythm, so today I roll a little stronger". */
export const WELL_RESTED_HOURS = 36;

/** The expiry to stamp when a good run grants Well-Rested. */
export function wellRestedExpiry(now: Date): Date {
  return new Date(now.getTime() + WELL_RESTED_HOURS * 60 * 60 * 1000);
}

/** Well-Rested is active iff its expiry is set and still in the future. Mirrors
 *  stat-perks `isBoostActive`; kept here so the rule has one home. */
export function isWellRested(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() > now.getTime();
}

/** The roll bonus a user gets right now: the flat bonus while rested, else 0.
 *  Never negative — a lapsed Well-Rested is the absence of upside, not a cost. */
export function wellRestedBonus(expiresAt: Date | null, now: Date): number {
  return isWellRested(expiresAt, now) ? WELL_RESTED_BONUS : 0;
}

/** Whether a completion should (re)grant Well-Rested: it advanced the streak —
 *  i.e. the user kept their good run into a new day. A streak reset (newStreak
 *  ≤ before) grants nothing, which is the ONLY consequence of a broken run. */
export function shouldGrantWellRested(newStreak: number, streakBefore: number): boolean {
  return newStreak > streakBefore;
}
