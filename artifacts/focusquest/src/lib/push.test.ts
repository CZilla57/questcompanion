import { describe, it, expect } from "vitest";
import { resolveDeviceSubscribed } from "./push";

describe("resolveDeviceSubscribed", () => {
  // Regression guard for the "notification button does nothing on web" bug:
  // the user subscribed on mobile (so the server has a row and reports
  // subscribed:true for the user), but THIS browser never subscribed. The bell
  // must NOT render as subscribed, or clicking it routes to unsubscribe() and
  // silently no-ops because there is no local subscription to remove.
  it("is NOT subscribed when only another device (server) is subscribed", () => {
    expect(
      resolveDeviceSubscribed({ hasLocalSubscription: false, serverHasAnySubscription: true }),
    ).toBe(false);
  });

  it("is subscribed when THIS browser has a local subscription", () => {
    expect(
      resolveDeviceSubscribed({ hasLocalSubscription: true, serverHasAnySubscription: true }),
    ).toBe(true);
  });

  it("is subscribed from the local subscription even if the server lost the row", () => {
    expect(
      resolveDeviceSubscribed({ hasLocalSubscription: true, serverHasAnySubscription: false }),
    ).toBe(true);
  });

  it("is not subscribed when neither this browser nor the server has a subscription", () => {
    expect(
      resolveDeviceSubscribed({ hasLocalSubscription: false, serverHasAnySubscription: false }),
    ).toBe(false);
  });
});
