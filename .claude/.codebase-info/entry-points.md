# Entry Points

*Last Updated: 2026-09-08*

## Process / App Entry Points

| Entry point | Type | Purpose | File |
|-------------|------|---------|------|
| `node dist/index.mjs` | Process entry | Boots the Express API server | `artifacts/api-server/src/index.ts` (reads `PORT`, listens, wires `SIGTERM`/`SIGINT` graceful shutdown closing the pg pool) |
| Express app assembly | Module | Middleware stack + router mount + prod static-file serving | `artifacts/api-server/src/app.ts` |
| `node dist/migrate.mjs` | Process entry | Runs pending Drizzle migrations at container boot (retry/backoff, degrade-vs-abort policy) | `artifacts/api-server/src/migrate.ts` → `lib/db/src/migrate.ts` |
| Web app mount | Browser entry | Mounts React app, primes PWA install capture, registers service worker | `artifacts/focusquest/src/main.tsx` |
| Web app composition root | Module | `QueryClientProvider` → `TooltipProvider` → `WouterRouter` → `AuthGate` → `OnboardingGate` → `Router` (route table) → `Toaster` | `artifacts/focusquest/src/App.tsx` |
| Web dev harnesses | Browser entry (dev-only) | Isolated preview of the DM-beat card / hero renderer outside normal routing | `artifacts/focusquest/src/dm-beat-harness.tsx`, `src/hero-harness.tsx` |
| Mobile app entry | Expo Router entry | `main: "expo-router/entry"` in `package.json`; file-based routes | `artifacts/focusquest-mobile/app/_layout.tsx`, `app/index.tsx`, `app/focus.tsx`, `app/reflection.tsx` |
| iOS app entry | `@main` App | Installs notification delegate, owns `AuthManager`/`AppRouter` environment objects, handles widget deep links | `ios/FocusQuest/App/FocusQuestApp.swift` |
| iOS root gate | View | Routes to Splash / Login / MainTabView off `AuthManager.status` | `ios/FocusQuest/App/RootView.swift` |
| iOS tab shell | View | 5-tab `TabView` (Today, Quests, Focus, Hero, More) | `ios/FocusQuest/App/MainTabView.swift` |
| Widget extension entry | `@main` WidgetBundle | Home/Lock-Screen widgets + Focus Live Activity | `ios/FocusQuestWidgets/FocusQuestWidgetBundle.swift` |
| Mockup sandbox entry | Browser entry (dev-only) | shadcn/ui component gallery, not part of production | `artifacts/mockup-sandbox/src/App.tsx` |
| Scripts CLIs | CLI commands | One-off ops/seed/build scripts, run via `pnpm --filter @workspace/scripts <script>` | `scripts/src/*.ts` (see `onboarding.md` for the list) |

## HTTP Entry Points (selected — full surface in `communication.md`)

| Entry point | Type | Purpose | File |
|-------------|------|---------|------|
| `GET /api/healthz` | HTTP route | Health check (Render/Railway probe target) | `artifacts/api-server/src/routes/health.ts` |
| `POST /api/cron/tick` | HTTP route (bearer-secret protected) | The single background-job trigger — recurring-task spawning, notification envelope pass, weekly recaps, heartbeat ping | `artifacts/api-server/src/routes/cron.ts` → `src/lib/notification-scheduler.ts` |
| `GET /api/login`, `GET /api/callback` | HTTP route | Browser OIDC login flow (Auth0) | `artifacts/api-server/src/routes/auth.ts` |
| `POST /api/mobile-auth/token-exchange` | HTTP route | PKCE code → opaque FocusQuest session bearer token, used by iOS and RN clients | `artifacts/api-server/src/routes/auth.ts` |
| `POST /api/tasks`, `POST /api/tasks/:id/complete` | HTTP route | Core quest-creation / completion loop (the product's central action) | `artifacts/api-server/src/routes/tasks.ts` |
| `POST /api/shortcuts/capture`, `GET /api/shortcuts/today` | HTTP route (token-authenticated) | iOS Apple-Shortcuts "Pocket Gate" integration | `artifacts/api-server/src/routes/shortcuts.ts` (see `docs/ops/pocket-gate.md`) |

## Representative Flow: completing a quest

1. **Client** — web `src/pages/tasks.tsx` (or iOS `QuestsView`/`QuestRow`, or a Pocket Gate Shortcut) calls the generated/typed client for `POST /api/tasks/:id/complete`.
2. **Route** — `artifacts/api-server/src/routes/tasks.ts` checks `req.isAuthenticated()` (set by `authMiddleware.ts`), reads the task, and delegates to the roll/reward pipeline.
3. **Game logic (`src/lib/`)** — a chain of pure, unit-tested functions resolves the outcome: `roll-engine.ts` (seeded d20 + modifier check), `xp-multiplier.ts`/`badge-awards.ts`/`award-coins.ts` (rewards), `kingdoms.ts`/`kingdom-growth.ts` (capital-tier progress), `encounter.ts`/`encounter-progress.ts` (bestiary foe HP), `feature-gates.ts` (progressive unlocks), `companion.ts` (living-companion reaction), `notification-envelope.ts` (candidate push/email).
4. **Data layer** — the route/lib code writes through Drizzle directly to `@workspace/db` (`tasksTable`, `usersTable`, `coinTransactionsTable`, `personalEncountersTable`, …) inside a transaction; a completion snapshot (`pointsAwarded`, `coinsAwarded`, `gearGrantedIds`, …) is stored on the task row so `/uncomplete` can reverse it exactly.
5. **Response** — the route shapes a JSON response validated/typed against `@workspace/api-zod` schemas (generated from `lib/api-spec/openapi.yaml`) and returns it; the client's generated React Query / Swift `APIClient` call resolves and the UI invalidates the relevant queries (e.g. `getGetMyStatsQueryKey()`).
6. **External effects (best-effort, async)** — if a badge/level/reward threshold was crossed, `push-dispatch.ts` fans out a Web Push (VAPID) / Expo push / (future) APNs notification; iOS schedules any relevant local notification itself.
