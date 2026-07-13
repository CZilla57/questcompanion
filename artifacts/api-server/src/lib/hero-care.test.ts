import { describe, it, expect } from "vitest";
import {
  hungerStage,
  moodFor,
  hashSeed,
  hungerWarning,
  shouldSendFlavorPush,
  flavorCandidateMinute,
} from "./hero-care";

const fed = new Date("2026-07-01T12:00:00Z");
const hoursLater = (h: number) => new Date(fed.getTime() + h * 60 * 60 * 1000);

describe("hungerStage", () => {
  it("is well_fed under 24h", () => {
    expect(hungerStage(fed, fed)).toBe("well_fed");
    expect(hungerStage(fed, hoursLater(23.99))).toBe("well_fed");
  });
  it("boundaries are half-open lower bounds (exactly 24h/72h/120h/168h)", () => {
    expect(hungerStage(fed, hoursLater(24))).toBe("peckish");
    expect(hungerStage(fed, hoursLater(71.99))).toBe("peckish");
    expect(hungerStage(fed, hoursLater(72))).toBe("hungry");
    expect(hungerStage(fed, hoursLater(119.99))).toBe("hungry");
    expect(hungerStage(fed, hoursLater(120))).toBe("starving");
    expect(hungerStage(fed, hoursLater(167.99))).toBe("starving");
    expect(hungerStage(fed, hoursLater(168))).toBe("fainted");
    expect(hungerStage(fed, hoursLater(1000))).toBe("fainted");
  });
  it("treats now before lastFedAt (clock skew) as well_fed", () => {
    expect(hungerStage(fed, hoursLater(-5))).toBe("well_fed");
  });
});

describe("moodFor", () => {
  it("returns the exact mood line for every stage", () => {
    expect(moodFor("well_fed")).toBe("Content and ready for adventure");
    expect(moodFor("peckish")).toBe("Could use a hot meal");
    expect(moodFor("hungry")).toBe("Stomach growling loudly");
    expect(moodFor("starving")).toBe("Too weak to travel");
    expect(moodFor("fainted")).toBe("Has succumbed to hunger…");
  });
});

describe("hashSeed", () => {
  it("is deterministic and non-negative", () => {
    expect(hashSeed("42:1234")).toBe(hashSeed("42:1234"));
    expect(hashSeed("42:1234")).toBeGreaterThanOrEqual(0);
  });
  it("differs across inputs", () => {
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });
});

describe("hungerWarning", () => {
  it("returns null for well_fed and peckish", () => {
    expect(hungerWarning("well_fed", null)).toBeNull();
    expect(hungerWarning("peckish", null)).toBeNull();
  });
  it("returns a push payload for hungry/starving/fainted when not yet notified", () => {
    for (const s of ["hungry", "starving", "fainted"] as const) {
      const w = hungerWarning(s, null);
      expect(w).not.toBeNull();
      expect(w!.title.length).toBeGreaterThan(0);
      expect(w!.body.length).toBeGreaterThan(0);
      expect(w!.tag).toBe("hero-hunger");
    }
  });
  it("warns once per stage: null when already notified for this stage", () => {
    expect(hungerWarning("hungry", "hungry")).toBeNull();
  });
  it("escalates: notified hungry, now starving -> warns again", () => {
    expect(hungerWarning("starving", "hungry")).not.toBeNull();
  });
});

describe("flavorCandidateMinute", () => {
  it("is deterministic for (userId, dateKey)", () => {
    expect(flavorCandidateMinute(1, "2026-07-13")).toEqual(flavorCandidateMinute(1, "2026-07-13"));
  });
  it("lands in daytime hours 9..20 and minutes 0..59", () => {
    for (const day of ["2026-07-13", "2026-07-14", "2026-07-15"]) {
      const { hour, minute } = flavorCandidateMinute(7, day);
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(20);
      expect(minute).toBeGreaterThanOrEqual(0);
      expect(minute).toBeLessThanOrEqual(59);
    }
  });
});

describe("shouldSendFlavorPush", () => {
  // Build a `now` that lands exactly on the user's candidate minute for that local day.
  function nowOnCandidate(userId: number, base: Date): Date {
    const dateKey = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    const { hour, minute } = flavorCandidateMinute(userId, dateKey);
    const d = new Date(base);
    d.setHours(hour, minute, 0, 0);
    return d;
  }
  const base = new Date("2026-07-13T00:00:00");

  it("fires on the candidate minute when well_fed and never pushed before", () => {
    const now = nowOnCandidate(1, base);
    expect(shouldSendFlavorPush({ userId: 1, stage: "well_fed", lastFlavorPushAt: null, now })).toBe(true);
  });
  it("never fires for hungry/starving/fainted", () => {
    const now = nowOnCandidate(1, base);
    for (const s of ["hungry", "starving", "fainted"] as const) {
      expect(shouldSendFlavorPush({ userId: 1, stage: s, lastFlavorPushAt: null, now })).toBe(false);
    }
  });
  it("does not fire off the candidate minute", () => {
    const now = nowOnCandidate(1, base);
    const off = new Date(now.getTime() + 60 * 1000);
    expect(shouldSendFlavorPush({ userId: 1, stage: "well_fed", lastFlavorPushAt: null, now: off })).toBe(false);
  });
  it("rate limit: blocked within 48h of the last flavor push", () => {
    const now = nowOnCandidate(1, base);
    const recent = new Date(now.getTime() - 47 * 60 * 60 * 1000);
    expect(shouldSendFlavorPush({ userId: 1, stage: "well_fed", lastFlavorPushAt: recent, now })).toBe(false);
    const old = new Date(now.getTime() - 49 * 60 * 60 * 1000);
    expect(shouldSendFlavorPush({ userId: 1, stage: "well_fed", lastFlavorPushAt: old, now })).toBe(true);
  });
  it("rate limit is half-open: exactly 48h since the last push allows sending", () => {
    const now = nowOnCandidate(1, base);
    const exactly = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    expect(shouldSendFlavorPush({ userId: 1, stage: "well_fed", lastFlavorPushAt: exactly, now })).toBe(true);
  });
});
