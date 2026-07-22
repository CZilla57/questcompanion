import { describe, it, expect } from "vitest";
import { NAV_GROUPS, activeGroupKey } from "./nav-groups";

describe("NAV_GROUPS shape", () => {
  it("has exactly 7 desktop entries and 5 mobile entries", () => {
    expect(NAV_GROUPS).toHaveLength(7);
    expect(NAV_GROUPS.filter((g) => g.mobileShow)).toHaveLength(5);
    expect(NAV_GROUPS.filter((g) => g.mobileShow).map((g) => g.label))
      .toEqual(["Home", "Quests", "Focus", "Progress", "Hero"]);
  });
  it("keeps every pre-consolidation nav href reachable in some group", () => {
    const reachable = NAV_GROUPS.flatMap((g) => [g.href, ...(g.tabs ?? []).map((t) => t.href)]);
    // /dopamine-menu and /rewards are the two retired URLs (Honest Coin) —
    // they redirect to /rewards/treats in App.tsx instead of appearing here.
    for (const href of ["/", "/tasks", "/questlines", "/focus", "/recurring", "/progress",
      "/insights", "/avatar", "/partners", "/leaderboard",
      "/rewards/treats", "/rewards/store", "/rewards/perks"]) {
      expect(reachable).toContain(href);
    }
  });
  it("group hrefs are unique", () => {
    const hrefs = NAV_GROUPS.map((g) => g.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("activeGroupKey", () => {
  it("matches exact group and tab hrefs", () => {
    expect(activeGroupKey("/")).toBe("home");
    expect(activeGroupKey("/tasks")).toBe("quests");
    expect(activeGroupKey("/recurring")).toBe("quests");
    expect(activeGroupKey("/insights")).toBe("progress");
    expect(activeGroupKey("/leaderboard")).toBe("allies");
    expect(activeGroupKey("/rewards/treats")).toBe("rewards");
    expect(activeGroupKey("/rewards/perks")).toBe("rewards");
  });
  it("matches :id subroutes by prefix, but never treats / as a prefix", () => {
    expect(activeGroupKey("/questlines/7")).toBe("quests");
    expect(activeGroupKey("/partners/3")).toBe("allies");
    expect(activeGroupKey("/reflection")).toBeNull();
  });
});

describe("campaigns tab", () => {
  it("lives in the quests group", () => {
    const quests = NAV_GROUPS.find((g) => g.key === "quests");
    expect(quests?.tabs?.some((t) => t.href === "/campaigns")).toBe(true);
  });
  it("carries the campaigns feature key so it can be gated", () => {
    const quests = NAV_GROUPS.find((g) => g.key === "quests");
    const tab = quests?.tabs?.find((t) => t.href === "/campaigns");
    expect(tab?.feature).toBe("campaigns");
  });
  it("lights the Quests group for a campaign detail URL", () => {
    expect(activeGroupKey("/campaigns/7")).toBe("quests");
  });
  it("adds no new top-level nav entry", () => {
    expect(NAV_GROUPS).toHaveLength(7);
  });
});
