import { describe, it, expect } from "vitest";
import { buildQuickAddPrompt, parseQuickAddResult, QuickAddParseError } from "./quick-add-parse";

const NOW = new Date(2026, 6, 12, 9, 0, 0);

describe("buildQuickAddPrompt", () => {
  it("includes the raw text and today's date", () => {
    const p = buildQuickAddPrompt("ping landlord next week", { now: NOW });
    expect(p).toContain("ping landlord next week");
    expect(p).toContain("2026-07-12");
  });
});

describe("parseQuickAddResult", () => {
  it("keeps valid fields", () => {
    const r = parseQuickAddResult(
      { title: "Ping landlord", dueDate: "2026-07-20", dueTime: "09:00", priority: "high", category: "admin" },
      { text: "ping landlord next week" },
    );
    expect(r).toEqual({
      title: "Ping landlord",
      dueDate: "2026-07-20",
      dueTime: "09:00",
      priority: "high",
    });
  });

  it("drops invalid date/time/priority/category and keeps the title", () => {
    const r = parseQuickAddResult(
      { title: "Do thing", dueDate: "2026-02-30", dueTime: "99:99", priority: "urgent", category: "work" },
      { text: "do thing" },
    );
    expect(r).toEqual({ title: "Do thing" });
  });

  it("falls back to the raw text when title is missing", () => {
    const r = parseQuickAddResult({ dueDate: "2026-07-20" }, { text: "  buy milk  " });
    expect(r.title).toBe("buy milk");
    expect(r.dueDate).toBe("2026-07-20");
  });

  it("throws on non-object model output", () => {
    expect(() => parseQuickAddResult("nope", { text: "x" })).toThrow(QuickAddParseError);
  });
});

describe("parseQuickAddResult — recurrence", () => {
  it("keeps a valid recurrence object", () => {
    const r = parseQuickAddResult(
      { title: "Water plants", recurrence: { frequency: "weekly", daysOfWeek: [1, 4] } },
      { text: "water plants every mon and thu" },
    );
    expect(r.recurrence).toEqual({ frequency: "weekly", daysOfWeek: [1, 4] });
  });

  it("drops recurrence with an unknown frequency", () => {
    const r = parseQuickAddResult(
      { title: "x", recurrence: { frequency: "biweekly", daysOfWeek: [1] } },
      { text: "x every other monday" },
    );
    expect(r.recurrence).toBeUndefined();
  });

  it("drops recurrence with an out-of-range dayOfMonth", () => {
    const r = parseQuickAddResult(
      { title: "x", recurrence: { frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 45 } },
      { text: "x" },
    );
    expect(r.recurrence).toBeUndefined();
  });

  it("drops recurrence with an out-of-range weekday", () => {
    const r = parseQuickAddResult(
      { title: "x", recurrence: { frequency: "weekly", daysOfWeek: [1, 9] } },
      { text: "x" },
    );
    expect(r.recurrence).toBeUndefined();
  });

  it("omits recurrence entirely when the model returns none", () => {
    const r = parseQuickAddResult({ title: "One off", dueDate: "2026-07-20" }, { text: "one off" });
    expect(r.recurrence).toBeUndefined();
  });
});

describe("buildQuickAddPrompt — recurrence", () => {
  it("asks the model for a recurrence field", () => {
    const p = buildQuickAddPrompt("stretch every morning", { now: NOW });
    expect(p).toContain("recurrence");
  });
});
