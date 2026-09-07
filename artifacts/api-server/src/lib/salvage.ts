// The Campaign — second wave (Inventory & Salvage).
//
// Salvage turns an owned, unequipped gear item back into coins. It is the sink
// side of the gear economy: loot and purchases pile up owned items, and salvage
// lets a player recover value from the ones they will never equip.
//
// INVARIANT (no arbitrage): the salvage value of a rarity is ALWAYS strictly
// less than what that rarity costs to buy (`GEAR_COIN_COST`). A player can never
// profit by buying then salvaging, so salvage can never become a coin faucet.
// The tests pin this down.
//
// Framing (anti-shame): salvage is "recover coins", never "destroy". The refund
// is always a positive number of coins — giving up an item you do not use is
// pure upside.
import type { GearRarity } from "@workspace/db";
import { gearCoinCost } from "./coins";

/** Fraction of an item's buy cost recovered on salvage. Kept < 1 (and, given the
 *  20/60/150/400 ladder, well under it after flooring) so salvage never breaks
 *  even against a purchase — see the no-arbitrage invariant above. */
const SALVAGE_FRACTION = 0.4;

/** Coins recovered when salvaging an item of each rarity. Derived from
 *  `GEAR_COIN_COST`; listed here as the concrete numbers the UI shows:
 *  common 8, rare 24, epic 60, legendary 160. */
export const SALVAGE_VALUE: Record<GearRarity, number> = {
  common: Math.floor(gearCoinCost("common") * SALVAGE_FRACTION),
  rare: Math.floor(gearCoinCost("rare") * SALVAGE_FRACTION),
  epic: Math.floor(gearCoinCost("epic") * SALVAGE_FRACTION),
  legendary: Math.floor(gearCoinCost("legendary") * SALVAGE_FRACTION),
};

/** Coins recovered from salvaging an item of the given rarity. Always ≥ 1 and
 *  always strictly less than the buy cost of the same rarity. */
export function salvageValue(rarity: GearRarity): number {
  return SALVAGE_VALUE[rarity];
}
