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

/** Result of attempting to subscribe THIS browser to push. */
export type SubscribeOutcome =
  | "subscribed" // fully subscribed and saved to the server
  | "denied" // user (or browser settings) blocked notifications
  | "dismissed" // permission prompt closed without a choice
  | "error" // an unexpected failure (network, VAPID key, push service)
  | "unsupported"; // push isn't available in this browser

/** Result of attempting to unsubscribe THIS browser from push. */
export type UnsubscribeOutcome =
  | "unsubscribed" // local subscription removed and server notified
  | "not-subscribed" // this browser had no local subscription to remove
  | "error" // an unexpected failure
  | "unsupported";

/** Toast payload shape (a subset of the app's toast props — plain data, no UI deps). */
export interface NotificationToast {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
  className?: string;
}

/**
 * Map a subscribe attempt to user feedback. Returns null only for "unsupported"
 * (the bell isn't rendered then); every other outcome yields a toast so the
 * button never silently does nothing.
 */
export function subscribeToast(outcome: SubscribeOutcome): NotificationToast | null {
  switch (outcome) {
    case "subscribed":
      return {
        title: "Notifications enabled",
        description: "You'll be reminded about due tasks and streaks.",
        className: "border-primary",
      };
    case "denied":
      return {
        title: "Notifications blocked",
        description: "Enable notifications in your browser settings.",
        variant: "destructive",
      };
    case "dismissed":
      return {
        title: "Notifications not enabled",
        description: "Tap the bell anytime to turn them on.",
      };
    case "error":
      return {
        title: "Couldn't enable notifications",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      };
    case "unsupported":
      return null;
  }
}

/** Map an unsubscribe attempt to user feedback. Null only for "unsupported". */
export function unsubscribeToast(outcome: UnsubscribeOutcome): NotificationToast | null {
  switch (outcome) {
    case "unsubscribed":
      return { title: "Notifications disabled" };
    case "not-subscribed":
      return { title: "Notifications are already off" };
    case "error":
      return {
        title: "Couldn't disable notifications",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      };
    case "unsupported":
      return null;
  }
}
