// Solo Weekly Boss sizing — right-sized to the player, mirroring the raid
// boss rescale (Act VII q6): strength derives from observed reality, never
// the calendar. The old curve (90 + (weekNo−1)·70, cap 750) was pinned at its
// cap from launch — an 11× wall over a real player's power, unwinnable below
// power 600.
//
// The boss is your own shadow: pitched just under your average roll, so the
// fight is beatable most weeks and never a wall — but the worst rolls still
// lose, so it keeps its teeth. With the enter roll uniform in
// [0.75, 1.25] × power, P(win) = (1.25 − BOSS_POWER_RATIO) / 0.5 = 60%.
// This ratio is the one balance knob.
export const BOSS_POWER_RATIO = 0.95;

export function getBossPower(userPower: number): number {
  return Math.round(userPower * BOSS_POWER_RATIO);
}
