import { describe, it, expect } from "vitest";
import {
  newCaptureId, localDateString, makeTextEntry, makeVoiceEntry,
  decideReplayFailure, entryLabel, EMPTY_TRANSCRIPT_MESSAGE,
} from "./core";

const NOW = new Date(2026, 6, 20, 23, 45); // Jul 20 2026, 23:45 local

describe("newCaptureId", () => {
  it("mints unique UUID-shaped ids", () => {
    const a = newCaptureId();
    const b = newCaptureId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("localDateString", () => {
  it("formats the device-local calendar date", () => {
    expect(localDateString(new Date(2026, 6, 20, 23, 45))).toBe("2026-07-20");
    expect(localDateString(new Date(2026, 0, 3, 0, 5))).toBe("2026-01-03");
  });
});

describe("makeTextEntry", () => {
  it("uses the input clientKey as the entry id (id IS the idempotency key)", () => {
    const e = makeTextEntry({ title: "Email Sam", dueDate: "2026-07-20", clientKey: "k".repeat(12) }, { now: NOW, tz: "America/Chicago" });
    expect(e.id).toBe("k".repeat(12));
    expect(e.status).toBe("queued");
    expect(e.attempts).toBe(0);
    expect(e.captureDate).toBe("2026-07-20");
    expect(e.tz).toBe("America/Chicago");
    expect(e.payload.kind).toBe("text");
  });
  it("defaults a missing dueDate to the capture day (never loses the day the thought happened)", () => {
    const e = makeTextEntry({ title: "x", clientKey: "k".repeat(12) }, { now: NOW });
    expect(e.payload.kind === "text" && e.payload.input.dueDate).toBe("2026-07-20");
  });
  it("keeps an explicit dueDate", () => {
    const e = makeTextEntry({ title: "x", dueDate: "2026-08-01", clientKey: "k".repeat(12) }, { now: NOW });
    expect(e.payload.kind === "text" && e.payload.input.dueDate).toBe("2026-08-01");
  });
});

describe("makeVoiceEntry", () => {
  it("preserves the blob (mime intact — iOS records mp4) and mints its own id", () => {
    const blob = new Blob(["x"], { type: "audio/mp4" });
    const e = makeVoiceEntry(blob, 42_000, { questlineId: 7, now: NOW });
    expect(e.payload.kind).toBe("voice");
    if (e.payload.kind === "voice") {
      expect(e.payload.blob.type).toBe("audio/mp4");
      expect(e.payload.durationMs).toBe(42_000);
      expect(e.payload.questlineId).toBe(7);
    }
    expect(e.id).toMatch(/^[0-9a-f]{8}-/);
    expect(e.captureDate).toBe("2026-07-20");
  });
});

describe("decideReplayFailure (the drain policy table)", () => {
  const withStatus = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
  it("network/timeout/unknown → stop (still offline; order preserved)", () => {
    expect(decideReplayFailure(new TypeError("Failed to fetch"))).toEqual({ action: "stop" });
    expect(decideReplayFailure(Object.assign(new Error("x"), { name: "AbortError" }))).toEqual({ action: "stop" });
    expect(decideReplayFailure(new Error("weird"))).toEqual({ action: "stop" });
  });
  it("401 → stop with authNeeded", () => {
    expect(decideReplayFailure(withStatus(401))).toEqual({ action: "stop", authNeeded: true });
  });
  it("429 and 5xx → stop (cooldown / sick server)", () => {
    expect(decideReplayFailure(withStatus(429))).toEqual({ action: "stop" });
    expect(decideReplayFailure(withStatus(500))).toEqual({ action: "stop" });
    expect(decideReplayFailure(withStatus(503))).toEqual({ action: "stop" });
  });
  it("422 → retry once without the questline (capture outranks grouping)", () => {
    expect(decideReplayFailure(withStatus(422))).toEqual({ action: "retry-without-questline" });
  });
  it("other 4xx → park visibly, drain continues", () => {
    expect(decideReplayFailure(withStatus(400))).toEqual({ action: "park", message: "Couldn't sync this one — retry or discard." });
    expect(decideReplayFailure(withStatus(404))).toEqual({ action: "park", message: "Couldn't sync this one — retry or discard." });
  });
});

describe("entryLabel", () => {
  it("text entries label with their title", () => {
    const e = makeTextEntry({ title: "Email Sam", clientKey: "k".repeat(12) }, { now: NOW });
    expect(entryLabel(e)).toBe("Email Sam");
  });
  it("voice entries label with duration m:ss", () => {
    const e = makeVoiceEntry(new Blob(["x"], { type: "audio/webm" }), 42_000, { now: NOW });
    expect(entryLabel(e)).toBe("Voice note · 0:42");
    const long = makeVoiceEntry(new Blob(["x"], { type: "audio/webm" }), 61_000, { now: NOW });
    expect(entryLabel(long)).toBe("Voice note · 1:01");
  });
});

describe("EMPTY_TRANSCRIPT_MESSAGE", () => {
  it("is the anti-shame copy verbatim", () => {
    expect(EMPTY_TRANSCRIPT_MESSAGE).toBe("Couldn't hear anything in this note");
  });
});
