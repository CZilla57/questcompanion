import { describe, it, expect } from "vitest";
import { eveningCardVisible } from "./reflection-window";

const at = (h: number) => new Date(2026, 6, 16, h, 30);

describe("eveningCardVisible", () => {
  it("shows from 17:00 local through midnight while unanswered", () => {
    expect(eveningCardVisible(at(16), false)).toBe(false);
    expect(eveningCardVisible(at(17), false)).toBe(true);
    expect(eveningCardVisible(at(23), false)).toBe(true);
    expect(eveningCardVisible(at(0), false)).toBe(false);
  });
  it("hides once answered", () => {
    expect(eveningCardVisible(at(20), true)).toBe(false);
  });
});
