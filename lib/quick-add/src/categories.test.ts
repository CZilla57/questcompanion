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

  it("resolves the new category slugs", () => {
    expect(resolveHashtag("self_care")).toBe("self_care");
    expect(resolveHashtag("errands")).toBe("errands");
    expect(resolveHashtag("travel")).toBe("travel");
  });

  it("resolves aliases for the new categories", () => {
    expect(resolveHashtag("selfcare")).toBe("self_care");
    expect(resolveHashtag("meditate")).toBe("self_care");
    expect(resolveHashtag("groceries")).toBe("errands");
    expect(resolveHashtag("shopping")).toBe("errands");
    expect(resolveHashtag("trip")).toBe("travel");
    expect(resolveHashtag("vacation")).toBe("travel");
  });

  it("resolves newly added aliases for existing categories", () => {
    expect(resolveHashtag("email")).toBe("admin");
    expect(resolveHashtag("code")).toBe("deep_work");
    expect(resolveHashtag("clean")).toBe("household");
  });

  it("returns undefined for an unknown word", () => {
    expect(resolveHashtag("banana")).toBeUndefined();
  });
});
