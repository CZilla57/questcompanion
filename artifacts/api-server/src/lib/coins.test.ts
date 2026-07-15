import { describe, it, expect } from "vitest";
import { tierCost, isValidTier, redeemDecision, isStreakMilestone, COIN_EARN } from "./coins";

describe("tierCost", () => {
  it("maps each tier to its fixed cost", () => {
    expect(tierCost("small")).toBe(20);
    expect(tierCost("medium")).toBe(60);
    expect(tierCost("large")).toBe(150);
    expect(tierCost("treat")).toBe(400);
  });
});

describe("isValidTier", () => {
  it("accepts known tiers, rejects everything else", () => {
    expect(isValidTier("small")).toBe(true);
    expect(isValidTier("treat")).toBe(true);
    expect(isValidTier("huge")).toBe(false);
    expect(isValidTier("")).toBe(false);
  });
});

describe("redeemDecision", () => {
  it("affordable at or above cost, remaining 0", () => {
    expect(redeemDecision(100, 60)).toEqual({ affordable: true, remaining: 0 });
    expect(redeemDecision(60, 60)).toEqual({ affordable: true, remaining: 0 });
  });
  it("not affordable below cost, remaining is the gap (never negative)", () => {
    expect(redeemDecision(40, 60)).toEqual({ affordable: false, remaining: 20 });
    expect(redeemDecision(0, 400)).toEqual({ affordable: false, remaining: 400 });
  });
});

describe("isStreakMilestone", () => {
  it("true only when the streak advances onto a milestone day", () => {
    expect(isStreakMilestone(3, 2)).toBe(true);
    expect(isStreakMilestone(7, 6)).toBe(true);
    expect(isStreakMilestone(14, 13)).toBe(true);
    expect(isStreakMilestone(30, 29)).toBe(true);
    expect(isStreakMilestone(60, 59)).toBe(true);
  });
  it("false off-milestone or when the streak did not advance", () => {
    expect(isStreakMilestone(5, 4)).toBe(false);
    expect(isStreakMilestone(7, 7)).toBe(false); // freeze / same day — no advance
    expect(isStreakMilestone(1, 0)).toBe(false);
  });
});

describe("COIN_EARN", () => {
  it("exposes the tunable earn amounts", () => {
    expect(COIN_EARN.questComplete).toBe(5);
    expect(COIN_EARN.focusSession).toBe(10);
    expect(COIN_EARN.streakMilestone).toBe(25);
    expect(COIN_EARN.questlineComplete).toBe(30);
    expect(COIN_EARN.bossWin).toBe(50);
  });
});
