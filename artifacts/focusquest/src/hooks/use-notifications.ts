import { useState, useEffect, useCallback } from "react";

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

    // Check server subscription status
    fetch(SUBSCRIBED_URL)
      .then((r) => r.json())
      .then((data: { subscribed: boolean }) => setIsSubscribed(data.subscribed))
      .catch(() => {});
  }, [supported]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;

    try {
      const permission = await Notification.requestPermission();
      setState(permission as NotificationState);
      if (permission !== "granted") return false;

      // Register service worker
      const reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
      await navigator.serviceWorker.ready;

      // Get VAPID public key from server
      const keyRes = await fetch(VAPID_KEY_URL);
      const { publicKey } = (await keyRes.json()) as { publicKey: string };
      if (!publicKey) return false;

      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

      // Save subscription to server
      await fetch(SUBSCRIBE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        }),
      });

      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error("Push subscription failed:", err);
      return false;
    }
  }, [supported]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
      if (!reg) return false;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return false;

      const endpoint = sub.endpoint;
      await sub.unsubscribe();

      await fetch(SUBSCRIBE_URL, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });

      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.error("Unsubscribe failed:", err);
      return false;
    }
  }, [supported]);

  return { state, isSubscribed, supported, subscribe, unsubscribe };
}
