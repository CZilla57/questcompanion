import { describe, it, expect } from "vitest";
import { confirmPhraseOk, DELETE_PHRASE, exportFileName, exportStrategy } from "./account";

describe("confirmPhraseOk", () => {
  it("accepts the exact phrase", () => {
    expect(confirmPhraseOk("delete my account")).toBe(true);
  });
  it("forgives case and surrounding whitespace — the phrase is a speed bump, not a typing test", () => {
    expect(confirmPhraseOk("  Delete My Account ")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(confirmPhraseOk("")).toBe(false);
    expect(confirmPhraseOk("delete")).toBe(false);
    expect(confirmPhraseOk("delete my acount")).toBe(false);
  });
  it("exports the canonical phrase the server expects", () => {
    expect(DELETE_PHRASE).toBe("delete my account");
  });
});

describe("exportFileName", () => {
  it("stamps the local-agnostic ISO date", () => {
    expect(exportFileName(new Date(Date.UTC(2026, 6, 21, 15, 30)))).toBe("focusquest-export-2026-07-21.json");
  });
});

describe("exportStrategy", () => {
  // The standalone webview has no browser chrome: navigating (or blob-anchoring
  // on iOS) shows the raw JSON with no way back — the share sheet is the only
  // exit that can't trap. In a real browser tab the plain blob download wins.
  it("uses the share sheet in a standalone app that can share files", () => {
    expect(exportStrategy({ standalone: true, canShareFiles: true })).toBe("share");
  });
  it("falls back to blob download in standalone when file share is unsupported", () => {
    expect(exportStrategy({ standalone: true, canShareFiles: false })).toBe("download");
  });
  it("prefers the plain download in a browser tab even when share exists", () => {
    expect(exportStrategy({ standalone: false, canShareFiles: true })).toBe("download");
    expect(exportStrategy({ standalone: false, canShareFiles: false })).toBe("download");
  });
});
