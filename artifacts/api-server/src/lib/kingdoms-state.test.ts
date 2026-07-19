import { describe, it, expect } from "vitest";
import { kingdomStates } from "./kingdoms";

describe("kingdomStates", () => {
  const lifetime = { hearth: 1200, wellspring: 300, forge: 3400, athenaeum: 60, crossroads: 900, capital: 1100 };

  it("reports the capital as the grand total on its own ladder", () => {
    const capital = kingdomStates(lifetime, {}).find((k) => k.id === "capital")!;
    expect(capital.lifetimePoints).toBe(6960);
    expect(capital.tier).toBe(7);
    expect(capital.tierName).toBe("City");
  });

  it("returns null liveliness for the capital and a reading for every kingdom", () => {
    const rows = kingdomStates(lifetime, { hearth: 100, forge: 100 });
    expect(rows.find((k) => k.id === "capital")!.liveliness).toBeNull();
    for (const k of rows.filter((r) => r.id !== "capital")) {
      expect(k.liveliness).not.toBeNull();
    }
  });

  it("leaves the five kingdoms on their own 6-tier ladder", () => {
    const forge = kingdomStates(lifetime, {}).find((k) => k.id === "forge")!;
    expect(forge.lifetimePoints).toBe(3400);
    expect(forge.tierName).toBe("Town");
  });

  it("returns all six kingdoms in KINGDOMS order", () => {
    expect(kingdomStates({}, {}).map((k) => k.id)).toEqual(
      ["hearth", "wellspring", "forge", "athenaeum", "crossroads", "capital"],
    );
  });

  it("never lets capital points reach the balance denominator", () => {
    // A huge capital total must not change any kingdom's liveliness.
    const withoutCapital = kingdomStates(lifetime, { hearth: 100, wellspring: 100, forge: 100, athenaeum: 100, crossroads: 100 });
    const withCapital = kingdomStates(lifetime, { hearth: 100, wellspring: 100, forge: 100, athenaeum: 100, crossroads: 100, capital: 999999 });
    expect(withCapital.map((k) => k.liveliness)).toEqual(withoutCapital.map((k) => k.liveliness));
  });
});
