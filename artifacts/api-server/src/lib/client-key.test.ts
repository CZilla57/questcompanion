import { describe, it, expect } from "vitest";
import { isValidClientKey, CLIENT_KEY_MIN, CLIENT_KEY_MAX } from "./client-key";

describe("isValidClientKey (Never Lose a Thought: capture idempotency)", () => {
  it("accepts a crypto.randomUUID()-shaped key", () => {
    expect(isValidClientKey("9b2f4a1e-6c3d-4e5f-8a7b-0c1d2e3f4a5b")).toBe(true);
  });
  it("accepts the 8/64 length bounds inclusive", () => {
    expect(isValidClientKey("a".repeat(CLIENT_KEY_MIN))).toBe(true);
    expect(isValidClientKey("a".repeat(CLIENT_KEY_MAX))).toBe(true);
  });
  it("rejects too-short, too-long, and non-strings", () => {
    expect(isValidClientKey("a".repeat(CLIENT_KEY_MIN - 1))).toBe(false);
    expect(isValidClientKey("a".repeat(CLIENT_KEY_MAX + 1))).toBe(false);
    expect(isValidClientKey(42)).toBe(false);
    expect(isValidClientKey(null)).toBe(false);
    expect(isValidClientKey(undefined)).toBe(false);
  });
});
