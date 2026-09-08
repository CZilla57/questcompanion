// Act IV (Tactics & Stakes): the consumables economy. Potions/scrolls you buy
// with coins and choose to burn on a hard day — each applies an UPSIDE-ONLY
// boost to your next quest's d20 roll (see roll-engine RollBoost). Pure and
// tested; the route owns the owned-qty rows and the pending-activation state.
//
// Anti-shame by construction: every boost can only raise the roll, and a
// completion without a consumable is exactly as it was — nothing here can ever
// make a quest worth less.
import type { CoinReason } from "@workspace/db";
import type { RollBoost } from "./roll-engine";

export type ConsumableId = "focus_draught" | "lucky_clover" | "second_wind";

export interface ConsumableDef {
  id: ConsumableId;
  name: string;
  emoji: string;
  description: string;
  coinCost: number;
  boost: RollBoost;
}

/** Ledger reason recorded when a consumable is bought. */
export const CONSUMABLE_BUY_REASON: CoinReason = "consumable_buy";

export const CONSUMABLES: readonly ConsumableDef[] = [
  {
    id: "focus_draught",
    name: "Focus Draught",
    emoji: "🧪",
    description: "+3 to your next quest's roll.",
    coinCost: 20,
    boost: { kind: "bonus", amount: 3 },
  },
  {
    id: "lucky_clover",
    name: "Lucky Clover",
    emoji: "🍀",
    description: "Advantage on your next roll — roll twice, keep the higher.",
    coinCost: 30,
    boost: { kind: "advantage" },
  },
  {
    id: "second_wind",
    name: "Second Wind",
    emoji: "🌬️",
    description: "If your next roll comes up low, reroll and keep the better.",
    coinCost: 25,
    boost: { kind: "reroll" },
  },
];

export function consumableById(id: string): ConsumableDef | undefined {
  return CONSUMABLES.find((c) => c.id === id);
}

export function isConsumableId(id: unknown): id is ConsumableId {
  return typeof id === "string" && CONSUMABLES.some((c) => c.id === id);
}

/** The roll boost a queued consumable applies, or undefined if none/unknown. */
export function boostFor(id: string | null | undefined): RollBoost | undefined {
  return id ? consumableById(id)?.boost : undefined;
}
