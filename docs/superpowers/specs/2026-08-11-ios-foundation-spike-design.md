# iOS Foundation Spike — Design (Phase 0 + 0b)

**Date:** 2026-08-11
**Status:** Approved design; implementation plan to follow.
**Parent roadmap:** [2026-08-11-ios-app-roadmap.md](./2026-08-11-ios-app-roadmap.md)

This is the first, de-risking slice of the FocusQuest iOS app: prove real-device
Auth0 login against the live session model, and lay the server-side groundwork
for native push. It is a **spike** — success is measured by three on-device
gates, not by production polish. Everything not required to prove those gates is
explicitly out of scope.

---

## 1. Scope & exit gates

**In scope**
- A new `artifacts/focusquest-mobile` Expo app that authenticates a real user
  against Auth0 and calls the API with a FocusQuest bearer token.
- Server-side push groundwork: a `device_tokens` schema and a provider-agnostic
  delivery adapter with an **Expo Push** sender implemented (direct APNs stubbed
  against the same interface).
- On-device push registration and a manual delivery verification.

**Exit gates** (all verified on a physical iPhone against the **staging** API):

- **G1 — Auth loop.** Cold launch → Auth0 Universal Login in the system browser
  → return to the app authenticated → an authenticated `GET` (current game user)
  returns real staging data → logout clears the Keychain token and ends the
  server session.
- **G2 — Durability.** Force-quit and relaunch → still authenticated (token
  restored from Keychain), no re-login.
- **G3 — Push.** Device registers an Expo push token → backend stores it in
  `device_tokens` → a server-triggered test send arrives as a banner on the
  locked device → tapping it deep-links into the app.

**Out of scope:** the Now screen and any feature UI, the SQLite offline outbox,
native voice capture, the hero renderer, direct APNs sending, Universal Links,
and any styling beyond what the three gates require.

---

## 2. Workspace & build setup

- New package **`artifacts/focusquest-mobile`**, picked up automatically by the
  existing `artifacts/*` glob in `pnpm-workspace.yaml`.
- **Resolve pnpm + Metro first (task #1).** Metro does not follow pnpm's
  symlinked `node_modules` by default. Configure `metro.config.js` with
  `watchFolders` (repo root) and `nodeModulesPaths`; if resolution still fails,
  add a mobile-scoped `.npmrc` with `node-linker=hoisted`. No other task can be
  verified until Metro resolves the workspace `lib/*` packages.
- **EAS dev client, not Expo Go.** The custom URL scheme (Auth0 callback) and
  push entitlements require a real build. Set up: EAS project, iOS bundle
  identifier, and an APNs key (used by Expo Push) in the paid Apple Developer
  account.
- **API base URL** is configurable via `EXPO_PUBLIC_API_URL`, pointed at
  **staging** for this spike. At startup the app wires the generated client once:
  `setBaseUrl(process.env.EXPO_PUBLIC_API_URL)` and
  `setAuthTokenGetter(() => SecureStore.getItemAsync(TOKEN_KEY))`
  (`lib/api-client-react/src/custom-fetch.ts`).

---

## 3. Auth (client track)

Provider is **Auth0**. The app is a public client that runs the browser flow and
generates PKCE material; the **existing server endpoint does the confidential
code grant**, so the app never handles Auth0 tokens and inherits the same bearer
session model the whole API already uses.

Flow:

1. `expo-auth-session` launches **Auth0 Universal Login** via
   **ASWebAuthenticationSession**, generating the PKCE `code_verifier`, `state`,
   and `nonce` on device.
2. **Custom-scheme callback** `focusquest://auth`, registered as an Auth0 Allowed
   Callback URL. (Universal Links via Associated Domains is a later hardening
   step, out of scope here.)
3. On callback, POST `{ code, code_verifier, redirect_uri, state, nonce }` to the
   existing [`/mobile-auth/token-exchange`](../../../artifacts/api-server/src/routes/auth.ts).
   The server performs the grant, upserts the game user, and returns the
   FocusQuest session token.
4. Store the token in **Secure Store (Keychain)**. A small `AuthContext` exposes
   `login` / `logout` / restore-on-launch and backs the auth-token getter.
5. Logout calls `/mobile-auth/logout` and deletes the Keychain token (and
   deregisters the push device token — see §4).

**Config item to confirm during G1 (top risk):** the Auth0 application must
permit PKCE **and** the server-side secret exchange for the same client
(Regular Web App with PKCE enabled), matching the server's use of
`OAUTH_CLIENT_SECRET` alongside a `code_verifier`. Front-loaded into G1 because
it is the most likely integration snag.

---

## 4. Push backend (Phase 0b)

**`device_tokens` table** — dual-provider from day one, alongside the untouched
`push_subscriptions` (Web Push) table:

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer FK → `users.id` | not null |
| `provider` | text | `'expo' \| 'apns'` |
| `token` | text | the Expo push token or raw APNs token |
| `platform` | text | `'ios'` for now |
| `createdAt` | timestamp | default now |
| `lastSeenAt` | timestamp | refreshed on re-register |

Unique constraint on `(provider, token)`.

**Delivery adapter** — a `NotificationTarget` abstraction over both tables. A
dispatcher fans a notification out to a user's Web Push subscriptions (existing
`web-push` path in `artifacts/api-server/src/lib/push-notifications.ts`,
unchanged) **and** their device tokens. Only the **Expo sender** is implemented
now (Expo HTTP/2 push API); an `apns` branch is stubbed against the same
interface for a later phase.

**Endpoints:**
- `POST /devices` — register/refresh an Expo push token (upsert by
  `(provider, token)`, refresh `lastSeenAt`).
- `DELETE /devices/:token` — deregister on logout or rotation.
- `POST /devices/test-send` — **temporary, authenticated** trigger for G3;
  removed before the phase closes.

Token rotation: upsert-on-register plus pruning tokens that Expo reports as
`DeviceNotRegistered` in send receipts.

**Client registration:** on login, request notification permission, obtain the
Expo push token, POST to `/devices`; handle foreground presentation and the
notification-tap deep link into the app.

---

## 5. Testing

- **Server (0b).** Unit/contract tests in the existing api-server Vitest suite
  for the delivery adapter: routing (a user with both a Web Push sub and an Expo
  token receives both), upsert/dedupe, and dead-token pruning. Mock the Expo API
  boundary. New endpoints get request-level tests.
- **Client.** The auth loop is proven by the on-device G1/G2 gates rather than
  heavy unit tests (spike surface, not production). Pure helpers (PKCE param
  building, token restore/expiry logic) get focused unit tests.
- **Push.** G3 is a documented manual on-device verification driven by the
  temporary `POST /devices/test-send`; the endpoint is removed when the phase
  closes.

---

## 6. Prerequisites & risks

**Prerequisites (confirmed available):** paid Apple Developer account, physical
iPhone, Auth0 tenant admin access (to add the callback URL and confirm the app
type), and a reachable **staging** API with `EXPO_PUBLIC_API_URL`.

**Risks (both front-loaded):**
1. Auth0 PKCE-plus-secret exchange configuration (§3) — mitigated by proving G1
   first.
2. pnpm/Metro workspace resolution (§2) — mitigated by making it task #1.

---

## 7. What this unlocks

Passing G1–G3 converts the rest of the iOS migration from an architectural
gamble into controlled feature work: the auth/session model, the workspace/build
toolchain, and the push delivery path are all proven on real hardware. The next
spec is **Phase 1 — the core loop** (onboarding → Now → tasks → quick-add →
completion → XP).
