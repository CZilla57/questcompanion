import { describe, it, expect } from "vitest";
import { CATEGORY_TO_KINGDOM, kingdomForCategory, kingdomTier, KINGDOMS } from "./kingdoms";
import { CATEGORY_LABELS } from "./auto-points";

describe("kingdom mapping", () => {
  it("maps every canonical category to a kingdom", () => {
    for (const slug of Object.keys(CATEGORY_LABELS)) {
      expect(CATEGORY_TO_KINGDOM[slug], `category ${slug} is unmapped`).toBeDefined();
    }
  });

  it("routes the default category to the capital", () => {
    expect(kingdomForCategory("default")).toBe("capital");
  });

  it("groups the working life into the forge", () => {
    expect(kingdomForCategory("deep_work")).toBe("forge");
    expect(kingdomForCategory("finance")).toBe("forge");
    expect(kingdomForCategory("admin")).toBe("forge");
  });

  it("falls back to the capital for an unknown category", () => {
    expect(kingdomForCategory("not_a_real_category")).toBe("capital");
  });

  it("marks exactly one kingdom as the capital", () => {
    expect(KINGDOMS.filter((k) => k.isCapital)).toHaveLength(1);
  });
});

describe("kingdomTier", () => {
  it("returns Wild at zero points", () => {
    expect(kingdomTier(0)).toMatchObject({ tier: 0, name: "Wild" });
  });

  it("returns tier boundaries exactly", () => {
    expect(kingdomTier(1).tier).toBe(1);
    expect(kingdomTier(249).tier).toBe(1);
    expect(kingdomTier(250).tier).toBe(2);
    expect(kingdomTier(999).tier).toBe(2);
    expect(kingdomTier(1000).tier).toBe(3);
    expect(kingdomTier(2999).tier).toBe(3);
    expect(kingdomTier(3000).tier).toBe(4);
    expect(kingdomTier(7999).tier).toBe(4);
    expect(kingdomTier(8000).tier).toBe(5);
  });

  it("never regresses as points grow", () => {
    let last = -1;
    for (let p = 0; p <= 9000; p += 37) {
      const t = kingdomTier(p).tier;
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
});
