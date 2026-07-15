import { describe, it, expect } from "vitest";
import { difficultyControlState } from "./difficulty-controls";

describe("difficultyControlState", () => {
  it("medium: both directions open", () => {
    expect(difficultyControlState({ difficulty: "medium" })).toEqual({
      canEasier: true,
      canHarder: true,
    });
  });

  it("easy: floor reached, can't go easier", () => {
    expect(difficultyControlState({ difficulty: "easy" })).toEqual({
      canEasier: false,
      canHarder: true,
    });
  });

  it("hard: ceiling reached, can't go harder", () => {
    expect(difficultyControlState({ difficulty: "hard" })).toEqual({
      canEasier: true,
      canHarder: false,
    });
  });
});
