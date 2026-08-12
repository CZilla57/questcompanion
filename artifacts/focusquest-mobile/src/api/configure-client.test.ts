import { describe, it, expect } from "vitest";
import { resolveApiUrl } from "./configure-client";

describe("resolveApiUrl", () => {
  it("returns the apiUrl from expo extra", () => {
    expect(resolveApiUrl({ apiUrl: "https://staging.example.com" })).toBe(
      "https://staging.example.com",
    );
  });

  it("throws when apiUrl is missing or blank", () => {
    expect(() => resolveApiUrl({ apiUrl: null })).toThrow(/EXPO_PUBLIC_API_URL/);
    expect(() => resolveApiUrl({})).toThrow(/EXPO_PUBLIC_API_URL/);
    expect(() => resolveApiUrl({ apiUrl: "  " })).toThrow(/EXPO_PUBLIC_API_URL/);
  });
});
