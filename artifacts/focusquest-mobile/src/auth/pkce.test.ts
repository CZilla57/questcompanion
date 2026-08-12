import { describe, it, expect } from "vitest";
import { base64UrlEncode, deriveChallenge, randomString } from "./pkce";

describe("base64UrlEncode", () => {
  it("encodes bytes URL-safely with no padding", () => {
    // 0xFB 0xFF -> standard base64 '+/8=' -> url-safe '-_8'
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });
});

describe("deriveChallenge", () => {
  it("base64url-encodes the sha256 of the verifier", async () => {
    // Fake digest: return a fixed 2-byte array regardless of input.
    const fakeSha = async (_: string) => new Uint8Array([0xfb, 0xff]);
    expect(await deriveChallenge("verifier", fakeSha)).toBe("-_8");
  });
});

describe("randomString", () => {
  it("base64url-encodes supplied random bytes", () => {
    expect(randomString(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });
});
