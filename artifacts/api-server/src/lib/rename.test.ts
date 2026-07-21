import { describe, expect, it } from "vitest";
import { decideRename, isUniqueViolation, renameAvailableAt } from "./rename";

const NOW = new Date("2026-07-20T12:00:00Z");
const base = {
  current: "OldName",
  requested: "NewName",
  onboardingComplete: true,
  usernameChangedAt: null as Date | null,
  now: NOW,
};

describe("decideRename", () => {
  it("no-ops on the same name (clock untouched)", () => {
    expect(decideRename({ ...base, requested: "OldName" })).toEqual({ kind: "noop" });
  });
  it("rejects bad formats server-side", () => {
    for (const bad of ["ab", "a".repeat(21), "has space", "sneaky-dash", ""]) {
      expect(decideRename({ ...base, requested: bad }).kind).toBe("invalid_format");
    }
  });
  it("trims before validating and comparing", () => {
    expect(decideRename({ ...base, requested: "  OldName  " })).toEqual({ kind: "noop" });
  });
  it("lets the onboarding set through with no clock (typos are free)", () => {
    expect(decideRename({ ...base, onboardingComplete: false }))
      .toEqual({ kind: "ok", isOnboardingSet: true });
  });
  it("treats a same-name submit during onboarding as the onboarding set, not a noop", () => {
    expect(decideRename({ ...base, onboardingComplete: false, requested: "OldName" }))
      .toEqual({ kind: "ok", isOnboardingSet: true });
  });
  it("allows the first real rename (usernameChangedAt null)", () => {
    expect(decideRename(base)).toEqual({ kind: "ok", isOnboardingSet: false });
  });
  it("cooldowns a second rename inside 7 days, reporting when it reopens", () => {
    const changed = new Date("2026-07-18T12:00:00Z"); // 2 days ago
    const d = decideRename({ ...base, usernameChangedAt: changed });
    expect(d.kind).toBe("cooldown");
    if (d.kind === "cooldown") {
      expect(d.renameAvailableAt.toISOString()).toBe("2026-07-25T12:00:00.000Z");
    }
  });
  it("allows a rename exactly at the 7-day boundary", () => {
    const changed = new Date("2026-07-13T12:00:00Z"); // exactly 7 days
    expect(decideRename({ ...base, usernameChangedAt: changed }).kind).toBe("ok");
  });
});

describe("renameAvailableAt", () => {
  it("is null when never renamed", () => {
    expect(renameAvailableAt(null, NOW)).toBeNull();
  });
  it("is null once the window has passed", () => {
    expect(renameAvailableAt(new Date("2026-07-01T00:00:00Z"), NOW)).toBeNull();
  });
  it("is the reopen instant while cooling down", () => {
    expect(renameAvailableAt(new Date("2026-07-19T00:00:00Z"), NOW)).toBe("2026-07-26T00:00:00.000Z");
  });
});

describe("isUniqueViolation", () => {
  it("spots pg 23505 directly and through cause chains", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("wrap", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
