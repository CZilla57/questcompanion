import { describe, it, expect } from "vitest";
import { resolveDeviceSubscribed, subscribeToast, unsubscribeToast } from "./push";

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

describe("subscribeToast", () => {
  // Every outcome must produce user feedback except the impossible "unsupported"
  // case (the bell isn't rendered when push is unsupported).
  it("confirms success", () => {
    const t = subscribeToast("subscribed");
    expect(t?.title).toBe("Notifications enabled");
    expect(t?.variant).toBeUndefined();
  });

  it("warns when the browser blocked notifications", () => {
    const t = subscribeToast("denied");
    expect(t?.variant).toBe("destructive");
    expect(t?.description).toMatch(/browser settings/i);
  });

  // Regression guard: dismissing the permission prompt previously produced NO
  // toast (the "blocked" branch read a stale `state` and never fired), so the
  // button looked dead. It must now give feedback.
  it("gives feedback when the permission prompt is dismissed", () => {
    const t = subscribeToast("dismissed");
    expect(t).not.toBeNull();
    expect(t?.title).toBeTruthy();
    expect(t?.variant).toBeUndefined();
  });

  it("reports an error", () => {
    const t = subscribeToast("error");
    expect(t?.variant).toBe("destructive");
  });

  it("stays silent only when push is unsupported", () => {
    expect(subscribeToast("unsupported")).toBeNull();
  });
});

describe("unsubscribeToast", () => {
  it("confirms disable", () => {
    expect(unsubscribeToast("unsubscribed")?.title).toBe("Notifications disabled");
  });

  // Regression guard for the original silent no-op: clicking a bell that had no
  // local subscription returned false and showed nothing.
  it("gives feedback when there was nothing to unsubscribe", () => {
    const t = unsubscribeToast("not-subscribed");
    expect(t).not.toBeNull();
    expect(t?.title).toBeTruthy();
  });

  it("reports an error", () => {
    const t = unsubscribeToast("error");
    expect(t?.variant).toBe("destructive");
  });

  it("stays silent only when push is unsupported", () => {
    expect(unsubscribeToast("unsupported")).toBeNull();
  });
});
