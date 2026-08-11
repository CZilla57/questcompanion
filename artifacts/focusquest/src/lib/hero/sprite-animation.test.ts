import { describe, it, expect } from "vitest";
import { FRAME_COUNT, IDLE_FPS, idleFrameIndex } from "./sprite-animation";

describe("idleFrameIndex", () => {
  it("starts at frame 0", () => {
    expect(idleFrameIndex(0)).toBe(0);
  });

  it("holds frame 0 for the full duration of one frame", () => {
    const msPerFrame = 1000 / IDLE_FPS;
    expect(idleFrameIndex(msPerFrame - 1)).toBe(0);
  });

  it("advances to frame 1 exactly one frame-duration in", () => {
    const msPerFrame = 1000 / IDLE_FPS;
    expect(idleFrameIndex(msPerFrame)).toBe(1);
  });

  it("wraps back to frame 0 after a full cycle", () => {
    const msPerFrame = 1000 / IDLE_FPS;
    expect(idleFrameIndex(msPerFrame * FRAME_COUNT)).toBe(0);
  });

  it("respects a custom fps", () => {
    expect(idleFrameIndex(500, 2)).toBe(1); // 2fps -> 500ms/frame
    expect(idleFrameIndex(999, 2)).toBe(1);
    expect(idleFrameIndex(1000, 2)).toBe(2); // 2fps -> 500ms/frame; floor(1000/500)=2, 2 % 9 = 2 (frameCount defaults to 9)
  });

  it("respects a custom frameCount", () => {
    expect(idleFrameIndex(1000 / IDLE_FPS * 3, IDLE_FPS, 3)).toBe(0); // wraps at 3 frames
  });

  it("never returns a negative or out-of-range index", () => {
    for (let ms = 0; ms < 5000; ms += 37) {
      const idx = idleFrameIndex(ms);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(FRAME_COUNT);
    }
  });
});
