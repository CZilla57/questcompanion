import { describe, it, expect } from "vitest";
import {
  CATEGORY_TO_KINGDOM, kingdomForCategory, kingdomTier, KINGDOMS,
  deriveLiveliness, isWorldResting, WORLD_RESTING_THRESHOLD, LIVELINESS_WINDOW_DAYS,
  deriveNeglectInvitation, kingdomGrowth,
} from "./kingdoms";
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

describe("deriveLiveliness", () => {
  it("is dormant with no activity regardless of the total", () => {
    expect(deriveLiveliness(0, 1000)).toBe("dormant");
    expect(deriveLiveliness(0, 0)).toBe("dormant");
  });

  it("bands on share of the balance total", () => {
    expect(deriveLiveliness(5, 1000)).toBe("stirring");   // 0.5%
    expect(deriveLiveliness(99, 1000)).toBe("stirring");  // 9.9%
    expect(deriveLiveliness(100, 1000)).toBe("steady");   // 10%
    expect(deriveLiveliness(300, 1000)).toBe("steady");   // 30%
    expect(deriveLiveliness(301, 1000)).toBe("bustling"); // 30.1%
  });

  it("reads the same for a low-activity and a high-activity user at equal share", () => {
    // The whole point of share-based bands: absolute thresholds would show a
    // quiet user five dormant kingdoms and a busy user five bustling ones.
    expect(deriveLiveliness(60, 300)).toBe(deriveLiveliness(6000, 30000));
  });

  it("never divides by zero", () => {
    expect(deriveLiveliness(50, 0)).toBe("dormant");
  });
});

describe("isWorldResting", () => {
  it("is true below the threshold", () => {
    expect(isWorldResting({ forge: 40, hearth: 30 })).toBe(true);
  });

  it("is true for a single quest in the window", () => {
    // Without a floor, share math would call this kingdom 100% — "bustling" —
    // and read the other four as pointed neglect.
    expect(isWorldResting({ forge: 25 })).toBe(true);
  });

  it("is false at or above the threshold", () => {
    expect(isWorldResting({ forge: WORLD_RESTING_THRESHOLD })).toBe(false);
  });

  it("ignores the capital when totalling", () => {
    // Uncategorized work must not make the world look awake.
    expect(isWorldResting({ capital: 5000, forge: 20 })).toBe(true);
  });

  it("is true for a completely empty world", () => {
    expect(isWorldResting({})).toBe(true);
  });
});

describe("window constant", () => {
  it("uses a 14-day liveliness window", () => {
    expect(LIVELINESS_WINDOW_DAYS).toBe(14);
  });
});

describe("deriveNeglectInvitation", () => {
  const active = { forge: 600, hearth: 300 }; // 900 recent, well above the floor

  it("invites back to a kingdom that is built but dormant", () => {
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, hearth: 2000, wellspring: 1200 },
      recentByKingdom: active,
    });
    expect(result).toMatchObject({ kingdomId: "wellspring", kingdomName: "Wellspring" });
  });

  it("never invites to a kingdom the user has never built in", () => {
    // Reflect the user's own pattern back; never prescribe a life.
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, hearth: 2000 },
      recentByKingdom: active,
    });
    expect(result).toBeNull();
  });

  it("is suppressed entirely when the world is resting", () => {
    // Absence belongs to hunger and the companion; kingdoms must not pile on.
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, wellspring: 1200 },
      recentByKingdom: { forge: 20 },
    });
    expect(result).toBeNull();
  });

  it("never invites to the capital", () => {
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { capital: 9000, forge: 5000 },
      recentByKingdom: active,
    });
    expect(result).toBeNull();
  });

  it("picks the most-built dormant kingdom when several qualify", () => {
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, wellspring: 1200, athenaeum: 3400 },
      recentByKingdom: active,
    });
    expect(result?.kingdomId).toBe("athenaeum");
  });

  it("returns null when every built kingdom is active", () => {
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, hearth: 2000 },
      recentByKingdom: { forge: 600, hearth: 300 },
    });
    expect(result).toBeNull();
  });
});

describe("kingdomGrowth", () => {
  it("routes points to the kingdom that owns the category", () => {
    expect(kingdomGrowth("deep_work", 35)).toEqual({ kingdomId: "forge", points: 35 });
    expect(kingdomGrowth("household", 20)).toEqual({ kingdomId: "hearth", points: 20 });
  });

  it("sends uncategorized work to the capital", () => {
    expect(kingdomGrowth("default", 15)).toEqual({ kingdomId: "capital", points: 15 });
  });

  it("sends an unknown category to the capital", () => {
    expect(kingdomGrowth("not_a_real_category", 15)).toEqual({ kingdomId: "capital", points: 15 });
  });

  it("declines zero or negative points", () => {
    expect(kingdomGrowth("health", 0)).toBeNull();
    expect(kingdomGrowth("health", -20)).toBeNull();
  });

  it("passes base points through unchanged", () => {
    // Growth must reflect the quest's own worth, never a boosted total.
    expect(kingdomGrowth("deep_work", 35)!.points).toBe(35);
  });
});
