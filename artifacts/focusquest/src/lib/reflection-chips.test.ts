import { describe, it, expect } from "vitest";
import { HELPED_CHIPS, HINDERED_CHIPS, CHIP_LABELS } from "./reflection-chips";

describe("reflection chips", () => {
  it("groups don't overlap and every chip has a label", () => {
    const overlap = HELPED_CHIPS.filter((c) => (HINDERED_CHIPS as string[]).includes(c));
    expect(overlap).toEqual([]);
    for (const c of [...HELPED_CHIPS, ...HINDERED_CHIPS]) {
      expect(CHIP_LABELS[c]).toBeTruthy();
    }
  });
});
