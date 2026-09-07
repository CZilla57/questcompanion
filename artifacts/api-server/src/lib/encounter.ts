// The Campaign — Phase 2: Encounters.
//
// Reframes a boss into D&D encounter language: an HP bar with phases (fresh →
// bloodied → wounded), and — crucially — a defeated boss "rests" rather than the
// player "losing". Anti-shame: an unbeaten encounter retreats to rest, it never
// reports the player as failed, and no progress is ever taken away.
//
// Pure and stateless (like character-sheet / roll-engine): it reads HP + damage
// and a completion's skill-check band, and returns a view + damage number. The
// callers own the persisted HP totals; this lib owns none.
import type { CheckBand } from "./roll-engine";

/** Damage a completed quest deals, scaled by its skill-check band. Every hit
 *  lands (upside-only): even a glancing blow chips HP, a crit hits hardest, and
 *  the result is never below 1 so a completion always contributes. */
export const BAND_DAMAGE_MULTIPLIER: Record<CheckBand, number> = {
  glancing: 0.6,
  success: 1.0,
  crit: 1.5,
};

export function damageForCheck(basePower: number, band: CheckBand): number {
  return Math.max(1, Math.round(Math.max(0, basePower) * BAND_DAMAGE_MULTIPLIER[band]));
}

/** Health phase of an encounter. `resting` is the felled state — deliberately
 *  not "dead"/"defeated by the boss": the anti-shame grammar is that the boss
 *  lies down to rest once the party has done enough. */
export type EncounterPhase = "fresh" | "bloodied" | "wounded" | "resting";
export type EncounterStatus = "active" | "resting";

export interface EncounterView {
  hp: number;
  totalDamage: number;
  hpRemaining: number;
  /** Fraction of HP still standing, 0..1. */
  percentRemaining: number;
  phase: EncounterPhase;
  status: EncounterStatus;
  /** True once the encounter has been fully chipped down (it now rests). */
  felled: boolean;
}

/** Phase thresholds on remaining HP fraction. */
export const BLOODIED_AT = 0.6;
export const WOUNDED_AT = 0.25;

/** Derive the encounter view from persisted HP + cumulative damage. Clamps so a
 *  bar can't overfill or go negative; more damage never *raises* remaining HP. */
export function encounterView(hp: number, totalDamage: number): EncounterView {
  const safeHp = Math.max(0, hp);
  const dmg = Math.max(0, totalDamage);
  const hpRemaining = Math.max(0, safeHp - dmg);
  const percentRemaining = safeHp > 0 ? hpRemaining / safeHp : 0;
  const felled = hpRemaining <= 0;

  let phase: EncounterPhase;
  if (felled) phase = "resting";
  else if (percentRemaining <= WOUNDED_AT) phase = "wounded";
  else if (percentRemaining <= BLOODIED_AT) phase = "bloodied";
  else phase = "fresh";

  return {
    hp: safeHp,
    totalDamage: dmg,
    hpRemaining,
    percentRemaining,
    phase,
    status: felled ? "resting" : "active",
    felled,
  };
}

/** Human label for a phase — the visible encounter state. */
export function encounterPhaseLabel(phase: EncounterPhase): string {
  switch (phase) {
    case "fresh": return "Standing strong";
    case "bloodied": return "Bloodied";
    case "wounded": return "Barely standing";
    case "resting": return "At rest";
  }
}

/**
 * Anti-shame status line. A live encounter describes the fight; a felled one says
 * the foe has retreated to rest — never that the player lost or failed. Quotes
 * nothing to blame; names only the foe.
 */
export function encounterStatusLine(view: EncounterView, foeName: string): string {
  if (view.felled) return `${foeName} has retreated to rest — the field is yours.`;
  switch (view.phase) {
    case "wounded": return `${foeName} is barely standing. A few more quests will see it off.`;
    case "bloodied": return `${foeName} is bloodied. Keep the pressure on.`;
    default: return `${foeName} stands strong. Every quest you finish lands a blow.`;
  }
}
