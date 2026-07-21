const BUILD = { hash: "dev", assets: [] }; // replaced at build time by scripts/inject-sw-precache.mjs

const SHELL_CACHE = `fq-shell-${BUILD.hash}`;
const FONT_CACHE = "fq-fonts-v1";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  if (BUILD.hash !== "dev") {
    event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(BUILD.assets)));
  }
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("fq-shell-") && n !== SHELL_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Never intercept mutations — the outbox is app-layer (spec §Part 3).
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API is network-only, always — including /api/login navigations.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  // Fonts: cache-first into a small persistent cache so type survives offline.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(FONT_CACHE, request));
    return;
  }

  // Everything below needs a real build (dev worker is inert) + same origin.
  if (BUILD.hash === "dev" || url.origin !== self.location.origin) return;

  // Navigations: network-first so deploys land immediately; cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html", { cacheName: SHELL_CACHE })));
    return;
  }

  // Precached shell files (hashed → immutable): cache-first.
  if (BUILD.assets.includes(url.pathname)) {
    event.respondWith(cacheFirst(SHELL_CACHE, request));
  }
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
