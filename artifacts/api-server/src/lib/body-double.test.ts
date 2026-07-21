import { describe, it, expect } from "vitest";
import {
  HERE_THRESHOLD_SEC, WAVE_MIN_GAP_SEC, SWEEP_STALE_MIN, SWEEP_MAX_AGE_HOURS,
  presenceOf, isSprintMinutes, sprintElapsedOk, sprintBonusXp,
  eligibleMembers, canWave, shouldSweepRoom, shouldSendInvitePush,
} from "./body-double";

const T0 = new Date("2026-07-21T15:00:00Z");
const secAgo = (s: number) => new Date(T0.getTime() - s * 1000);
const minAgo = (m: number) => secAgo(m * 60);

describe("presenceOf", () => {
  it("fresh heartbeat is here", () => {
    expect(presenceOf(secAgo(10), T0)).toBe("here");
  });
  it("boundary is inclusive on here", () => {
    expect(presenceOf(secAgo(HERE_THRESHOLD_SEC), T0)).toBe("here");
  });
  it("stale heartbeat is heads-down (positive state), never absent", () => {
    expect(presenceOf(secAgo(HERE_THRESHOLD_SEC + 1), T0)).toBe("headsDown");
    expect(presenceOf(minAgo(120), T0)).toBe("headsDown");
  });
});

describe("isSprintMinutes", () => {
  it("accepts exactly the preset focus lengths", () => {
    expect(isSprintMinutes(15)).toBe(true);
    expect(isSprintMinutes(25)).toBe(true);
    expect(isSprintMinutes(50)).toBe(true);
  });
  it("rejects everything else", () => {
    for (const bad of [20, 0, -15, 25.5, "25", null, undefined, {}]) {
      expect(isSprintMinutes(bad)).toBe(false);
    }
  });
});

describe("sprintElapsedOk", () => {
  it("rejects an early finish", () => {
    expect(sprintElapsedOk(minAgo(10), 15, T0)).toBe(false);
  });
  it("accepts exact elapsed", () => {
    expect(sprintElapsedOk(minAgo(15), 15, T0)).toBe(true);
  });
  it("honors the focus-session grace window", () => {
    expect(sprintElapsedOk(secAgo(15 * 60 - 5), 15, T0)).toBe(true); // GRACE_SECONDS = 5
    expect(sprintElapsedOk(secAgo(15 * 60 - 6), 15, T0)).toBe(false);
  });
});

describe("sprintBonusXp", () => {
  it("pays exactly a focus block (D5): 15→8, 25→10, 50→15", () => {
    expect(sprintBonusXp(15)).toBe(8);
    expect(sprintBonusXp(25)).toBe(10);
    expect(sprintBonusXp(50)).toBe(15);
  });
});

describe("eligibleMembers", () => {
  it("eligibility is not-left, NEVER heartbeat freshness", () => {
    const members = [
      { userId: 1, leftAt: null },      // host, phone locked for an hour — still paid
      { userId: 2, leftAt: minAgo(5) }, // left — not paid
      { userId: 3, leftAt: null },
    ];
    expect(eligibleMembers(members).map((m) => m.userId)).toEqual([1, 3]);
  });
});

describe("canWave", () => {
  it("first wave is always allowed", () => {
    expect(canWave(null, T0)).toBe(true);
  });
  it("enforces the minimum gap", () => {
    expect(canWave(secAgo(WAVE_MIN_GAP_SEC - 1), T0)).toBe(false);
    expect(canWave(secAgo(WAVE_MIN_GAP_SEC), T0)).toBe(true);
  });
});

describe("shouldSweepRoom", () => {
  it("keeps a room with any fresh member", () => {
    expect(shouldSweepRoom(minAgo(300), [minAgo(SWEEP_STALE_MIN + 30), minAgo(1)], T0)).toBe(false);
  });
  it("sweeps when every member is stale", () => {
    expect(shouldSweepRoom(minAgo(300), [minAgo(SWEEP_STALE_MIN), minAgo(200)], T0)).toBe(true);
  });
  it("stale threshold clears the longest sprint (heads-down rooms keep claimable sprints)", () => {
    expect(SWEEP_STALE_MIN).toBeGreaterThan(50);
    expect(shouldSweepRoom(minAgo(60), [minAgo(55)], T0)).toBe(false);
  });
  it("sweeps ancient rooms regardless of freshness", () => {
    expect(shouldSweepRoom(new Date(T0.getTime() - SWEEP_MAX_AGE_HOURS * 3_600_000), [minAgo(1)], T0)).toBe(true);
  });
});

describe("shouldSendInvitePush", () => {
  const prefs = { quietHoursStart: 22, quietHoursEnd: 8 };
  it("sends during the recipient's local daytime", () => {
    // 15:00 UTC = 11:00 in New York — daytime, outside 22→8 quiet.
    expect(shouldSendInvitePush({ timezone: "America/New_York", ...prefs }, T0)).toBe(true);
  });
  it("skips the deep-night floor [2,7) in the recipient's tz", () => {
    // 15:00 UTC = 05:00 in Honolulu (UTC-10) — deep night even with quiet hours off.
    expect(shouldSendInvitePush({ timezone: "Pacific/Honolulu", quietHoursStart: 12, quietHoursEnd: 12 }, T0)).toBe(false);
  });
  it("skips the recipient's own quiet hours (wrapping midnight)", () => {
    // 15:00 UTC = 03:00 next day in Auckland (UTC+12, NZST in July) — inside 22→8
    // (and the deep-night floor); both independently veto.
    expect(shouldSendInvitePush({ timezone: "Pacific/Auckland", ...prefs }, T0)).toBe(false);
  });
  it("quiet hours veto outside deep night too", () => {
    // 15:00 UTC = 08:00 in Tokyo next morning? No — 00:00 next day in Tokyo (UTC+9).
    // Use a quiet window that covers the recipient's local noon instead:
    // 15:00 UTC = 11:00 in New York; quiet 10→14 covers it.
    expect(shouldSendInvitePush({ timezone: "America/New_York", quietHoursStart: 10, quietHoursEnd: 14 }, T0)).toBe(false);
  });
  it("start === end means no quiet hours", () => {
    expect(shouldSendInvitePush({ timezone: "America/New_York", quietHoursStart: 9, quietHoursEnd: 9 }, T0)).toBe(true);
  });
  it("null timezone falls back to UTC", () => {
    // 15:00 UTC — daytime in UTC, outside 22→8.
    expect(shouldSendInvitePush({ timezone: null, ...prefs }, T0)).toBe(true);
  });
});
