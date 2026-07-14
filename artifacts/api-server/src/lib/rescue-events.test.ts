import { describe, it, expect } from "vitest";
import { parseRescueEvent } from "./rescue-events";

describe("parseRescueEvent", () => {
  it("accepts a full valid body", () => {
    expect(parseRescueEvent({ taskId: 7, blocker: "too_big", intervention: "breakdown" }))
      .toEqual({ ok: true, value: { taskId: 7, blocker: "too_big", intervention: "breakdown" } });
  });

  it("accepts a null/absent taskId", () => {
    expect(parseRescueEvent({ blocker: "overwhelmed", intervention: "emergency_mode" }))
      .toEqual({ ok: true, value: { taskId: null, blocker: "overwhelmed", intervention: "emergency_mode" } });
    expect(parseRescueEvent({ taskId: null, blocker: "wrong_quest", intervention: "reroll" }).ok).toBe(true);
  });

  it("rejects unknown blocker and intervention", () => {
    expect(parseRescueEvent({ blocker: "tired", intervention: "breakdown" }))
      .toEqual({ ok: false, error: "Unknown blocker" });
    expect(parseRescueEvent({ blocker: "too_big", intervention: "nap" }))
      .toEqual({ ok: false, error: "Unknown intervention" });
  });

  it("rejects a non-integer taskId", () => {
    expect(parseRescueEvent({ taskId: "seven", blocker: "too_big", intervention: "breakdown" }))
      .toEqual({ ok: false, error: "taskId must be an integer" });
    expect(parseRescueEvent({ taskId: 1.5, blocker: "too_big", intervention: "breakdown" }).ok).toBe(false);
  });
});
