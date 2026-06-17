import webPush from "web-push";
import { logger } from "./logger";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@focusquest.app";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

/**
 * Allowlisted push-service hostname suffixes.
 * Only endpoints hosted at these origins are accepted; anything else is
 * rejected at subscription time and skipped at delivery time to prevent
 * the server from being used as an outbound-request primitive against
 * attacker-controlled infrastructure.
 */
const ALLOWED_PUSH_HOSTS: readonly string[] = [
  "fcm.googleapis.com",            // Chrome / Chromium
  "push.services.mozilla.com",     // Firefox
  "updates.push.services.mozilla.com",
  "notify.windows.com",            // Edge / Windows
  "push.apple.com",                // Safari
  "web.push.apple.com",
];

function hostIsAllowed(hostname: string): boolean {
  return ALLOWED_PUSH_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith("." + allowed),
  );
}

/**
 * Returns true when the supplied string is a well-formed HTTPS URL whose
 * hostname belongs to a known Web Push delivery service.  Rejects anything
 * that could steer server-side notification delivery to attacker-chosen
 * infrastructure.
 */
export function isValidPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return hostIsAllowed(url.hostname);
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  icon?: string;
  data?: Record<string, unknown>;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendPushNotification(
  subscription: PushSubscriptionKeys,
  payload: PushPayload,
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    logger.warn("VAPID keys not configured — skipping push notification");
    return false;
  }

  if (!isValidPushEndpoint(subscription.endpoint)) {
    logger.warn({ endpoint: subscription.endpoint }, "Refusing to deliver to non-allowlisted push endpoint");
    return false;
  }

  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return true;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 410 || status === 404) {
      // Subscription expired — caller should delete it
      return false;
    }
    logger.error({ err }, "Failed to send push notification");
    return false;
  }
}

export const vapidPublicKey = VAPID_PUBLIC_KEY;
