const BUILD = { hash: "dev", assets: [] }; // replaced at build time by scripts/inject-sw-precache.mjs

const SHELL_CACHE = `fq-shell-${BUILD.hash}`;
const FONT_CACHE = "fq-fonts-v1";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  if (BUILD.hash !== "dev") {
    // addAll is deliberately all-or-nothing: a partial shell is worse than
    // none (index.html referencing un-cached hashed assets). A failed install
    // retries on the next SW update check — the app stays network-only.
    event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(BUILD.assets)));
  }
  self.skipWaiting();
});

// NOTE: skipWaiting+claim hands an already-open old tab to this SW and deletes
// its old fq-shell-* cache. Safe today: the app is a single bundle (no lazy
// chunks) and navigations are network-first, so a reload self-heals. Revisit
// before adopting route-based code-splitting.
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
  // Only cache full, successful bodies: a 206 partial (Safari range requests)
  // makes Cache.put throw, and error responses shouldn't be pinned. The whole
  // write is fire-and-forget — caches.open included, so a storage failure
  // (quota, teardown) can never reject respondWith after a successful fetch.
  // Clone synchronously, before the page starts consuming the body.
  if (response.status === 200 || response.type === "opaque") {
    const copy = response.clone();
    caches.open(cacheName).then((cache) => cache.put(request, copy)).catch(() => {});
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
    event.respondWith(
      fetch(request).catch(async () => {
        const shell = await caches.match("/index.html", { cacheName: SHELL_CACHE });
        // A missing shell (storage evicted) must still resolve to a real
        // Response — respondWith(undefined) is a hard browser error page.
        return (
          shell ??
          new Response("You're offline and the app isn't cached yet. Reconnect and reload.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
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
