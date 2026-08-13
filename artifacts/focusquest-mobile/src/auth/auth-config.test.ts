import { describe, it, expect } from "vitest";
import { resolveAuthConfig } from "./auth-config";

describe("resolveAuthConfig", () => {
  it("returns issuer and clientId from expo extra", () => {
    expect(
      resolveAuthConfig({
        auth0Domain: "your-tenant.auth0.com",
        auth0ClientId: "abc123",
      }),
    ).toEqual({ issuer: "https://your-tenant.auth0.com", clientId: "abc123" });
  });

  it("strips a trailing slash on the domain", () => {
    expect(
      resolveAuthConfig({
        auth0Domain: "your-tenant.auth0.com/",
        auth0ClientId: "abc123",
      }),
    ).toEqual({ issuer: "https://your-tenant.auth0.com", clientId: "abc123" });
  });

  it("strips a leading https:// scheme on the domain", () => {
    expect(
      resolveAuthConfig({
        auth0Domain: "https://your-tenant.auth0.com",
        auth0ClientId: "abc123",
      }),
    ).toEqual({ issuer: "https://your-tenant.auth0.com", clientId: "abc123" });
  });

  it("strips both a leading scheme and a trailing slash", () => {
    expect(
      resolveAuthConfig({
        auth0Domain: "https://your-tenant.auth0.com/",
        auth0ClientId: "abc123",
      }),
    ).toEqual({ issuer: "https://your-tenant.auth0.com", clientId: "abc123" });
  });

  it("throws naming both env vars when auth0Domain is missing", () => {
    expect(() => resolveAuthConfig({ auth0ClientId: "abc123" })).toThrow(
      /EXPO_PUBLIC_AUTH0_DOMAIN/,
    );
    expect(() => resolveAuthConfig({ auth0ClientId: "abc123" })).toThrow(
      /EXPO_PUBLIC_AUTH0_CLIENT_ID/,
    );
  });

  it("throws naming both env vars when auth0ClientId is missing", () => {
    expect(() =>
      resolveAuthConfig({ auth0Domain: "your-tenant.auth0.com" }),
    ).toThrow(/EXPO_PUBLIC_AUTH0_DOMAIN/);
    expect(() =>
      resolveAuthConfig({ auth0Domain: "your-tenant.auth0.com" }),
    ).toThrow(/EXPO_PUBLIC_AUTH0_CLIENT_ID/);
  });

  it("throws when values are blank strings", () => {
    expect(() =>
      resolveAuthConfig({ auth0Domain: "  ", auth0ClientId: "abc123" }),
    ).toThrow(/EXPO_PUBLIC_AUTH0_DOMAIN/);
    expect(() =>
      resolveAuthConfig({ auth0Domain: "your-tenant.auth0.com", auth0ClientId: "  " }),
    ).toThrow(/EXPO_PUBLIC_AUTH0_CLIENT_ID/);
  });

  it("throws when extra is not an object", () => {
    expect(() => resolveAuthConfig(undefined)).toThrow(/EXPO_PUBLIC_AUTH0_DOMAIN/);
    expect(() => resolveAuthConfig(null)).toThrow(/EXPO_PUBLIC_AUTH0_DOMAIN/);
  });
});
