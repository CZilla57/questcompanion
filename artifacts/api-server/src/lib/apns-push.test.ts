import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import {
  buildApnsRequests,
  deadTokensFromApnsReceipts,
  sendApnsPush,
  apnsConfigFromEnv,
  buildProviderJwt,
  apnsHost,
} from "./apns-push";

const payload = { title: "T", body: "B", data: { target: { screen: "focus" } } };

describe("buildApnsRequests", () => {
  it("maps each token to an APNs request with aps alert + data merged", () => {
    const [req] = buildApnsRequests(["TOKA"], payload, "app.focusquest");
    expect(req.token).toBe("TOKA");
    expect(req.headers["apns-topic"]).toBe("app.focusquest");
    expect(req.headers["apns-push-type"]).toBe("alert");
    expect(JSON.parse(req.body)).toEqual({
      aps: { alert: { title: "T", body: "B" }, sound: "default" },
      target: { screen: "focus" },
    });
  });

  it("returns an empty array for no tokens", () => {
    expect(buildApnsRequests([], payload, "app.focusquest")).toEqual([]);
  });
});

describe("deadTokensFromApnsReceipts", () => {
  it("returns tokens whose receipt is a permanent unregistered/bad-token error", () => {
    const receipts = [
      { status: "ok" as const },
      { status: "error" as const, reason: "Unregistered" },
      { status: "error" as const, reason: "BadDeviceToken" },
      { status: "error" as const, reason: "TooManyRequests" },
    ];
    expect(deadTokensFromApnsReceipts(["A", "B", "C", "D"], receipts)).toEqual(["B", "C"]);
  });
});

describe("sendApnsPush", () => {
  it("returns [] without calling transport when there are no requests", async () => {
    let called = false;
    const t = async () => { called = true; return []; };
    expect(await sendApnsPush([], t)).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("apnsConfigFromEnv", () => {
  it("returns null when a required var is missing", () => {
    expect(apnsConfigFromEnv({ APNS_KEY_ID: "K" } as NodeJS.ProcessEnv)).toBeNull();
  });
  it("builds a config when all vars present", () => {
    const cfg = apnsConfigFromEnv({
      APNS_AUTH_KEY: "KEY", APNS_KEY_ID: "K1", APNS_TEAM_ID: "T1",
      APNS_BUNDLE_ID: "app.fq", APNS_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({
      authKey: "KEY", keyId: "K1", teamId: "T1", bundleId: "app.fq", environment: "production",
    });
  });
});

describe("apnsHost", () => {
  it("selects sandbox vs production", () => {
    expect(apnsHost("sandbox")).toBe("api.sandbox.push.apple.com");
    expect(apnsHost("production")).toBe("api.push.apple.com");
  });
});

describe("buildProviderJwt", () => {
  it("signs an ES256 token with kid header and teamId issuer", () => {
    // Generate an EC key at test time so no secret is committed.
    const { generateKeyPairSync } = require("node:crypto");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const cfg = { authKey: pem, keyId: "KID9", teamId: "TEAM7", bundleId: "app.fq", environment: "sandbox" as const };
    const token = buildProviderJwt(cfg, 1_700_000_000);
    const decoded = jwt.decode(token, { complete: true }) as any;
    expect(decoded.header.alg).toBe("ES256");
    expect(decoded.header.kid).toBe("KID9");
    expect(decoded.payload.iss).toBe("TEAM7");
    expect(decoded.payload.iat).toBe(1_700_000_000);
  });
});
