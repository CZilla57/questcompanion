// Pure, framework-free helpers for push-notification state decisions.
// The React hook (use-notifications.ts) wires browser globals into these.

/**
 * Decide whether THIS browser should render as subscribed to push.
 *
 * Push subscriptions are per-browser/per-device: each browser holds its own
 * `PushSubscription`. The server's `/subscribed` flag counts EVERY device the
 * user has registered, so it is not authoritative for a single browser.
 *
 * Only the local subscription drives the bell. If the server-wide flag drove
 * it instead, a browser that never subscribed (e.g. desktop, after the user
 * subscribed on their phone) would render "on" and route clicks to
 * unsubscribe() — which silently no-ops because there is no local subscription
 * to remove, so the button appears dead.
 *
 * `serverHasAnySubscription` is accepted (and intentionally not used for the
 * result) to document that global state must not leak into per-device display.
 */
export function resolveDeviceSubscribed(input: {
  hasLocalSubscription: boolean;
  serverHasAnySubscription: boolean;
}): boolean {
  return input.hasLocalSubscription;
}
