import { describe, it, expect } from "vitest";
import { isNetworkError } from "./net-errors";

describe("isNetworkError", () => {
  it("true for fetch's TypeError (no HTTP answer)", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });
  it("true for an abort (our capture timeout)", () => {
    const abort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    expect(isNetworkError(abort)).toBe(true);
  });
  it("false for server answers (anything carrying an HTTP status)", () => {
    expect(isNetworkError(Object.assign(new Error("HTTP 500"), { status: 500 }))).toBe(false);
    expect(isNetworkError(Object.assign(new Error("HTTP 401"), { status: 401 }))).toBe(false);
  });
  it("false for null/undefined/random objects", () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError({})).toBe(false);
  });
});
