import { describe, it, expect } from "vitest";
import { BrainMode } from "@workspace/api-client-react";
import { MODE_META, promptDismissedToday, dismissPromptToday } from "./brain-mode-meta";

describe("MODE_META", () => {
  it("covers every generated BrainMode value (guards enum drift)", () => {
    for (const mode of Object.values(BrainMode)) {
      expect(MODE_META[mode], `missing meta for ${mode}`).toBeDefined();
      expect(MODE_META[mode].label.length).toBeGreaterThan(0);
      expect(MODE_META[mode].prompt.length).toBeGreaterThan(0);
    }
  });

  it("neutral has no board flavor line", () => {
    expect(MODE_META[BrainMode.neutral].flavor).toBeNull();
  });
});

describe("daily prompt dismissal", () => {
  function fakeStorage(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      get length() { return m.size; },
    } as Storage;
  }

  it("is per local day", () => {
    const s = fakeStorage();
    expect(promptDismissedToday("2026-07-14", s)).toBe(false);
    dismissPromptToday("2026-07-14", s);
    expect(promptDismissedToday("2026-07-14", s)).toBe(true);
    expect(promptDismissedToday("2026-07-15", s)).toBe(false); // new day, fresh ask
  });
});
