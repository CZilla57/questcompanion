import { describe, it, expect } from "vitest";
import { isValidDueTime, isValidDueDate } from "./task-datetime";

describe("isValidDueTime", () => {
  it("accepts HH:mm in range", () => {
    expect(isValidDueTime("00:00")).toBe(true);
    expect(isValidDueTime("15:30")).toBe(true);
    expect(isValidDueTime("23:59")).toBe(true);
  });
  it("rejects malformed or out-of-range values", () => {
    expect(isValidDueTime("24:00")).toBe(false);
    expect(isValidDueTime("3:00")).toBe(false);   // needs two-digit hour
    expect(isValidDueTime("15:60")).toBe(false);
    expect(isValidDueTime("")).toBe(false);
    expect(isValidDueTime(1500)).toBe(false);
  });
});

describe("isValidDueDate", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    expect(isValidDueDate("2026-07-15")).toBe(true);
  });
  it("rejects impossible or malformed dates", () => {
    expect(isValidDueDate("2026-02-30")).toBe(false);
    expect(isValidDueDate("2026-7-5")).toBe(false);
    expect(isValidDueDate("nope")).toBe(false);
    expect(isValidDueDate(null)).toBe(false);
  });
});
