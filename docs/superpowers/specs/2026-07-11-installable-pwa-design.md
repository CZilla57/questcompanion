# Installable PWA

## Overview

FocusQuest already ships **web push** (VAPID subscribe/unsubscribe, a push
service worker at `public/sw.js`, and a `NotificationBell` in the app chrome).
What it is *not* yet is **installable** — there is no web app manifest, no PNG
app icons, and the service worker is only registered lazily when a user opts
into notifications. This feature makes FocusQuest a real home-screen app on
Android/desktop (Chrome/Edge) and iOS (Safari), with a **custom in-app install
prompt**.

Scope for v1:

- A **web app manifest** + a full **PNG icon set** (including maskable + Apple
  touch icon), generated from user-supplied square art.
- **Register the service worker on app load** (not gated behind push), and add a
  **no-op `fetch` handler** so browsers consider the app installable — *without*
  adding any caching.
- A **`usePwaInstall` hook** wrapping `beforeinstallprompt` / `appinstalled` /
  standalone detection, plus the iOS (Safari) manual-install path.
- **Two install surfaces**: a dismissable **banner** for discovery and a small
  header/sidebar **button** as a persistent fallback.

Out of scope for v1 (noted at the end) — most importantly **no offline
support**. The app remains network-dependent; installing only gives it a home-
screen presence, standalone chrome, and its own icon. Push notifications are
unchanged.

## Installability criteria (what we must satisfy)

For Chrome/Edge to fire `beforeinstallprompt`:

1. Served over **HTTPS** — already true (Render + Cloudflare).
2. A **web app manifest** with `name`/`short_name`, `start_url`, a `display` of
   `standalone`/`fullscreen`/`minimal-ui`, and icons including **192px and
   512px** PNGs.
3. A **registered service worker** with a **`fetch` handler**.

iOS Safari ignores all of the above for its install affordance — it uses
`apple-touch-icon` + `apple-mobile-web-app-*` meta tags and a manual "Add to
Home Screen" from the Share sheet. So iOS needs the meta tags and a **manual
instructions** path in the UI (it never fires `beforeinstallprompt`).

## Web app manifest

New `artifacts/focusquest/public/manifest.webmanifest`, linked from
`index.html`. The static server already serves `public/` at the web root, so no
server change is needed.

```jsonc
{
  "name": "FocusQuest",
  "short_name": "FocusQuest",
  "description": "Gamified tasks and habits — complete quests, earn XP, build streaks.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#090b15", // = hsl(230 40% 6%), the app's --background (splash bg)
  "theme_color": "#090b15",      // dark address-bar/status-bar chrome
  "icons": [
    { "src": "/icons/icon-192.png",          "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png",          "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- `background_color`/`theme_color` are set to the **dark app chrome** (not the
  `#FF3C00` brand orange) so the standalone status bar and splash screen match
  the always-dark UI. `#090b15` is the app's `--background` token
  (`hsl(230 40% 6%)` in `src/index.css`).
- Separate `any` and `maskable` icon entries: Android adaptive icons crop to a
  circle/squircle, so the maskable variant carries extra safe-zone padding while
  the `any` variant is edge-to-edge.

## Icons

User supplies **one square PNG (≥512px, 1024 ideal, full-bleed background)**.
From it we generate into `artifacts/focusquest/public/icons/`:

| File                    | Size | Purpose |
|-------------------------|------|---------|
| `icon-192.png`          | 192  | manifest `any` |
| `icon-512.png`          | 512  | manifest `any` |
| `icon-512-maskable.png` | 512  | manifest `maskable` — source centered on a `#090b15` field at ~80% scale (≥10% safe zone each side) |
| `apple-touch-icon.png`  | 180  | iOS home screen (`<link rel="apple-touch-icon">`) |

Generation is a **one-off build step**, not runtime. Use `sharp` if available in
the workspace; otherwise fall back to a small Node script (the repo already uses
`pngjs` per the dev-commands memory) to resize and to composite the maskable
padding. The script lives under `scripts/` or as a throwaway; the committed
artifacts are the PNGs. The source art is committed alongside as
`public/icons/source.png` for future regeneration.

### `index.html` head additions

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#090b15" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="FocusQuest" />
```

The existing `viewport` meta already sets `width=device-width, initial-scale=1`.
Add `viewport-fit=cover` so the standalone display uses the full screen and the
existing `safe-bottom` padding on the mobile nav respects the home indicator.

## Service worker registration

Today `sw.js` is registered **only** inside `useNotifications.subscribe()`. For
installability the worker must be registered **on app load**.

- Add a tiny registration on startup in
  `artifacts/focusquest/src/main.tsx` (after mount, guarded by
  `"serviceWorker" in navigator`, ideally on `window load`):
  `navigator.serviceWorker.register("/sw.js", { scope: "/" })`.
- `useNotifications.subscribe()` keeps working: `register()` is idempotent, so
  calling it again returns the same registration; `subscribe()` can continue to
  call `register` (or switch to `navigator.serviceWorker.ready`). No behavior
  change to push.
- Add a **no-op `fetch` handler** to `sw.js`:

  ```js
  // Present only to satisfy PWA install criteria. Intentionally does NOT
  // call event.respondWith — every request falls through to the network.
  // No offline caching in this version.
  self.addEventListener("fetch", () => {});
  ```

  This is the deliberate line between "installable" and "offline": the handler
  exists so browsers count us installable, but it caches nothing.

## `usePwaInstall` hook

New `artifacts/focusquest/src/hooks/use-pwa-install.ts`. A single hook that owns
all install state so the banner and the button stay in sync.

Exposes:

- `canInstall: boolean` — a `beforeinstallprompt` event has been captured and the
  app is not already installed.
- `promptInstall(): Promise<"accepted" | "dismissed" | "unavailable">` — calls
  `prompt()` on the stored event, awaits `userChoice`, then clears the event
  (the browser only lets it be used once).
- `isStandalone: boolean` — already running installed, via
  `window.matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true` (the latter for iOS).
- `isIOS: boolean` — iOS Safari where install is manual (no
  `beforeinstallprompt`). Detected by UA/platform + not standalone.
- `showIosHint: boolean` — convenience: iOS, not standalone, not previously
  dismissed → surface "Add to Home Screen" instructions.

Behavior:

- On mount, add a `beforeinstallprompt` listener that calls
  `e.preventDefault()`, stashes the event, and sets `canInstall = true`.
- Add an `appinstalled` listener that clears `canInstall` and sets a
  `localStorage` flag so surfaces hide immediately after install.
- The captured event is module-level (or ref) so it survives re-renders; guard
  against the event firing before the listener by reading a shared holder.

## Install UI

Both surfaces read from the same `usePwaInstall` hook. Neither renders when
`isStandalone` (already installed) or when the platform can't install.

### `InstallBanner` — `src/components/install-banner.tsx`

- Slim, dismissable banner. Shown when **(`canInstall`) or (`showIosHint`)** and
  the user has not dismissed it (persisted in `localStorage` under e.g.
  `fq.pwa.bannerDismissed`).
- Content: app icon/name, one line ("Install FocusQuest for a full-screen,
  home-screen experience"), an **Install** action, and a **dismiss** (×).
- On Android/desktop, **Install** calls `promptInstall()`; on `"accepted"` the
  banner hides. On iOS, **Install** opens a small **instructions popover**
  ("Tap the Share icon, then *Add to Home Screen*") rather than a native prompt.
- Placement: rendered inside `Layout`, at the top of the `<main>` scroll area (or
  a bottom sheet on mobile — implementer picks the least intrusive that matches
  the existing dark card styling). Auto-hides on `appinstalled`.

### `InstallButton` — in `components/layout.tsx`

- A small **Download**-icon button (lucide `Download` / `DownloadCloud`) next to
  `NotificationBell` in both the mobile header and the desktop sidebar, matching
  the existing ghost-icon + tooltip pattern.
- Visible only when installable (`canInstall || showIosHint`) and not
  standalone. Clicking calls `promptInstall()` (or opens the iOS hint). Serves as
  the persistent fallback after the banner is dismissed.

## Error handling / edge cases

- **Already installed:** `isStandalone` true → both surfaces render nothing; no
  duplicate prompts inside the installed app.
- **Event fires before React mounts:** a module-level capture holder means the
  deferred event is not lost between page load and hook mount.
- **Prompt used twice:** `beforeinstallprompt`'s event is single-use; after
  `promptInstall()` we clear it and set `canInstall = false` until the browser
  re-fires it.
- **User dismisses the banner but not installed:** banner stays hidden
  (localStorage); the header button remains as the fallback entry point.
- **iOS:** never fires `beforeinstallprompt`; `promptInstall()` returns
  `"unavailable"` and the UI shows manual instructions instead.
- **Unsupported / desktop browsers that never fire the event** (e.g. Firefox):
  `canInstall` stays false and neither surface shows — no dead buttons.
- **SW registration failure:** caught and logged; install simply won't be
  offered. Push, which registers on demand, is unaffected.

## Testing

Client vitest is already configured in `artifacts/focusquest`.

- `src/hooks/use-pwa-install.test.tsx`: dispatch a synthetic
  `beforeinstallprompt` → `canInstall` becomes true and `preventDefault` is
  called; `promptInstall()` resolves from a stubbed `userChoice` and clears the
  event; `appinstalled` clears `canInstall`; `isStandalone` reads the mocked
  `matchMedia`; the iOS branch (`isIOS`/`showIosHint`) is exercised with a mocked
  UA and no `beforeinstallprompt`.
- Manifest validity is asserted by a small test that `JSON.parse`s
  `manifest.webmanifest` and checks required keys + that referenced icon paths
  exist on disk.

Manifest correctness, icon rendering, and the actual install flow are verified
by loading the built app and running a Lighthouse **PWA/Installability** check
plus a manual install on Chrome and iOS Safari.

## Build / integration order

1. Generate the icon set from the supplied source art → `public/icons/`.
2. Add `manifest.webmanifest`; wire the manifest/apple/theme-color tags into
   `index.html` (+ `viewport-fit=cover`).
3. Register the service worker on load in `main.tsx`; add the no-op `fetch`
   handler to `sw.js`.
4. `usePwaInstall` hook + unit tests.
5. `InstallBanner` component and `InstallButton` in the layout, both wired to the
   hook.
6. Verify: typecheck, run the suite, Lighthouse installability check, and a live
   install on Chrome + iOS Safari.

## Out of scope (v1)

- **Offline support** — no app-shell caching, no offline fallback page, no cached
  API data or action queue. The `fetch` handler is a deliberate no-op.
- Background sync / periodic background sync.
- App shortcuts (`shortcuts` in the manifest), share target, or file handlers.
- Screenshots / richer install UI (`screenshots` in the manifest for the Chrome
  install dialog).
- Push notification changes — push is already shipped and untouched here.
- A settings page for install/notification management (surfaces stay in the
  existing chrome).
