import { describe, it, expect } from "vitest";
import { isNetworkError, isDeadZoneError } from "./net-errors";

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

describe("isDeadZoneError (capture stash trigger)", () => {
  it("true for network failures and aborts", () => {
    expect(isDeadZoneError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isDeadZoneError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
  });
  it("true for 5xx (cold start, server down)", () => {
    expect(isDeadZoneError(Object.assign(new Error("HTTP 502"), { status: 502 }))).toBe(true);
    expect(isDeadZoneError(Object.assign(new Error("HTTP 500"), { status: 500 }))).toBe(true);
  });
  it("false for 4xx — a real rejection is not a dead zone", () => {
    expect(isDeadZoneError(Object.assign(new Error("HTTP 400"), { status: 400 }))).toBe(false);
    expect(isDeadZoneError(Object.assign(new Error("HTTP 422"), { status: 422 }))).toBe(false);
  });
  it("false for null/random objects", () => {
    expect(isDeadZoneError(null)).toBe(false);
    expect(isDeadZoneError({})).toBe(false);
  });
});
