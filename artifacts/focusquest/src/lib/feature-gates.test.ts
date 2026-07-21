import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "./nav-groups";
import { featureLabel, isNavGroupVisible, isUnlocked, routeFeature } from "./feature-gates";

describe("isUnlocked", () => {
  it("fails OPEN when the list is missing (offline shell, cold start)", () => {
    expect(isUnlocked(undefined, "rewards")).toBe(true);
  });
  it("reads the server's list", () => {
    expect(isUnlocked(["focus"], "focus")).toBe(true);
    expect(isUnlocked(["focus"], "hero")).toBe(false);
    expect(isUnlocked([], "focus")).toBe(false);
  });
});

describe("isNavGroupVisible", () => {
  it("always shows home and quests", () => {
    expect(isNavGroupVisible("home", [])).toBe(true);
    expect(isNavGroupVisible("quests", [])).toBe(true);
  });
  it("shows exactly Home+Quests for a fresh L1 list", () => {
    const visible = NAV_GROUPS.filter((g) => isNavGroupVisible(g.key, []));
    expect(visible.map((g) => g.key)).toEqual(["home", "quests"]);
  });
  it("shows everything when the list is missing (fail open)", () => {
    const visible = NAV_GROUPS.filter((g) => isNavGroupVisible(g.key, undefined));
    expect(visible.length).toBe(NAV_GROUPS.length);
  });
  it("adds groups as the list grows", () => {
    const visible = NAV_GROUPS.filter((g) => isNavGroupVisible(g.key, ["focus", "hero"]));
    expect(visible.map((g) => g.key)).toEqual(["home", "quests", "focus", "hero"]);
  });
});

describe("routeFeature", () => {
  it("maps every gated route to its feature", () => {
    expect(routeFeature("/focus")).toBe("focus");
    expect(routeFeature("/avatar")).toBe("hero");
    expect(routeFeature("/progress")).toBe("progress");
    expect(routeFeature("/insights")).toBe("progress");
    expect(routeFeature("/partners")).toBe("allies");
    expect(routeFeature("/partners/7")).toBe("allies");
    expect(routeFeature("/leaderboard")).toBe("allies");
    expect(routeFeature("/rewards/treats")).toBe("rewards");
    expect(routeFeature("/rewards/store")).toBe("rewards");
    expect(routeFeature("/rewards/perks")).toBe("rewards");
  });
  it("leaves L1 routes ungated", () => {
    for (const p of ["/", "/tasks", "/questlines", "/questlines/3", "/recurring", "/reflection"]) {
      expect(routeFeature(p)).toBeNull();
    }
  });
});

describe("featureLabel", () => {
  it("uses the nav label users will see", () => {
    expect(featureLabel("focus")).toBe("Focus");
    expect(featureLabel("rewards")).toBe("Rewards");
  });
  it("falls back to the key for unknown values", () => {
    expect(featureLabel("mystery")).toBe("mystery");
  });
});
