// Pure display logic for the /progress Streak Shield card (Honest Coin).
// Mirrors the stat-perks grammar: buying is delight, shortfall is progress
// ("N more to go"), a full stock is reassurance — never an error state.

export interface ShieldCardState {
  held: number;
  statusLine: string;
  ready: boolean;
  action:
    | { kind: "buy"; label: string }
    | { kind: "saving"; label: string }
    | { kind: "full"; label: string };
}

export function shieldCardParts(p: {
  owned: number;
  atMax: boolean;
  affordable: boolean;
  remaining: number;
  coinCost: number;
}): ShieldCardState {
  const held = p.owned;
  const ready = held > 0;
  const statusLine = ready
    ? `${held} shield${held === 1 ? "" : "s"} held — auto-activates if you miss a day`
    : "Protects your streak from a missed day.";

  if (p.atMax) return { held, statusLine, ready, action: { kind: "full", label: "Fully shielded 🛡️" } };
  if (!p.affordable) return { held, statusLine, ready, action: { kind: "saving", label: `${p.remaining} more to go` } };
  return { held, statusLine, ready, action: { kind: "buy", label: `Buy for ${p.coinCost}` } };
}
