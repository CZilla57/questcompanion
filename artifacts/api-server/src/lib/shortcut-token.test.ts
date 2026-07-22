import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  TOKEN_PREFIX, mintTokenSecret, hashTokenSecret, isShortcutToken,
  isShortcutRouteAllowed, evaluateShortcutAuth, LAST_USED_THROTTLE_MS,
} from "./shortcut-token";

describe("mintTokenSecret", () => {
  it("mints fqs_-prefixed 47-char base64url tokens with a matching sha256 hash", () => {
    const { token, tokenHash } = mintTokenSecret();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token).toHaveLength(4 + 43); // "fqs_" + base64url(32 bytes)
    expect(token.slice(4)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("never mints the same token twice", () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintTokenSecret().token));
    expect(seen.size).toBe(50);
  });
});

describe("hashTokenSecret", () => {
  it("is deterministic sha256 hex", () => {
    expect(hashTokenSecret("fqs_abc")).toBe(hashTokenSecret("fqs_abc"));
    expect(hashTokenSecret("fqs_abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTokenSecret("fqs_abc")).not.toBe(hashTokenSecret("fqs_abd"));
  });
});

describe("isShortcutToken", () => {
  it("recognizes the prefix and nothing else", () => {
    expect(isShortcutToken("fqs_xyz")).toBe(true);
    expect(isShortcutToken("sess-abc123")).toBe(false);
    expect(isShortcutToken("")).toBe(false);
  });
});

describe("isShortcutRouteAllowed (D4 default-deny)", () => {
  it.each([
    ["POST", "/api/shortcuts/capture"],
    ["GET", "/api/shortcuts/today"],
    ["POST", "/api/tasks/7/complete"],
    ["POST", "/api/tasks/12345/complete"],
  ])("allows %s %s", (method, path) => {
    expect(isShortcutRouteAllowed(method, path)).toBe(true);
  });

  it.each([
    ["GET", "/api/shortcuts/capture"],        // method mismatch
    ["POST", "/api/shortcuts/today"],         // method mismatch
    ["POST", "/api/tasks/7/uncomplete"],      // adjacent route
    ["POST", "/api/tasks/abc/complete"],      // non-numeric id
    ["POST", "/api/tasks/7/complete/extra"],  // suffix
    ["POST", "/api/shortcut-tokens"],         // mint must NEVER token-auth
    ["GET", "/api/shortcut-tokens"],
    ["DELETE", "/api/shortcut-tokens/1"],
    ["GET", "/api/me/export"],
    ["DELETE", "/api/me"],
    ["GET", "/api/tasks"],
    ["POST", "/api/tasks"],
  ])("denies %s %s", (method, path) => {
    expect(isShortcutRouteAllowed(method, path)).toBe(false);
  });
});

describe("evaluateShortcutAuth", () => {
  const now = new Date("2026-07-21T12:00:00Z");
  const activeRow = { revokedAt: null, lastUsedAt: null };
  const onCapture = { bearer: "fqs_x", method: "POST", path: "/api/shortcuts/capture" };

  it("passes through non-shortcut bearers untouched", () => {
    expect(evaluateShortcutAuth({ bearer: "sess-1", method: "POST", path: "/api/shortcuts/capture", tokenRow: undefined, now }))
      .toEqual({ kind: "not-a-shortcut-token" });
  });

  it("denies off-whitelist routes even with a valid token", () => {
    expect(evaluateShortcutAuth({ bearer: "fqs_x", method: "DELETE", path: "/api/me", tokenRow: activeRow, now }))
      .toEqual({ kind: "deny" });
  });

  it("denies unknown tokens", () => {
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: undefined, now })).toEqual({ kind: "deny" });
  });

  it("denies revoked tokens", () => {
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: { revokedAt: new Date("2026-07-20T00:00:00Z"), lastUsedAt: null }, now }))
      .toEqual({ kind: "deny" });
  });

  it("allows an active token on a whitelisted route, refreshing last-used when never used", () => {
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: activeRow, now }))
      .toEqual({ kind: "allow", refreshLastUsed: true });
  });

  it("throttles the last-used refresh to once an hour", () => {
    const recent = { revokedAt: null, lastUsedAt: new Date(now.getTime() - 5 * 60_000) };
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: recent, now }))
      .toEqual({ kind: "allow", refreshLastUsed: false });
    const stale = { revokedAt: null, lastUsedAt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) };
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: stale, now }))
      .toEqual({ kind: "allow", refreshLastUsed: true });
  });
});
