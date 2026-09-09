# Key Modules

*Last Updated: 2026-09-08*

## Workspace packages (`lib/*`)

### `@workspace/db`
- **Location:** `lib/db/`
- **Purpose:** Drizzle ORM schema, DB client, migrations for the whole product.
- **Key files:** `src/schema/index.ts` (barrel), `src/index.ts` (client), `src/migrate.ts`, `src/gear-catalog.ts` (gear seed data/power math), `drizzle.config.ts`.
- **Depends on:** `drizzle-orm`, `pg`, `drizzle-zod`.
- **Exposes:** `db`, `pool`, every table object + inferred types (`./schema`), `runMigrations` (`./migrate`), `GEAR_CATALOG`/`gearStatPower` (`./gear-catalog`). See `database.md`.

### `@workspace/api-spec`
- **Location:** `lib/api-spec/`
- **Purpose:** The single hand-authored API contract (`openapi.yaml`) plus the orval codegen config that produces `api-client-react` and `api-zod`.
- **Key files:** `openapi.yaml` (~6,500 lines), `orval.config.ts`.
- **Depends on:** `orval`.
- **Exposes:** the `codegen` script (`pnpm --filter @workspace/api-spec codegen`) — the only command that regenerates the two downstream packages together.

### `@workspace/api-zod`
- **Location:** `lib/api-zod/`
- **Purpose:** Generated Zod validation schemas + TS types for the API contract, used server-side for request/response validation.
- **Key files:** `src/generated/api.ts` (per-operation schemas), `src/generated/types/*.ts` (~325 per-schema files), `src/index.ts` (barrel). **Fully generated — never hand-edit.**
- **Depends on:** `zod`, the upstream `openapi.yaml`.
- **Exposes:** typed Zod schemas (e.g. `HealthCheckResponse`, `AuthUser`, `ExchangeMobileAuthorizationCodeBody`) consumed by `artifacts/api-server`.

### `@workspace/api-client-react`
- **Location:** `lib/api-client-react/`
- **Purpose:** Generated TanStack Query hooks + TS types for the API, shared by the web app and (per its explicit RN-aware design) the future/early mobile client.
- **Key files:** `src/generated/api.ts` (hooks, e.g. `useGetMyStats`, `useEnterBattle`, `useAttuneGear`), `src/generated/api.schemas.ts` (types), `src/custom-fetch.ts` (hand-written fetch mutator — JSON/text/blob parsing, `ApiError`, `setBaseUrl()`/`setAuthTokenGetter()` for cross-platform reuse).
- **Depends on:** `@tanstack/react-query`.
- **Exposes:** every generated hook + `customFetch`, `setBaseUrl`, `setAuthTokenGetter`.

### `@workspace/auth-web`
- **Location:** `lib/auth-web/`
- **Purpose:** Cookie/session-based `useAuth()` hook for the web app (not a token-holding client flow).
- **Key files:** `src/use-auth.ts`.
- **Depends on:** `@workspace/api-client-react`.
- **Exposes:** `useAuth()` → `{ user, isLoading, isAuthenticated, failure, login, logout }`.

### `@workspace/hero-options`
- **Location:** `lib/hero-options/`
- **Purpose:** Pure catalogs of hero customization options (skin, hair, build, face, etc.), shared between the web renderer and seed scripts.
- **Key files:** `src/index.ts`, `src/options.test.ts`.
- **Exposes:** option catalogs consumed by `artifacts/focusquest/src/lib/hero/` and `scripts/src/seed-gear.ts`.

### `@workspace/pomodoro`
- **Location:** `lib/pomodoro/`
- **Purpose:** Pure focus-timer/Pomodoro cycle logic, shared by the web app and (via `@workspace/pomodoro` dependency) the Expo mobile app.
- **Key files:** `src/index.ts`, `src/pomodoro.test.ts`.

### `@workspace/quick-add`
- **Location:** `lib/quick-add/`
- **Purpose:** Pure natural-language quick-add parser + category inference, used by the web quick-add bar and the server-side voice/text parse endpoints' pre/post-processing.
- **Key files:** `src/parse.ts`, `src/categories.ts`, `src/types.ts` (+ co-located tests).

## Applications (`artifacts/*`)

### `@workspace/api-server` — the production backend
- **Location:** `artifacts/api-server/`
- **Purpose:** Express 5 API; owns all game logic, auth, scheduling, and third-party integrations.
- **Key files:** `src/index.ts`/`src/app.ts` (entry), `src/routes/*.ts` (~44 thin route files), `src/lib/*.ts` (~150 pure/DB-touching domain modules, e.g. `roll-engine.ts`, `kingdoms.ts`, `class-feats.ts`, `attunement.ts`, `encounter-progress.ts`, `notification-scheduler.ts`), `src/lib/ai/` (Gemini/Groq), `src/lib/email/` (Resend), `src/middlewares/authMiddleware.ts`.
- **Depends on:** `@workspace/db`, `@workspace/api-zod`, `@workspace/hero-options`, `@workspace/quick-add`, `express`, `openid-client`, `web-push`, `pino`.
- **Exposes:** the entire `/api` HTTP surface (see `communication.md`).

### `@workspace/focusquest` — the production web PWA
- **Location:** `artifacts/focusquest/`
- **Purpose:** React 19 + Vite 7 installable PWA; the primary/most-complete client.
- **Key files:** `src/main.tsx`/`src/App.tsx` (entry/composition root), `src/pages/*.tsx` (~20 routes), `src/components/` (flat, ~48 shared components + `ui/` shadcn primitives), `src/lib/` (pure logic + `lib/hero/` hero renderer + `lib/outbox/` offline mutation queue), `public/sw.js` + `scripts/inject-sw-precache.mjs` (service worker).
- **Depends on:** `@workspace/api-client-react`, `@workspace/auth-web`, `@workspace/hero-options`, `@workspace/pomodoro`, `@workspace/quick-add`, React Query, wouter, Tailwind v4, Radix/shadcn, `pixi.js`.
- **Exposes:** the deployed web app (built into `dist/public`, served by `api-server` in production — see `docker.md`).

### `@workspace/focusquest-mobile` — Expo/React Native client (early phase)
- **Location:** `artifacts/focusquest-mobile/`
- **Purpose:** Foundation-spike-era native mobile client (auth, focus timer, deep-link routing, push registration). Per `docs/superpowers/specs/2026-08-11-ios-app-roadmap.md` and the newer `ios/` native app, this track is not the current priority for reaching feature parity — the SwiftUI app has since overtaken it for iOS.
- **Key files:** `app/_layout.tsx`/`app/index.tsx`/`app/focus.tsx`/`app/reflection.tsx` (Expo Router routes), `src/auth/` (PKCE + token store), `src/routing/` (deep-link + nav-decision logic), `src/push/register-device.ts`.
- **Depends on:** `@workspace/api-client-react`, `@workspace/pomodoro`, Expo SDK 53.

### `@workspace/mockup-sandbox` — dev-only UI sandbox
- **Location:** `artifacts/mockup-sandbox/`
- **Purpose:** shadcn/ui component gallery for design exploration; explicitly out of production scope per `threat_model.md` unless shared code becomes reachable from prod.
- **Key files:** `src/App.tsx`, `src/components/ui/*` (near-duplicate of `focusquest`'s shadcn set).

### `@workspace/scripts` — ops/build/seed CLIs
- **Location:** `scripts/`
- **Purpose:** One-off and repeatable operational scripts run via `pnpm --filter @workspace/scripts <name>`.
- **Key files:** `src/seed-gear.ts`, `src/seed-badges.ts`, `src/backfill-badges.ts`, `src/build-lpc-assets.ts`, `src/build-kingdom-buildings.ts`, `src/reseed-world-boss-week.ts`, `src/render-status.ts` (read-only Render deploy/log inspector).
- **Depends on:** `@workspace/db`, `@workspace/hero-options`.

## iOS (`ios/`) — separate Xcode project, not in the pnpm workspace

### `FocusQuest` (main app target)
- **Location:** `ios/FocusQuest/`
- **Purpose:** Native SwiftUI client talking to the same REST API and Auth0 app as the web/RN clients. Broad feature parity per `ios/README.md` (Today, Quests, Focus, Hero, Progress, Social, Rewards, Brain check-in, Reflection, Settings), depth varies by screen.
- **Key files/folders:** `App/` (entry, routing, tab bar, config), `Auth/` (PKCE, Keychain, `AuthManager`), `Networking/APIClient.swift` (single actor, prefixes `/api`, maps 401 → sign-out), `Services/` (one typed call-group per resource + `NotificationManager`, `FocusActivityController`, `QuestNudgeScheduler`), `Features/` (one folder per screen area).
- **Depends on:** first-party Apple frameworks only — no SPM dependencies.
- **Exposes:** the App Store-bound native client; shares hero sprite assets with the web app via `ios/scripts/build-hero-assets.mjs` (reads `artifacts/focusquest/src/lib/hero/catalog.ts`).

### `FocusQuestWidgets` (widget extension target)
- **Location:** `ios/FocusQuestWidgets/`
- **Purpose:** Home/Lock-Screen widgets + a Focus-session Live Activity/Dynamic Island.
- **Key files:** `FocusQuestWidgetBundle.swift` (`@main`), `FocusQuestWidget.swift`, `FocusActivityLiveActivity.swift`.
- **Depends on:** `ios/Shared/` (App Group snapshot model) — no network calls in the extension process itself.

### `ios/Shared/`
- **Purpose:** The only code compiled into both the app and widget targets.
- **Key files:** `FocusActivityAttributes.swift` (Live Activity shape), `WidgetSharedStore.swift` (App Group `UserDefaults` read/write + the `focusquest://focus` deep-link constant).

## Cross-module notes

- **Auth0/OIDC identity is one source of truth for all three clients** (web, RN, iOS) — each exchanges a code for the same kind of opaque FocusQuest session bearer token, never handling raw Auth0 tokens client-side.
- **The OpenAPI spec is the real dependency graph seam**: `lib/api-spec/openapi.yaml` → `lib/api-zod` (server validation) + `lib/api-client-react` (web/RN hooks); iOS hand-maintains parallel `Models`/`Services` that must be kept in sync manually since Swift isn't in the orval pipeline.
- **No cross-client shared business logic beyond pure TS libs** (`hero-options`, `pomodoro`, `quick-add`) — iOS reimplements client-side rules in Swift; the server (`artifacts/api-server/src/lib/`) is the actual single source of truth for game rules across all clients.
