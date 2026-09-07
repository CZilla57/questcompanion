// The Campaign — second wave (Attunement). The classic 5e attunement cap turned
// into an upside-only power layer: a player may attune up to three of their
// equipped magic items to draw extra battle power from them.
//
// INVARIANT (upside-only, anti-shame): attuning can only ADD power. Not attuning
// is neutral — never a penalty — so `gearPower(...)` is always ≥ the plain sum of
// equipped statPower. The tests pin this down.
//
// Attunement is meaningful only for equipped items (the routes enforce that), and
// only epic/legendary gear is attunable. `gearPower` still guards defensively:
// a non-attunable item flagged attuned contributes no bonus.
import type { GearRarity } from "@workspace/db";

/** How many items a hero may have attuned at once (the 5e cap). */
export const ATTUNEMENT_CAP = 3;

/** Only magic items — epic and legendary — can be attuned. */
export function isAttunable(rarity: GearRarity): boolean {
  return rarity === "epic" || rarity === "legendary";
}

/** Extra battle power an attuned item grants: half its stat power, rounded up.
 *  Always ≥ 1 for any item with stat power. */
export function attunementBonus(statPower: number): number {
  return Math.ceil(statPower / 2);
}

/** An equipped gear row as far as power is concerned. */
export interface PowerGear {
  statPower: number;
  rarity: GearRarity;
  attuned: boolean;
}

/** Total gear contribution to battle power: the sum of equipped stat power plus
 *  the attunement bonus for each item that is both attuned and attunable. The
 *  single source of truth shared by every battle-power site. */
export function gearPower(equipped: PowerGear[]): number {
  return equipped.reduce((sum, g) => {
    const bonus = g.attuned && isAttunable(g.rarity) ? attunementBonus(g.statPower) : 0;
    return sum + g.statPower + bonus;
  }, 0);
}
