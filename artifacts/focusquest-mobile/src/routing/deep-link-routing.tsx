import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "../auth/auth-context";
import { nextNav } from "./nav-decision";

function urlOf(response: Notifications.NotificationResponse | null | undefined): string | null {
  const url = response?.notification.request.content.data?.url;
  return typeof url === "string" && url.trim() !== "" ? url : null;
}

/**
 * Side-effect-only. Collects notification taps (live + cold start) into a single
 * pending url, then navigates once auth is settled — holding cold-start/anon taps
 * until session restore and login complete (see nextNav).
 */
export function DeepLinkRouter(): null {
  const { status } = useAuth();
  const router = useRouter();
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  // Collect taps: live responses + the cold-start launch response.
  useEffect(() => {
    let cancelled = false;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = urlOf(response);
      if (url) setPendingUrl(url);
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled) return;
      const url = urlOf(response);
      if (url) setPendingUrl(url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // Navigate when auth is settled; clear pending after a navigation fires.
  useEffect(() => {
    const route = nextNav(status, pendingUrl);
    if (route) {
      router.push(route);
      setPendingUrl(null);
    }
  }, [status, pendingUrl, router]);

  return null;
}
