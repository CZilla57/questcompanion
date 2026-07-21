import { describe, it, expect } from "vitest";
import {
  readSessionRecord, writeSessionRecord, clearSessionRecord,
  authVerdict, onboardingVerdict, type SessionRecord,
} from "./offline-session";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  authed: true, onboardingComplete: true, savedAt: "2026-07-20T09:00:00Z", ...over,
});

describe("session record storage", () => {
  it("round-trips and merges patches", () => {
    const s = memoryStorage();
    writeSessionRecord({ authed: true }, s);
    writeSessionRecord({ onboardingComplete: true }, s);
    const got = readSessionRecord(s);
    expect(got?.authed).toBe(true);
    expect(got?.onboardingComplete).toBe(true);
    expect(typeof got?.savedAt).toBe("string");
  });
  it("returns null on empty or corrupt storage (never throws)", () => {
    const s = memoryStorage();
    expect(readSessionRecord(s)).toBeNull();
    s.setItem("fq.offline-session", "{not json");
    expect(readSessionRecord(s)).toBeNull();
  });
  it("clear removes the record", () => {
    const s = memoryStorage();
    writeSessionRecord({ authed: true }, s);
    clearSessionRecord(s);
    expect(readSessionRecord(s)).toBeNull();
  });
});

describe("authVerdict", () => {
  it("authenticated always wins", () => {
    expect(authVerdict({ isAuthenticated: true, failure: null, record: null })).toBe("in");
  });
  it("unreachable + cached authed → in (offline grace)", () => {
    expect(authVerdict({ isAuthenticated: false, failure: "unreachable", record: record() })).toBe("in");
  });
  it("unreachable with no record (fresh device) → out", () => {
    expect(authVerdict({ isAuthenticated: false, failure: "unreachable", record: null })).toBe("out");
  });
  it("an authoritative no → out even with a cached record", () => {
    expect(authVerdict({ isAuthenticated: false, failure: null, record: record() })).toBe("out");
  });
});

describe("onboardingVerdict", () => {
  it("positive server answers win: complete → app, incomplete → onboarding", () => {
    expect(onboardingVerdict({ stats: { onboardingComplete: true }, isPaused: false, error: null, record: null })).toBe("app");
    expect(onboardingVerdict({ stats: { onboardingComplete: false }, isPaused: false, error: null, record: record() })).toBe("onboarding");
  });
  it("paused offline + cached complete → app (grace)", () => {
    expect(onboardingVerdict({ stats: undefined, isPaused: true, error: null, record: record() })).toBe("app");
  });
  it("network error + cached complete → app; 5xx too (cold start)", () => {
    expect(onboardingVerdict({ stats: undefined, isPaused: false, error: new TypeError("fetch failed"), record: record() })).toBe("app");
    const err500 = Object.assign(new Error("HTTP 500"), { status: 500 });
    expect(onboardingVerdict({ stats: undefined, isPaused: false, error: err500, record: record() })).toBe("app");
  });
  it("no stats + no grace → loading, never the onboarding screen", () => {
    expect(onboardingVerdict({ stats: undefined, isPaused: true, error: null, record: null })).toBe("loading");
    expect(onboardingVerdict({ stats: undefined, isPaused: false, error: null, record: record() })).toBe("loading");
    const err401 = Object.assign(new Error("HTTP 401"), { status: 401 });
    expect(onboardingVerdict({ stats: undefined, isPaused: false, error: err401, record: record() })).toBe("loading");
  });
  it("cached record without onboardingComplete grants no grace", () => {
    expect(onboardingVerdict({ stats: undefined, isPaused: true, error: null, record: record({ onboardingComplete: false }) })).toBe("loading");
  });
});

describe("default-storage path is crash-safe (node has no localStorage — the exact class of env where referencing it fails)", () => {
  it("read returns null instead of throwing", () => {
    expect(readSessionRecord()).toBeNull();
  });
  it("write and clear are silent no-ops instead of throwing", () => {
    expect(() => writeSessionRecord({ authed: true })).not.toThrow();
    expect(() => clearSessionRecord()).not.toThrow();
  });
});
