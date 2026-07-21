import { describe, it, expect } from "vitest";
import { confirmPhraseOk, DELETE_PHRASE } from "./account";

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
