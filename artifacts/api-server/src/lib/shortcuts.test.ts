import { describe, it, expect } from "vitest";
import {
  ALL_CLEAR_MESSAGE, TODAY_LIST_CAP, buildCaptureFields, buildTodayPayload,
} from "./shortcuts";

// 2026-07-21T03:00:00Z = 2026-07-20 22:00 in Chicago — the classic
// west-of-UTC evening where UTC "today" is the user's tomorrow.
const LATE_EVENING_UTC = new Date("2026-07-21T03:00:00Z");

describe("buildCaptureFields (spec D5)", () => {
  it("dates a dateless capture to the user's LOCAL today, not the UTC day", () => {
    const f = buildCaptureFields("buy milk", { timezone: "America/Chicago", now: LATE_EVENING_UTC });
    expect(f.dueDate).toBe("2026-07-20");
    expect(f.title).toBe("buy milk");
    expect(f.message).toBe("Added for today: \"buy milk\" ⚔️");
  });

  it("falls back to UTC when no timezone is stored", () => {
    const f = buildCaptureFields("buy milk", { timezone: null, now: LATE_EVENING_UTC });
    expect(f.dueDate).toBe("2026-07-21");
  });

  it("honors a parsed relative date, phrased relative to the local today", () => {
    const f = buildCaptureFields("call dentist tomorrow", { timezone: "America/Chicago", now: LATE_EVENING_UTC });
    expect(f.dueDate).toBe("2026-07-21"); // local tomorrow (local today is the 20th)
    expect(f.title).toBe("call dentist");
    expect(f.message).toBe("Added for tomorrow: \"call dentist\" ⚔️");
  });

  it("phrases dates beyond tomorrow with the weekday", () => {
    const f = buildCaptureFields("dentist friday", { timezone: "UTC", now: new Date("2026-07-21T12:00:00Z") });
    expect(f.dueDate).toBe("2026-07-24");
    expect(f.message).toBe("Added for Fri, Jul 24: \"dentist\" ⚔️");
  });

  it("keeps a parsed time", () => {
    const f = buildCaptureFields("standup tomorrow at 9am", { timezone: "UTC", now: new Date("2026-07-21T12:00:00Z") });
    expect(f.dueTime).toBe("09:00");
  });

  it("never anchors and always defaults priority to medium with auto points", () => {
    const f = buildCaptureFields("buy milk", { timezone: "UTC", now: LATE_EVENING_UTC });
    expect(f.priority).toBe("medium");
    expect(f.points).toBeGreaterThan(0);
    expect(f.category).toBeTruthy();
    expect("isAnchored" in f).toBe(false); // the route hardcodes isAnchored: false
  });

  it("uses the raw text as title if parsing strips everything", () => {
    const f = buildCaptureFields("tomorrow", { timezone: "UTC", now: new Date("2026-07-21T12:00:00Z") });
    expect(f.title.length).toBeGreaterThan(0);
  });
});

describe("buildTodayPayload (spec D6)", () => {
  it("returns the all-clear on empty — never an empty-sounding message", () => {
    expect(buildTodayPayload([])).toEqual({ count: 0, message: ALL_CLEAR_MESSAGE, quests: {} });
  });

  it("maps titles to ids preserving order", () => {
    const p = buildTodayPayload([{ id: 42, title: "Buy milk" }, { id: 57, title: "Email Sam" }]);
    expect(p.quests).toEqual({ "Buy milk": 42, "Email Sam": 57 });
    expect(p.count).toBe(2);
    expect(p.message).toBe("Pick a quest to mark done");
  });

  it("suffixes duplicate titles, dodging pre-existing ' (2)' collisions", () => {
    const p = buildTodayPayload([
      { id: 1, title: "Email Sam" },
      { id: 2, title: "Email Sam (2)" },
      { id: 3, title: "Email Sam" },
    ]);
    expect(p.quests["Email Sam"]).toBe(1);
    expect(p.quests["Email Sam (2)"]).toBe(2);
    expect(p.quests["Email Sam (3)"]).toBe(3);
    expect(Object.keys(p.quests)).toHaveLength(3);
  });

  it("caps at TODAY_LIST_CAP and says so", () => {
    const rows = Array.from({ length: TODAY_LIST_CAP + 1 }, (_, i) => ({ id: i + 1, title: `Quest ${i + 1}` }));
    const p = buildTodayPayload(rows);
    expect(p.count).toBe(TODAY_LIST_CAP);
    expect(Object.keys(p.quests)).toHaveLength(TODAY_LIST_CAP);
    expect(p.message).toBe(`Pick a quest to mark done (showing ${TODAY_LIST_CAP} of ${TODAY_LIST_CAP + 1})`);
  });
});
