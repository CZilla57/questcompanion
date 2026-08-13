import { describe, it, expect } from "vitest";
import { normalizeDeepLink } from "./url-routing";

describe("normalizeDeepLink", () => {
  it("keeps known routes", () => {
    expect(normalizeDeepLink("/focus")).toBe("/focus");
    expect(normalizeDeepLink("/reflection")).toBe("/reflection");
  });

  it("maps home and empty-ish inputs to /", () => {
    expect(normalizeDeepLink("/")).toBe("/");
    expect(normalizeDeepLink("")).toBe("/");
    expect(normalizeDeepLink("   ")).toBe("/");
    expect(normalizeDeepLink(undefined)).toBe("/");
    expect(normalizeDeepLink(null)).toBe("/");
  });

  it("strips query and hash before matching", () => {
    expect(normalizeDeepLink("/focus?src=push")).toBe("/focus");
    expect(normalizeDeepLink("/reflection#top")).toBe("/reflection");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDeepLink("  /focus  ")).toBe("/focus");
  });

  it("collapses unknown and web-only routes to /", () => {
    expect(normalizeDeepLink("/settings")).toBe("/");
    expect(normalizeDeepLink("/rewards")).toBe("/");
    expect(normalizeDeepLink("focus")).toBe("/"); // no leading slash
    expect(normalizeDeepLink("https://app.example.com/focus")).toBe("/");
  });
});
