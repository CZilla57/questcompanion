self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "FocusQuest", body: event.data.text(), icon: "/favicon.svg" };
  }

  const options = {
    body: payload.body ?? "",
    icon: payload.icon ?? "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.tag ?? "focusquest",
    renotify: true,
    data: payload.data ?? {},
    actions: payload.actions ?? [],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "FocusQuest", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
        if (url !== "/" && clients[0].navigate) {
          return clients[0].navigate(url);
        }
      } else {
        return self.clients.openWindow(url);
      }
    })
  );
});

self.addEventListener("fetch", () => {
  // No-op: present only so the app meets PWA installability criteria.
  // Intentionally does NOT call event.respondWith — every request goes to the
  // network. There is no offline caching in this version.
});
