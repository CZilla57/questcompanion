import { describe, it, expect, vi } from "vitest";
import { detectIsIOS, detectIsStandalone, runInstallPrompt } from "./pwa";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

describe("detectIsIOS", () => {
  it("is true for iPhone", () => expect(detectIsIOS(IPHONE)).toBe(true));
  it("is true for iPadOS reporting as Macintosh with touch", () =>
    expect(detectIsIOS(IPADOS, 5)).toBe(true));
  it("is false for desktop Safari/Chrome without touch", () =>
    expect(detectIsIOS(DESKTOP, 0)).toBe(false));
  it("is false for Android", () => expect(detectIsIOS(ANDROID, 5)).toBe(false));
});

describe("detectIsStandalone", () => {
  it("is true when display-mode:standalone matches", () =>
    expect(detectIsStandalone(true, undefined)).toBe(true));
  it("is true for iOS navigator.standalone", () =>
    expect(detectIsStandalone(false, true)).toBe(true));
  it("is false in a normal browser tab", () =>
    expect(detectIsStandalone(false, false)).toBe(false));
});

describe("runInstallPrompt", () => {
  it("returns 'unavailable' with no event", async () =>
    expect(await runInstallPrompt(null)).toBe("unavailable"));

  it("calls prompt() and returns the accepted outcome", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) };
    expect(await runInstallPrompt(event)).toBe("accepted");
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("propagates a dismissed outcome", async () => {
    const event = {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    };
    expect(await runInstallPrompt(event)).toBe("dismissed");
  });
});
