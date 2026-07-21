import { describe, it, expect } from "vitest";
import { sprintCountdown } from "./body-double-countdown";

const START = "2026-07-21T15:00:00.000Z";
const startMs = new Date(START).getTime();

describe("sprintCountdown", () => {
  it("counts down from the shared server anchor", () => {
    expect(sprintCountdown(START, 25, startMs + 5 * 60_000)).toEqual({ remainingSeconds: 20 * 60, done: false });
  });
  it("is done exactly at the boundary", () => {
    expect(sprintCountdown(START, 15, startMs + 15 * 60_000)).toEqual({ remainingSeconds: 0, done: true });
  });
  it("clamps after the end (late joiner, resumed tab)", () => {
    expect(sprintCountdown(START, 15, startMs + 16 * 60_000)).toEqual({ remainingSeconds: 0, done: true });
  });
  it("rounds partial seconds up so the display never hits 00:00 early", () => {
    expect(sprintCountdown(START, 15, startMs + 15 * 60_000 - 500).remainingSeconds).toBe(1);
  });
});
