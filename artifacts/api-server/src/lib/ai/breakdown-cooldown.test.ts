import { describe, it, expect } from "vitest";
import { createCooldown } from "./breakdown-cooldown";

describe("createCooldown", () => {
  it("allows the first call, denies within the interval, allows again after it", () => {
    const cd = createCooldown(1000);
    expect(cd.tryAcquire(1, 0)).toBe(true);
    expect(cd.tryAcquire(1, 500)).toBe(false);
    expect(cd.tryAcquire(1, 1000)).toBe(true);
  });

  it("tracks users independently", () => {
    const cd = createCooldown(1000);
    expect(cd.tryAcquire(1, 0)).toBe(true);
    expect(cd.tryAcquire(2, 100)).toBe(true);
  });
});
