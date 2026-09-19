import { describe, it, expect } from "vitest";
import { buildApnsRequests, deadTokensFromApnsReceipts, sendApnsPush } from "./apns-push";

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
