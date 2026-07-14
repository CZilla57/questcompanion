import { describe, it, expect } from "vitest";
import {
  pickRecordingMimeType,
  isTooShortToTranscribe,
  formatElapsed,
  MAX_RECORDING_MS,
  MIN_RECORDING_MS,
} from "./voice-recording";

describe("pickRecordingMimeType", () => {
  it("prefers webm/opus when supported (Chrome/Firefox)", () => {
    expect(pickRecordingMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to audio/mp4 when webm is unsupported (iOS Safari)", () => {
    expect(pickRecordingMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
  });

  it("returns undefined when nothing matches, letting MediaRecorder use its default", () => {
    expect(pickRecordingMimeType(() => false)).toBeUndefined();
  });

  it("treats a throwing probe as unsupported", () => {
    expect(pickRecordingMimeType(() => { throw new Error("boom"); })).toBeUndefined();
  });
});

describe("isTooShortToTranscribe", () => {
  it("rejects sub-500ms accidental taps", () => {
    expect(isTooShortToTranscribe(0)).toBe(true);
    expect(isTooShortToTranscribe(MIN_RECORDING_MS - 1)).toBe(true);
  });

  it("accepts clips at or above the minimum", () => {
    expect(isTooShortToTranscribe(MIN_RECORDING_MS)).toBe(false);
    expect(isTooShortToTranscribe(MAX_RECORDING_MS)).toBe(false);
  });
});

describe("formatElapsed", () => {
  it("formats sub-minute times as 0:SS", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(59_999)).toBe("0:59");
  });

  it("rolls over to minutes", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
  });
});
