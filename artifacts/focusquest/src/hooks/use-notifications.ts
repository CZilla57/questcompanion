import { useState, useEffect, useCallback } from "react";
import {
  resolveDeviceSubscribed,
  type SubscribeOutcome,
  type UnsubscribeOutcome,
} from "@/lib/push";

const SW_PATH = "/sw.js";
const SUBSCRIBE_URL = "/api/notifications/subscribe";
const VAPID_KEY_URL = "/api/notifications/vapid-key";
const SUBSCRIBED_URL = "/api/notifications/subscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

export type NotificationState = "unsupported" | "denied" | "granted" | "default" | "loading";

export function useNotifications() {
  const [state, setState] = useState<NotificationState>("loading");
  const [isSubscribed, setIsSubscribed] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  useEffect(() => {
    if (!supported) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission as NotificationState);

    let cancelled = false;
    void (async () => {
      // Authoritative for THIS browser: does a local push subscription exist?
      // register() is idempotent and returns the existing registration, so this
      // is safe alongside the on-load registration in main.tsx.
      let hasLocalSubscription = false;
      try {
        const reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
        hasLocalSubscription = (await reg.pushManager.getSubscription()) != null;
      } catch {
        hasLocalSubscription = false;
      }

      // Per-user flag from the server — may reflect OTHER devices (e.g. the
      // user's phone), so it must NOT drive this browser's bell. Kept for
      // context/future sync; resolveDeviceSubscribed deliberately ignores it.
      let serverHasAnySubscription = false;
      try {
        const res = await fetch(SUBSCRIBED_URL);
        const data = (await res.json()) as { subscribed: boolean };
        serverHasAnySubscription = data.subscribed;
      } catch {
        // ignore — treat as no server subscription
      }

      if (!cancelled) {
        setIsSubscribed(
          resolveDeviceSubscribed({ hasLocalSubscription, serverHasAnySubscription }),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supported]);

  const subscribe = useCallback(async (): Promise<SubscribeOutcome> => {
    if (!supported) return "unsupported";

    try {
      const permission = await Notification.requestPermission();
      setState(permission as NotificationState);
      if (permission === "denied") return "denied";
      if (permission !== "granted") return "dismissed"; // "default": prompt closed

      // Register service worker
      const reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
      await navigator.serviceWorker.ready;

      // Get VAPID public key from server
      const keyRes = await fetch(VAPID_KEY_URL);
      const { publicKey } = (await keyRes.json()) as { publicKey: string };
      if (!publicKey) return "error";

      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        await sub.unsubscribe().catch(() => {});
        return "error";
      }

      // Save subscription to the server. If that fails (e.g. auth expired), roll
      // back the local subscription so the bell doesn't show "on" for a device
      // the server has no record of and therefore can't deliver to.
      let saved = false;
      try {
        const saveRes = await fetch(SUBSCRIBE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          }),
        });
        saved = saveRes.ok;
      } catch {
        saved = false;
      }

      if (!saved) {
        await sub.unsubscribe().catch(() => {});
        return "error";
      }

      setIsSubscribed(true);
      return "subscribed";
    } catch (err) {
      console.error("Push subscription failed:", err);
      return "error";
    }
  }, [supported]);

  const unsubscribe = useCallback(async (): Promise<UnsubscribeOutcome> => {
    if (!supported) return "unsupported";
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!sub) {
        // Nothing to remove on this browser — reconcile the bell to "off".
        setIsSubscribed(false);
        return "not-subscribed";
      }

      const endpoint = sub.endpoint;
      await sub.unsubscribe();

      await fetch(SUBSCRIBE_URL, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });

      setIsSubscribed(false);
      return "unsubscribed";
    } catch (err) {
      console.error("Unsubscribe failed:", err);
      return "error";
    }
  }, [supported]);

  return { state, isSubscribed, supported, subscribe, unsubscribe };
}
