import { describe, it, expect } from "vitest";
import { kingdomGrowth } from "./kingdom-growth";

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
