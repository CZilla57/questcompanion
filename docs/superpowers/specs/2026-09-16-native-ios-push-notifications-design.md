# Native iOS Push Notifications — Design

**Date:** 2026-09-16
**Status:** Approved (design); implementation plan pending
**Surfaces:** api-server + native iOS (`ios/FocusQuest`) — ships as one cross-surface unit per `CLAUDE.md`.

## Problem

The native iOS app (`ios/FocusQuest`, the active mobile target) is **local-notifications-only**.
`NotificationManager` states "there is no push, no APNs, and no remote-notification
background mode," and the app never registers an APNs token via `POST /devices`
(confirmed: no `registerForRemoteNotifications`/`deviceToken` anywhere in `ios/`, and
`ios/README.md` notes "a native client would need an APNs token").

Consequently the server's full push stack — `notification-envelope.ts` ("One Voice"
decision point), `notification-scheduler.ts`, `device-dispatch.ts`, `push-dispatch.ts` —
**cannot reach the native app when it is closed.** No server-initiated nudges, care
warnings, reflection prompts, companion milestones, or any other push arrives. For an
ADHD app whose core value is *timely re-engagement*, this is the highest-impact gap: the
delivery logic already exists and is unit-tested; only the transport + client registration
are missing.

The `devices` route and schema are already APNs-ready — `POST /devices` explicitly accepts
`provider: "apns"` and stores it. What's missing is (a) a server-side APNs *transport*
(there is Expo + web-push, no APNs sender) and (b) the native client registering an APNs
token and handling taps.

## Decisions (locked)

- **v1 scope:** route **all existing server push types** to native iOS (everything that
  flows through the notification envelope / current producers), not a subset.
- **Delivery:** **Direct APNs over HTTP/2 with token auth (.p8 Auth Key)** — one key for
  all apps, never expires, simplest ops; matches the existing `provider:'apns'` slot.
- **Transport implementation:** **hand-rolled thin transport** (~120 lines: `jsonwebtoken`
  ES256 + Node built-in `http2`) behind an injectable interface, mirroring `expo-push.ts`.
  No heavyweight APNs dependency.
- **Tap behavior:** **deep-link to the relevant screen** — each push carries a
  `data.target` and tapping opens straight to that quest/party/rescue/hero screen.

## Architecture

Delivery gating is unchanged and automatically covers APNs: the "One Voice" envelope
(`DAILY_PUSH_BUDGET = 3`, `PUSH_SPACING_MIN = 90`, deep-night `[2,7)` silence) sits
**upstream** of channel fan-out, so native inherits all ADHD-safety limits for free and
never becomes a spam vector.

### Server

**New `artifacts/api-server/src/lib/apns-push.ts`** — mirrors `expo-push.ts`:
- `buildApnsRequests(tokens, payload)` → per-token HTTP/2 request descriptors:
  `:path = /3/device/<token>`, headers `apns-topic` (bundle id), `apns-push-type`,
  `apns-priority`; body `{ aps: { alert: { title, body }, sound, badge? }, ...data }`.
- `ApnsTransport` interface (injectable, like `ExpoTransport`) + a default transport using
  Node `http2` with a **cached provider JWT** (ES256, signed from the `.p8`, re-signed
  ~every 40 min per Apple guidance).
- `deadTokensFromApnsReceipts(tokens, receipts)` → tokens Apple rejects with
  `410 Unregistered` / `BadDeviceToken`, for pruning (parallels `deadTokensFromReceipts`).
- **Never throws** — one receipt per message, matching the dispatcher contract.
- **No-op when unconfigured** (env vars absent) — same defensive pattern as VAPID keys in
  `push-notifications.ts`, keeping dev/CI green.

**Extend `artifacts/api-server/src/lib/device-dispatch.ts`:**
- Add to `DispatchDeps`: `listApnsTokens(userId)`, `sendApns(tokens, payload)`; reuse
  `pruneTokens`.
- Add an APNs branch in `dispatchToUser` identical in shape to the Expo branch.
- Extend `DispatchResult` with `apnsSent`.

**Deep-link route table** in `notification-envelope.ts`:
- Add `KIND_ROUTE: Record<CandidateKind, { screen: string; params?: Record<string, string> }>`
  next to `KIND_META`. Every `CandidateKind` gets a route (e.g. `context_nudge → {screen:"today"}`,
  `hunger_warning → {screen:"hero"}`, `reflection_prompt → {screen:"reflection"}`,
  `companion_milestone → {screen:"hero"}`, `hyperfocus → {screen:"focus"}`, `hero_flavor → {screen:"hero"}`).
- Any additional push producer (party/world-boss/rescue) that emits a push gets a
  `CandidateKind` entry with a route.
- At the envelope→dispatch boundary, stamp `payload.data.target = KIND_ROUTE[kind]`. Single
  choke point; producers untouched.

**Config (env, on Render):** `APNS_AUTH_KEY` (.p8 contents), `APNS_KEY_ID`, `APNS_TEAM_ID`,
`APNS_BUNDLE_ID`, `APNS_ENV` (`sandbox` | `production`).

**APNs environment:** dev-build vs TestFlight/App-Store tokens target different Apple hosts.
Store an `environment` value with each device token (client sends it at registration) and
route each token to the matching host — more robust than guessing. Requires a `devices`
schema addition (`environment` column) → Drizzle migration (remember `meta/_journal.json`
+ snapshot alongside the `.sql`).

### iOS (`ios/FocusQuest`)

**Capability/entitlement:** add **Push Notifications** capability + `aps-environment`
entitlement to the app target (project-file change).

**Token registration:**
- Add a `UIApplicationDelegateAdaptor` (SwiftUI has no app delegate by default) to receive
  `didRegisterForRemoteNotificationsWithDeviceToken`.
- Extend `NotificationManager` (today local-only) to request notification authorization,
  then call `registerForRemoteNotifications()`. Local nudges and remote pushes share one
  authorization + delegate surface.
- New `DeviceService`: on token → `POST /devices { token: <hex>, provider: "apns",
  environment: <sandbox|production> }`, environment read from the build's `aps-environment`
  entitlement value.
- On logout (`AuthService`): `DELETE /devices/:token`.

**Tap → deep-link routing:**
- In `NotificationManager`'s `UNUserNotificationCenterDelegate didReceive response`, read
  `userInfo["target"]` → `{ screen, params }`.
- Route through a lightweight app-level deep-link coordinator (an observable
  `pendingRoute`) that the root navigation host resolves to the right tab + screen. Same
  coordinator serves foreground (`willPresent`) and cold-launch (initial notification).
- Target screens already exist (Today, Hero, Reflection, Party, Focus, …) — this is a
  routing/enum-mapping layer, not new UI.

## Data flow

1. A producer offers a push candidate (kind) → envelope selects at most one per tick,
   subject to budget/spacing/deep-night.
2. Selected payload is stamped with `data.target = KIND_ROUTE[kind]`.
3. `bestEffortDispatch` → `dispatchToUser` fans out to web + Expo + **APNs**.
4. APNs transport signs a provider JWT, sends over HTTP/2; dead tokens (`410`) are pruned.
5. Device shows the notification; tap → `NotificationManager` reads `target` → coordinator
   routes to the screen.

## Error handling

- Transport never throws; `bestEffortDispatch` already logs and swallows so scheduler
  spacing/budget claims are never rolled back by a delivery hiccup.
- Unconfigured APNs env → branch no-ops (dev/CI safe).
- Dead/expired tokens pruned on `410`/`BadDeviceToken`.
- Logout deregisters the token to stop delivery to a signed-out device.

## Testing

**Server (Vitest, colocated):**
- `apns-push.test.ts` — request + JWT build, `410`/`BadDeviceToken` dead-token detection,
  no-op when unconfigured; injected fake transport (mirrors `expo-push.test.ts`).
- `device-dispatch.test.ts` — new APNs branch + prune, `apnsSent` accounting.
- `notification-envelope.test.ts` — **exhaustiveness test that every `CandidateKind` has a
  `KIND_ROUTE`** (build-gate against tap-that-goes-nowhere), plus correct `data.target`
  stamping.

**iOS:**
- Simulator build is the CI gate.
- Payload/deep-link handling verifiable on the sim via
  `xcrun simctl push <udid> <bundle-id> payload.apns` (no live APNs needed) — drive it to
  prove a tap lands on the correct screen.
- True end-to-end APNs delivery needs a physical device + credentials → owner's step
  (checklist provided).

## Prerequisites (owner-provisioned — not automatable)

Claude cannot access the Apple Developer account or handle key material.

1. Enable **Push Notifications** on the App ID in the Apple Developer portal.
2. Create an **APNs Auth Key (.p8)**; record **Key ID** and **Team ID**.
3. Add `.p8` contents + Key ID + Team ID + bundle id + `APNS_ENV` as **env vars on Render**
   (referenced by name; the key is never exposed to Claude).

## Out of scope (v1)

- Shortcuts HTTP endpoints (`/shortcuts/*`, `/shortcut-tokens`) — native uses on-device App
  Intents (PR #155); separate, low priority.
- Third-party relay (FCM/OneSignal) — rejected in favor of direct APNs.
- Rich/media push, notification action buttons — can follow once the pipe is proven.

## Files touched (anticipated)

- **New:** `artifacts/api-server/src/lib/apns-push.ts` (+ test); iOS `Services/DeviceService.swift`,
  app-delegate adaptor, deep-link coordinator.
- **Modified:** `device-dispatch.ts`, `notification-envelope.ts` (+ tests), the dispatch
  wiring that constructs `DispatchDeps`; `lib/db` schema (`devices.environment`) + migration;
  iOS `NotificationManager`, `AuthService`, app entry, entitlements/project file.
