import { describe, it, expect } from "vitest";
import {
  PERKS,
  getPerk,
  isValidPerkId,
  isBoostActive,
  boostBonusPoints,
  nextBoostExpiry,
  canBuyStreakShield,
  XP_BOOST_BONUS,
  XP_BOOST_HOURS,
  XP_BOOST_COST,
  FOCUS_BOOST_BONUS,
  FOCUS_BOOST_HOURS,
  FOCUS_BOOST_COST,
  STREAK_SHIELD_COST,
  MAX_STREAK_FREEZES,
} from "./stat-perks";

const HOUR = 60 * 60 * 1000;

describe("PERKS catalog", () => {
  it("exposes exactly the three v1 perks with tunable costs", () => {
    expect(PERKS.map((p) => p.id)).toEqual(["xp_boost", "focus_boost", "streak_shield"]);
    expect(getPerk("xp_boost")?.coinCost).toBe(XP_BOOST_COST);
    expect(getPerk("focus_boost")?.coinCost).toBe(FOCUS_BOOST_COST);
    expect(getPerk("streak_shield")?.coinCost).toBe(STREAK_SHIELD_COST);
  });

  it("maps each perk to a distinct spend ledger reason", () => {
    expect(getPerk("xp_boost")?.reason).toBe("perk_xp_boost");
    expect(getPerk("focus_boost")?.reason).toBe("perk_focus_boost");
    expect(getPerk("streak_shield")?.reason).toBe("perk_streak_shield");
  });

  it("exposes the tunable boost knobs", () => {
    expect(XP_BOOST_BONUS).toBe(0.5);
    expect(XP_BOOST_HOURS).toBe(12);
    expect(FOCUS_BOOST_BONUS).toBe(0.5);
    expect(FOCUS_BOOST_HOURS).toBe(12);
    expect(MAX_STREAK_FREEZES).toBe(3);
  });
});

describe("getPerk / isValidPerkId", () => {
  it("resolves known ids, rejects everything else", () => {
    expect(getPerk("xp_boost")?.kind).toBe("xp_boost");
    expect(getPerk("nope")).toBeUndefined();
    expect(isValidPerkId("streak_shield")).toBe(true);
    expect(isValidPerkId("focus_boost")).toBe(true);
    expect(isValidPerkId("coin_boost")).toBe(false);
    expect(isValidPerkId("")).toBe(false);
  });
});

describe("isBoostActive", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  it("is false when never bought (null)", () => {
    expect(isBoostActive(null, now)).toBe(false);
  });
  it("is false when the window has passed", () => {
    expect(isBoostActive(new Date("2026-07-15T11:59:59Z"), now)).toBe(false);
  });
  it("is false exactly at expiry (strict future)", () => {
    expect(isBoostActive(new Date("2026-07-15T12:00:00Z"), now)).toBe(false);
  });
  it("is true while the window is still in the future", () => {
    expect(isBoostActive(new Date("2026-07-15T13:00:00Z"), now)).toBe(true);
  });
});

describe("boostBonusPoints", () => {
  it("is 0 when the boost is inactive", () => {
    expect(boostBonusPoints(20, false, XP_BOOST_BONUS)).toBe(0);
  });
  it("adds round(base * bonus) when active", () => {
    expect(boostBonusPoints(20, true, 0.5)).toBe(10);
    expect(boostBonusPoints(30, true, 0.5)).toBe(15);
  });
  it("rounds to the nearest integer", () => {
    expect(boostBonusPoints(15, true, 0.5)).toBe(8); // 7.5 → 8
    expect(boostBonusPoints(5, true, 0.5)).toBe(3); // 2.5 → 3
  });
});

describe("nextBoostExpiry", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  it("starts a fresh window from now when never active", () => {
    expect(nextBoostExpiry(null, now, XP_BOOST_HOURS).getTime()).toBe(now.getTime() + XP_BOOST_HOURS * HOUR);
  });
  it("starts fresh from now when the previous window already lapsed", () => {
    const past = new Date("2026-07-15T06:00:00Z");
    expect(nextBoostExpiry(past, now, XP_BOOST_HOURS).getTime()).toBe(now.getTime() + XP_BOOST_HOURS * HOUR);
  });
  it("stacks onto a still-active window (never shortens it)", () => {
    const future = new Date("2026-07-15T14:00:00Z");
    expect(nextBoostExpiry(future, now, XP_BOOST_HOURS).getTime()).toBe(future.getTime() + XP_BOOST_HOURS * HOUR);
  });
});

describe("canBuyStreakShield", () => {
  it("allows buying below the cap", () => {
    expect(canBuyStreakShield(0)).toBe(true);
    expect(canBuyStreakShield(MAX_STREAK_FREEZES - 1)).toBe(true);
  });
  it("blocks at or above the cap", () => {
    expect(canBuyStreakShield(MAX_STREAK_FREEZES)).toBe(false);
    expect(canBuyStreakShield(MAX_STREAK_FREEZES + 1)).toBe(false);
  });
});
