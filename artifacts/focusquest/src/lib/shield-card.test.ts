import { describe, it, expect } from "vitest";
import { shieldCardParts } from "./shield-card";

describe("shieldCardParts", () => {
  it("invites a first buy when affordable and none held", () => {
    const s = shieldCardParts({ owned: 0, atMax: false, affordable: true, remaining: 0, coinCost: 30 });
    expect(s.action).toEqual({ kind: "buy", label: "Buy for 30" });
    expect(s.ready).toBe(false);
    expect(s.statusLine).toBe("Protects your streak from a missed day.");
  });
  it("shows saving progress, never failure, when short", () => {
    const s = shieldCardParts({ owned: 0, atMax: false, affordable: false, remaining: 12, coinCost: 30 });
    expect(s.action).toEqual({ kind: "saving", label: "12 more to go" });
  });
  it("counts held shields with singular/plural copy and stays ready", () => {
    const one = shieldCardParts({ owned: 1, atMax: false, affordable: true, remaining: 0, coinCost: 30 });
    expect(one.ready).toBe(true);
    expect(one.statusLine).toBe("1 shield held — auto-activates if you miss a day");
    const two = shieldCardParts({ owned: 2, atMax: false, affordable: false, remaining: 5, coinCost: 30 });
    expect(two.statusLine).toBe("2 shields held — auto-activates if you miss a day");
    expect(two.action.kind).toBe("saving");
  });
  it("reads at-max as reassurance, not a wall", () => {
    const s = shieldCardParts({ owned: 3, atMax: true, affordable: true, remaining: 0, coinCost: 30 });
    expect(s.ready).toBe(true);
    expect(s.action).toEqual({ kind: "full", label: "Fully shielded 🛡️" });
  });
});
