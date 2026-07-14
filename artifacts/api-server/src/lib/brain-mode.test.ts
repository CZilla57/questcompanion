import { describe, it, expect } from "vitest";
import { deriveBrainState, modeExpiresAt, isBrainMode, isCheckinSource, MODE_TTL_HOURS } from "./brain-mode";

// Noon UTC = comfortably mid-day in both test zones (Chicago = -5/-6, Tokyo = +9).
const NOW = new Date("2026-07-14T12:00:00Z");

describe("deriveBrainState", () => {
  it("is neutral with null timestamps when there is no check-in", () => {
    expect(deriveBrainState(undefined, NOW, "America/Chicago")).toEqual({
      mode: "neutral", since: null, expiresAt: null, checkedInToday: false,
    });
  });

  it("returns a live mode inside the TTL on the same local day", () => {
    const createdAt = new Date("2026-07-14T11:00:00Z"); // 1h ago
    const s = deriveBrainState({ mode: "distracted", createdAt }, NOW, "America/Chicago");
    expect(s.mode).toBe("distracted");
    expect(s.since).toEqual(createdAt);
    expect(s.expiresAt).toEqual(new Date("2026-07-14T15:00:00Z")); // createdAt + 4h (before local midnight)
    expect(s.checkedInToday).toBe(true);
  });

  it("expires at exactly the 4h TTL boundary", () => {
    const createdAt = new Date(NOW.getTime() - MODE_TTL_HOURS * 3_600_000);
    const s = deriveBrainState({ mode: "focused", createdAt }, NOW, "America/Chicago");
    expect(s.mode).toBe("neutral");
    expect(s.checkedInToday).toBe(true); // expired but still today's check-in
  });

  it("dies at the local day boundary even inside the TTL (east of UTC)", () => {
    // 2026-07-14T14:00:00Z = 23:00 July 14 in Tokyo; 16:00Z = 01:00 July 15 Tokyo.
    const createdAt = new Date("2026-07-14T14:00:00Z");
    const later = new Date("2026-07-14T16:00:00Z"); // only 2h later, but next Tokyo day
    const s = deriveBrainState({ mode: "focused", createdAt }, later, "Asia/Tokyo");
    expect(s.mode).toBe("neutral");
    expect(s.checkedInToday).toBe(false); // the check-in belongs to Tokyo-yesterday
  });

  it("stays live across the UTC midnight when the local day hasn't ended (west of UTC)", () => {
    // 2026-07-14T23:30:00Z = 18:30 July 14 in Chicago; 01:00Z next date = 20:00 July 14 Chicago.
    const createdAt = new Date("2026-07-14T23:30:00Z");
    const later = new Date("2026-07-15T01:00:00Z");
    const s = deriveBrainState({ mode: "frozen", createdAt }, later, "America/Chicago");
    expect(s.mode).toBe("frozen");
    expect(s.checkedInToday).toBe(true);
  });

  it("a neutral check-in clears and does NOT resurrect an older mode", () => {
    // deriveBrainState only ever sees the newest row — a neutral newest row is a clear.
    const createdAt = new Date("2026-07-14T11:30:00Z");
    const s = deriveBrainState({ mode: "neutral", createdAt }, NOW, "America/Chicago");
    expect(s).toEqual({ mode: "neutral", since: null, expiresAt: null, checkedInToday: true });
  });

  it("treats an unknown stored mode as neutral (defensive)", () => {
    const s = deriveBrainState({ mode: "zoomies", createdAt: new Date("2026-07-14T11:00:00Z") }, NOW, "America/Chicago");
    expect(s.mode).toBe("neutral");
  });

  it("falls back to UTC on an invalid tz without throwing", () => {
    const createdAt = new Date("2026-07-14T11:00:00Z");
    const s = deriveBrainState({ mode: "focused", createdAt }, NOW, "not/a-zone");
    expect(s.mode).toBe("focused");
  });
});

describe("modeExpiresAt", () => {
  it("is createdAt+4h when local midnight is further away", () => {
    const createdAt = new Date("2026-07-14T15:00:00Z"); // 10:00 Chicago
    expect(modeExpiresAt(createdAt, "America/Chicago")).toEqual(new Date("2026-07-14T19:00:00Z"));
  });

  it("is the next local midnight when that comes first", () => {
    const createdAt = new Date("2026-07-15T03:00:00Z"); // 22:00 July 14 Chicago (CDT = UTC-5)
    // Chicago midnight July 15 = 2026-07-15T05:00:00Z — closer than createdAt+4h (07:00Z).
    expect(modeExpiresAt(createdAt, "America/Chicago")).toEqual(new Date("2026-07-15T05:00:00Z"));
  });
});

describe("guards", () => {
  it("accepts every mode and rejects junk", () => {
    for (const m of ["focused", "distracted", "frozen", "hyperfocus", "neutral"]) {
      expect(isBrainMode(m)).toBe(true);
    }
    expect(isBrainMode("angry")).toBe(false);
    expect(isBrainMode(3)).toBe(false);
  });
  it("accepts every source and rejects junk", () => {
    for (const s of ["tap", "daily_prompt", "emergency_exit"]) {
      expect(isCheckinSource(s)).toBe(true);
    }
    expect(isCheckinSource("cron")).toBe(false);
  });
});
