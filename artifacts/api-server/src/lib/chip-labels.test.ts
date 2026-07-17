import { describe, it, expect } from "vitest";
import { chipLabel } from "./chip-labels";

describe("chipLabel", () => {
  it("returns the human label for a known chip key", () => {
    expect(chipLabel("small_steps")).toBe("Small steps");
    expect(chipLabel("body_double")).toBe("Someone with me");
  });

  it("falls back to underscore→space for unknown keys", () => {
    expect(chipLabel("some_new_chip")).toBe("some new chip");
  });
});
