import { describe, it, expect } from "vitest";
import { resolveHashtag } from "./categories";

describe("resolveHashtag", () => {
  it("maps a known synonym to its canonical slug", () => {
    expect(resolveHashtag("work")).toBe("deep_work");
    expect(resolveHashtag("chore")).toBe("household");
    expect(resolveHashtag("gym")).toBe("health");
  });

  it("is case-insensitive", () => {
    expect(resolveHashtag("Work")).toBe("deep_work");
  });

  it("maps a canonical slug to itself", () => {
    expect(resolveHashtag("finance")).toBe("finance");
    expect(resolveHashtag("deep_work")).toBe("deep_work");
  });

  it("returns undefined for an unknown word", () => {
    expect(resolveHashtag("banana")).toBeUndefined();
  });
});
