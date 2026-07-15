import { describe, it, expect } from "vitest";
import {
  protectedStretch, selectProtectionNudge,
  FIRST_NUDGE_MIN, INTERVAL_MIN, STALE_SESSION_MIN, BEDTIME_HOUR,
  type Stretch,
} from "./hyperfocus";

const NOW = new Date("2026-07-14T18:00:00Z");
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("protectedStretch", () => {
  it("is active for a fresh active session; startedAt = session start", () => {
    const s = protectedStretch({
      activeSessions: [{ startedAt: minAgo(120), lastIntervalAt: minAgo(5) }],
      mode: "neutral", hyperfocusSince: null, now: NOW,
    });
    expect(s.active).toBe(true);
    expect(s.startedAt!.getTime()).toBe(minAgo(120).getTime());
  });

  it("ignores a stale active session (no recent interval)", () => {
    const s = protectedStretch({
      activeSessions: [{ startedAt: minAgo(200), lastIntervalAt: minAgo(STALE_SESSION_MIN + 15) }],
      mode: "neutral", hyperfocusSince: null, now: NOW,
    });
    expect(s.active).toBe(false);
  });

  it("counts a fresh session with no completed interval yet (lastIntervalAt null)", () => {
    const s = protectedStretch({ activeSessions: [{ startedAt: minAgo(20), lastIntervalAt: null }], mode: "neutral", hyperfocusSince: null, now: NOW });
    expect(s.active).toBe(true);
    expect(s.startedAt!.getTime()).toBe(minAgo(20).getTime());
  });

  it("is active for held hyperfocus mode; startedAt = since", () => {
    const s = protectedStretch({ activeSessions: [], mode: "hyperfocus", hyperfocusSince: minAgo(90), now: NOW });
    expect(s.active).toBe(true);
    expect(s.startedAt!.getTime()).toBe(minAgo(90).getTime());
  });

  it("takes the earliest signal when both present", () => {
    const s = protectedStretch({
      activeSessions: [{ startedAt: minAgo(100), lastIntervalAt: minAgo(2) }],
      mode: "hyperfocus", hyperfocusSince: minAgo(200), now: NOW,
    });
    expect(s.startedAt!.getTime()).toBe(minAgo(200).getTime());
  });

  it("is inactive with no signals", () => {
    expect(protectedStretch({ activeSessions: [], mode: "neutral", hyperfocusSince: null, now: NOW }).active).toBe(false);
  });
});

describe("selectProtectionNudge", () => {
  const active = (startMin: number): Stretch => ({ active: true, startedAt: minAgo(startMin) });
  const base = {
    stretch: active(FIRST_NUDGE_MIN + 30), now: NOW, localHour: 14,
    lastNudgedAt: null as Date | null, lastKind: null as null | "hydrate" | "stretch" | "food" | "bedtime",
    hungerStage: "well_fed" as const, pausedUntil: null as Date | null,
  };

  it("null below the first-nudge threshold", () => {
    expect(selectProtectionNudge({ ...base, stretch: active(FIRST_NUDGE_MIN - 10) })).toBeNull();
  });
  it("null while paused", () => {
    expect(selectProtectionNudge({ ...base, pausedUntil: minAgo(-30) })).toBeNull(); // 30 min in future
  });
  it("null within the spacing interval of a same-stretch nudge", () => {
    expect(selectProtectionNudge({ ...base, lastNudgedAt: minAgo(INTERVAL_MIN - 20) })).toBeNull();
  });
  it("null in the deep-night window", () => {
    expect(selectProtectionNudge({ ...base, localHour: 3 })).toBeNull();
  });
  it("bedtime when it's late", () => {
    expect(selectProtectionNudge({ ...base, localHour: BEDTIME_HOUR })!.kind).toBe("bedtime");
    expect(selectProtectionNudge({ ...base, localHour: 1 })!.kind).toBe("bedtime");
  });
  it("food when the hero is hungry", () => {
    expect(selectProtectionNudge({ ...base, hungerStage: "hungry" })!.kind).toBe("food");
  });
  it("food in a meal window", () => {
    expect(selectProtectionNudge({ ...base, localHour: 12 })!.kind).toBe("food");
  });
  it("hydrate by default, stretch when last was hydrate (same stretch)", () => {
    expect(selectProtectionNudge(base)!.kind).toBe("hydrate");
    expect(selectProtectionNudge({ ...base, lastKind: "hydrate", lastNudgedAt: minAgo(INTERVAL_MIN + 5) })!.kind).toBe("stretch");
  });
  it("treats lastKind from before this stretch as fresh (hydrate)", () => {
    // lastNudgedAt older than stretch start -> lastKind ignored
    expect(selectProtectionNudge({ ...base, stretch: active(FIRST_NUDGE_MIN + 30), lastKind: "hydrate", lastNudgedAt: minAgo(FIRST_NUDGE_MIN + 60) })!.kind).toBe("hydrate");
  });
});
