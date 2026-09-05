# FocusQuest — Native iOS App (SwiftUI)

A native Swift/SwiftUI client for FocusQuest (the QuestCompanion API). It talks to
the same REST API and uses the same Auth0 login flow as the existing React Native
app in `artifacts/focusquest-mobile`, so both clients can share one backend and
one Auth0 application.

> Built and pushed from a Linux CI environment, so it has **not** been compiled by
> Xcode. Treat the first `⌘B` as the real verification step — see
> [Known caveats](#known-caveats).

## Requirements

- Xcode 16 or later (the project uses file‑system‑synchronized folder groups,
  `objectVersion = 77`).
- iOS 17.0+ deployment target.
- A running FocusQuest API server and an Auth0 **Native** application.

## Configure

All environment values live in [`Config.xcconfig`](./Config.xcconfig) — no secrets
are compiled into source. Set:

| Setting | Meaning | Example |
| --- | --- | --- |
| `FQ_API_SCHEME` | `https` (or `http` for a local dev server) | `https` |
| `FQ_API_HOST` | API host, no scheme, no `/api` | `api.focusquest.app` |
| `FQ_AUTH0_DOMAIN` | Auth0 tenant domain | `your-tenant.us.auth0.com` |
| `FQ_AUTH0_CLIENT_ID` | Auth0 Native app client id | `abc123…` |

The base URL is assembled as `FQ_API_SCHEME://FQ_API_HOST`; the client appends
`/api` itself (matching the OpenAPI `servers: [{ url: /api }]`).

In the Auth0 application settings, add these to **Allowed Callback URLs** (the same
values the RN app registers):

```
focusquest://auth
```

To keep real values out of git, copy `Config.xcconfig` to `Config.local.xcconfig`
(gitignored) and point the target's base configuration at it.

## Run

```
open ios/FocusQuest.xcodeproj
```

Select the **FocusQuest** scheme and an iOS 17 simulator or device, then Run.
Sign-in opens Auth0 in an `ASWebAuthenticationSession`; on success the app
exchanges the authorization code at `/api/mobile-auth/token-exchange` for an opaque
session token, stored in the Keychain and sent as `Authorization: Bearer <token>`.

## Architecture

```
FocusQuest/
  App/            App entry, root routing, tab bar, AppConfig
  Auth/           Auth0 PKCE flow (ASWebAuthenticationSession), Keychain, AuthManager
  Networking/     APIClient actor (async/await JSON), APIError
  Models/         Codable models mirroring the OpenAPI schemas
  Services/       Typed API call groups (Quest, Focus, Questline, …)
  DesignSystem/   Theme tokens + reusable SwiftUI components
  Support/        Loadable state helper, date utilities
  Features/       One folder per screen area (MVVM: a View + @MainActor view model)
```

- **Networking** is a single `APIClient` actor that owns the bearer token, prefixes
  `/api`, encodes/decodes JSON, and reports 401s so `AuthManager` signs out.
- **Screens** follow a light MVVM pattern with a `Loadable<Value>` enum and the
  shared `AsyncContentView` for the loading/error/loaded states.
- **Auth** mirrors the RN client exactly: base64url PKCE, `S256` challenge, the
  `openid email profile offline_access` scopes, and the `focusquest://auth` redirect.

## Feature coverage

Broad parity with the web/RN feature set: Today dashboard, Quests (list, quick add,
complete, questlines, campaigns, recurring), Focus timer (server-recorded intervals),
Hero (status, companion, avatar, kingdoms), Progress (insights, patterns, heatmap,
badges, leaderboard), Social (allies, nudges, body-double rooms), Rewards (coins,
reward store, dopamine menu, mystery box, stat perks, gear store, world boss),
Brain check-in + momentum, Evening reflection, and Settings.

Screens are wired to the real API; depth varies by area (the long-tail screens are
intentionally lighter). They're a foundation to extend, not a pixel-final product.

## Known caveats

- **Not yet compiled in Xcode.** Expect to fix a few small things on first build.
- **App icon** is a placeholder (`Assets.xcassets/AppIcon.appiconset` has no image).
- **Push notifications** aren't wired. The RN app registers Expo push tokens at
  `POST /api/devices` with `provider: "expo"`; a native client would need an APNs
  device-token path on the server before adding `UNUserNotificationCenter`.
- **Voice quick-add** (`/tasks/transcribe`) isn't implemented; quick add uses the
  natural-language text parser (`/tasks/parse`).
