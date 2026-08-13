import { describe, it, expect } from "vitest";
import { nextNav } from "./nav-decision";

describe("nextNav", () => {
  it("never navigates while auth is loading", () => {
    expect(nextNav("loading", "/focus")).toBeNull();
    expect(nextNav("loading", null)).toBeNull();
  });

  it("navigates to the normalized route when authed with a pending url", () => {
    expect(nextNav("authed", "/focus")).toBe("/focus");
    expect(nextNav("authed", "/reflection")).toBe("/reflection");
    expect(nextNav("authed", "/unknown")).toBe("/"); // normalized fallback
  });

  it("does nothing when authed with no pending url", () => {
    expect(nextNav("authed", null)).toBeNull();
  });

  it("holds (does not navigate) while anon with a pending url", () => {
    expect(nextNav("anon", "/focus")).toBeNull();
  });

  it("replays the held destination once anon becomes authed", () => {
    // pendingUrl survives the anon pass...
    expect(nextNav("anon", "/reflection")).toBeNull();
    // ...and fires on the authed pass.
    expect(nextNav("authed", "/reflection")).toBe("/reflection");
  });
});
