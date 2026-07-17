import { describe, it, expect } from "vitest";
import {
  previousLocalWeek, inRecapWindow, buildWeekStats, isZeroSignal,
  recapSubject, recapAction, resolveEmailCapture, RECAP_START_HOUR,
  type WeekStatsInputs,
} from "./weekly-recap";
import { containsGuiltLanguage } from "./ai/reflection";
import type { PatternSummary } from "./patterns";

// 2026-07-20 is a Monday; the closed week is Mon 2026-07-13 .. Sun 2026-07-19 (ISO 2026-W29).
const MONDAY_13_UTC = new Date("2026-07-20T13:00:00Z");

function patterns(confidence: "none" | "low" | "ok"): PatternSummary {
  return {
    windowDays: 28,
    sampleSize: { completions: 20, focusMinutes: 100, checkins: 5, reflections: 3 },
    confidence,
    powerHours: [{ hour: 9, score: 3 }, { hour: 14, score: 2 }],
    bestDay: 2,
    medianQuestMinutes: 20,
    categoryMinutes: [],
    modeByBlock: [],
    topHelpers: ["timer", "body_double"],
    topBlockers: ["phone"],
  };
}

function inputs(overrides: Partial<WeekStatsInputs> = {}): WeekStatsInputs {
  return {
    weekKey: "2026-W29",
    completions: [],
    focusSessions: [],
    xpEarned: 0,
    levelUps: 0,
    coinsEarned: 0,
    initiations: 0,
    badges: [],
    questlinesCompleted: [],
    bossAttacks: [],
    bossDefeated: false,
    patterns: patterns("none"),
    ...overrides,
  };
}

describe("previousLocalWeek", () => {
  it("returns the closed Mon..Sun week for a UTC Monday", () => {
    expect(previousLocalWeek(MONDAY_13_UTC, "UTC")).toEqual({
      weekKey: "2026-W29",
      startDateKey: "2026-07-13",
      endDateKeyExclusive: "2026-07-20",
    });
  });

  it("uses the LOCAL calendar: Sunday 23:00 UTC is already Monday in Tokyo", () => {
    const sundayLateUtc = new Date("2026-07-19T23:00:00Z"); // Mon 08:00 JST
    expect(previousLocalWeek(sundayLateUtc, "Asia/Tokyo").weekKey).toBe("2026-W29");
    expect(previousLocalWeek(sundayLateUtc, "Asia/Tokyo").startDateKey).toBe("2026-07-13");
  });

  it("mid-week returns the same closed week as Monday did (callers gate on inRecapWindow)", () => {
    const wednesday = new Date("2026-07-22T13:00:00Z");
    expect(previousLocalWeek(wednesday, "UTC").startDateKey).toBe("2026-07-13");
  });
});

describe("inRecapWindow", () => {
  it("is true on Monday at/after the start hour, any time until local midnight", () => {
    expect(inRecapWindow(new Date("2026-07-20T08:00:00Z"), "UTC")).toBe(true);
    expect(inRecapWindow(new Date("2026-07-20T22:30:00Z"), "UTC")).toBe(true);
  });

  it("is false before the start hour and on other days", () => {
    expect(inRecapWindow(new Date("2026-07-20T07:59:00Z"), "UTC")).toBe(false);
    expect(inRecapWindow(new Date("2026-07-21T09:00:00Z"), "UTC")).toBe(false); // Tuesday
    expect(inRecapWindow(new Date("2026-07-19T09:00:00Z"), "UTC")).toBe(false); // Sunday
  });

  it("evaluates in the user's timezone", () => {
    // Mon 09:00 JST == Sun 00:00 UTC → true in Tokyo, false in UTC.
    const t = new Date("2026-07-20T00:00:00Z");
    expect(inRecapWindow(t, "Asia/Tokyo")).toBe(true);
    expect(inRecapWindow(t, "UTC")).toBe(false);
    expect(RECAP_START_HOUR).toBe(8);
  });
});

describe("buildWeekStats", () => {
  it("maps counts, minutes, and lists", () => {
    const stats = buildWeekStats(inputs({
      completions: [
        { title: "B", completedAt: new Date("2026-07-14T10:00:00Z") },
        { title: "A", completedAt: new Date("2026-07-13T10:00:00Z") },
      ],
      focusSessions: [{ focusedSeconds: 1500 }, { focusedSeconds: 900 }],
      xpEarned: 120, coinsEarned: 30, initiations: 4, levelUps: 1,
      badges: ["Early Bird"], questlinesCompleted: ["Spring Cleaning"],
      bossAttacks: [{ damage: 10 }, { damage: 15 }], bossDefeated: true,
      patterns: patterns("ok"),
    }));
    expect(stats.questsCompleted).toBe(2);
    expect(stats.sampleQuestTitles).toEqual(["A", "B"]); // completedAt order
    expect(stats.focusSessions).toBe(2);
    expect(stats.focusMinutes).toBe(40);
    expect(stats.boss).toEqual({ damage: 25, attacks: 2, defeated: true });
    expect(stats.rhythms).toEqual({ powerHours: [9, 14], bestDay: 2, topHelpers: ["timer", "body_double"] });
  });

  it("caps sample titles at 5", () => {
    const completions = Array.from({ length: 8 }, (_, i) => ({
      title: `Q${i}`, completedAt: new Date(Date.UTC(2026, 6, 13 + i % 7, i)),
    }));
    expect(buildWeekStats(inputs({ completions })).sampleQuestTitles).toHaveLength(5);
  });

  it("nulls boss with no attacks and rhythms below ok confidence", () => {
    const stats = buildWeekStats(inputs({ patterns: patterns("low"), bossDefeated: true }));
    expect(stats.boss).toBeNull();
    expect(stats.rhythms).toBeNull();
  });
});

describe("isZeroSignal", () => {
  it("is true only when every signal is zero", () => {
    expect(isZeroSignal(buildWeekStats(inputs()))).toBe(true);
    expect(isZeroSignal(buildWeekStats(inputs({ xpEarned: 5 })))).toBe(false);
    expect(isZeroSignal(buildWeekStats(inputs({ bossAttacks: [{ damage: 1 }] })))).toBe(false);
  });
});

describe("recapSubject", () => {
  it("leads with quests, then focus, then boss, then a generic line", () => {
    expect(recapSubject(buildWeekStats(inputs({
      completions: [{ title: "A", completedAt: new Date() }],
    })))).toContain("1 quest");
    expect(recapSubject(buildWeekStats(inputs({
      focusSessions: [{ focusedSeconds: 600 }],
    })))).toContain("10 focused minutes");
    expect(recapSubject(buildWeekStats(inputs({
      bossAttacks: [{ damage: 12 }],
    })))).toContain("12 damage");
    expect(recapSubject(buildWeekStats(inputs({ xpEarned: 5 })))).toContain("week in review");
  });

  it("never contains guilt language", () => {
    for (const stats of [inputs(), inputs({ xpEarned: 5 }), inputs({ completions: [{ title: "A", completedAt: new Date() }] })]) {
      expect(containsGuiltLanguage(recapSubject(buildWeekStats(stats)))).toBe(false);
    }
  });
});

describe("recapAction", () => {
  it("resumes from where the row died", () => {
    expect(recapAction({ skipped: true, sentAt: null, narrative: null })).toBe("done");
    expect(recapAction({ skipped: false, sentAt: new Date(), narrative: "x" })).toBe("done");
    expect(recapAction({ skipped: false, sentAt: null, narrative: null })).toBe("generate");
    expect(recapAction({ skipped: false, sentAt: null, narrative: "x" })).toBe("send");
  });
});

describe("resolveEmailCapture", () => {
  const token = () => "tok-1";

  it("captures a new email with a fresh token", () => {
    expect(resolveEmailCapture("a@b.com", { email: null, recapUnsubscribeToken: null }, token))
      .toEqual({ email: "a@b.com", recapUnsubscribeToken: "tok-1" });
  });

  it("no-ops when email and token already match", () => {
    expect(resolveEmailCapture("a@b.com", { email: "a@b.com", recapUnsubscribeToken: "t" }, token)).toBeNull();
  });

  it("backfills a missing token without changing a matching email", () => {
    expect(resolveEmailCapture("a@b.com", { email: "a@b.com", recapUnsubscribeToken: null }, token))
      .toEqual({ email: "a@b.com", recapUnsubscribeToken: "tok-1" });
  });

  it("updates a changed email but keeps the existing token (old links stay valid)", () => {
    expect(resolveEmailCapture("new@b.com", { email: "old@b.com", recapUnsubscribeToken: "t" }, token))
      .toEqual({ email: "new@b.com" });
  });

  it("rejects non-strings and non-addresses", () => {
    expect(resolveEmailCapture(undefined, { email: null, recapUnsubscribeToken: null }, token)).toBeNull();
    expect(resolveEmailCapture("not-an-email", { email: null, recapUnsubscribeToken: null }, token)).toBeNull();
  });
});
