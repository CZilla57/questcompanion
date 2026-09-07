import { describe, it, expect } from "vitest";
import { partyPower, partyLoot, rollUpContributions } from "./party-encounter";
import { encounterHp, felledCoins } from "./encounter-progress";

describe("partyPower", () => {
  it("combines members so a shared foe is tougher than a solo one", () => {
    // Sum of the party's battle power — the foe scales with the whole party.
    expect(partyPower([100, 80])).toBe(180);
  });
  it("sizes an HP bar strictly larger than any single member could face alone", () => {
    const a = 100, b = 80, tier = 1;
    expect(encounterHp(tier, partyPower([a, b]))).toBeGreaterThan(encounterHp(tier, a));
    expect(encounterHp(tier, partyPower([a, b]))).toBeGreaterThan(encounterHp(tier, b));
  });
  it("clamps negative power to zero rather than shrinking the party", () => {
    expect(partyPower([100, -50])).toBe(100);
  });
  it("returns zero for an empty party", () => {
    expect(partyPower([])).toBe(0);
  });
  it("equals the lone member's power for a party of one", () => {
    expect(partyPower([120])).toBe(120);
  });
});

describe("partyLoot", () => {
  it("pays every contributor the full felled coins — a co-op bonus, never a split", () => {
    const loot = partyLoot(1, [7, 9]);
    expect(loot).toEqual([
      { userId: 7, coins: felledCoins(1) },
      { userId: 9, coins: felledCoins(1) },
    ]);
  });
  it("never pays a contributor less than they'd earn felling a foe solo (upside-only)", () => {
    for (const { coins } of partyLoot(3, [1, 2])) {
      expect(coins).toBeGreaterThanOrEqual(felledCoins(3));
    }
  });
  it("grows the payout with tier", () => {
    expect(partyLoot(2, [1])[0]!.coins).toBeGreaterThan(partyLoot(1, [1])[0]!.coins);
  });
  it("dedups contributor ids, paying each once", () => {
    expect(partyLoot(1, [5, 5, 8])).toEqual([
      { userId: 5, coins: felledCoins(1) },
      { userId: 8, coins: felledCoins(1) },
    ]);
  });
  it("pays no one when there were no contributors", () => {
    expect(partyLoot(1, [])).toEqual([]);
  });
  it("never returns a negative payout", () => {
    for (const { coins } of partyLoot(-4, [1])) {
      expect(coins).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("rollUpContributions", () => {
  const row = (userId: number, damage: number) => ({ userId, damage });

  it("returns one entry per party member, in the member order given", () => {
    const rolled = rollUpContributions([row(2, 95), row(1, 120)], [1, 2]);
    expect(rolled).toEqual([
      { userId: 1, damage: 120 },
      { userId: 2, damage: 95 },
    ]);
  });
  it("shows a member who hasn't struck yet as zero — never omits or ranks them", () => {
    const rolled = rollUpContributions([row(1, 40)], [1, 2]);
    expect(rolled).toEqual([
      { userId: 1, damage: 40 },
      { userId: 2, damage: 0 },
    ]);
  });
  it("ignores stray rows for users who aren't party members", () => {
    const rolled = rollUpContributions([row(1, 10), row(99, 999)], [1, 2]);
    expect(rolled).toEqual([
      { userId: 1, damage: 10 },
      { userId: 2, damage: 0 },
    ]);
  });
  it("returns an empty list for a memberless party", () => {
    expect(rollUpContributions([row(1, 10)], [])).toEqual([]);
  });
});
