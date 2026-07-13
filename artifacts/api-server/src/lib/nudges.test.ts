import { describe, it, expect } from "vitest";
import {
  isValidKind, isValidReaction, reactionLabel, reactionsFor, canSendNudge,
} from "./nudges";

describe("nudge kinds", () => {
  it("accepts poke and cheer", () => {
    expect(isValidKind("poke")).toBe(true);
    expect(isValidKind("cheer")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isValidKind("shove")).toBe(false);
    expect(isValidKind("")).toBe(false);
  });
});

describe("reaction validation", () => {
  it("accepts a known key for the right kind", () => {
    expect(isValidReaction("poke", "get_moving")).toBe(true);
    expect(isValidReaction("cheer", "crushing_it")).toBe(true);
  });
  it("rejects a key from the other kind", () => {
    expect(isValidReaction("poke", "crushing_it")).toBe(false);
    expect(isValidReaction("cheer", "get_moving")).toBe(false);
  });
  it("rejects an unknown key", () => {
    expect(isValidReaction("poke", "nope")).toBe(false);
  });
  it("resolves labels and returns null for unknown", () => {
    expect(reactionLabel("poke", "get_moving")).toMatch(/get moving/i);
    expect(reactionLabel("poke", "nope")).toBeNull();
  });
  it("lists four reactions per kind", () => {
    expect(reactionsFor("poke")).toHaveLength(4);
    expect(reactionsFor("cheer")).toHaveLength(4);
  });
});

describe("rate limit", () => {
  it("allows the first nudge of a kind today", () => {
    expect(canSendNudge(0)).toBe(true);
  });
  it("blocks a second nudge of the same kind today", () => {
    expect(canSendNudge(1)).toBe(false);
    expect(canSendNudge(3)).toBe(false);
  });
});
