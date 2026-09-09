# Communication

*Last Updated: 2026-09-08*

## APIs

**Single source of truth:** `lib/api-spec/openapi.yaml` (OpenAPI 3.1, ~6,500 lines, hand-authored, tagged by feature area: `Auth`, `users`, `tasks`, `recurring`, `badges`, `accountability`, `leaderboard`, `calendar`, `focus`, `questlines`, `campaigns`, `party`, `brain`, `recaps`, …). Running `pnpm --filter @workspace/api-spec codegen` (`lib/api-spec/orval.config.ts`) regenerates **both**:
- `lib/api-client-react/src/generated/` — TanStack Query hooks + plain TS types, consumed by the web app (and Expo-ready via `custom-fetch.ts`'s `setBaseUrl`/`setAuthTokenGetter`).
- `lib/api-zod/src/generated/` — Zod runtime-validation schemas + one-file-per-schema TS types (~325 files), consumed selectively by `artifacts/api-server` for request/response validation (not a mirror of the DB schema — see `database.md`).

**Never hand-edit anything under either `generated/` directory** — change `openapi.yaml` and re-run codegen.

The live server (`artifacts/api-server`) mounts every route under `/api` (see `artifacts/api-server/src/app.ts`, `src/routes/index.ts`). Auth is enforced by a single global `authMiddleware` (`src/middlewares/authMiddleware.ts`); most handlers additionally guard with `if (!req.isAuthenticated())`.

### Route groups (method + path, grouped by feature; file in `artifacts/api-server/src/routes/`)

| Area | Representative routes | File |
|---|---|---|
| Health | `GET /healthz` | `health.ts` |
| Cron | `POST /cron/tick` (bearer `CRON_SECRET`, not session auth) | `cron.ts` |
| Auth | `GET /auth/user`, `GET /login`, `GET /callback`, `POST /logout`, `POST /mobile-auth/token-exchange`, `POST /mobile-auth/logout` | `auth.ts` |
| Account | `GET /me/export`, `DELETE /me` | `account.ts` |
| Users / hero | `GET/PATCH /users/me`, `PUT /users/me/timezone`, `POST /users/me/hyperfocus/pause`, `GET /users/me/stats`, `GET /users/me/hero-status`, `PATCH /users/me/companion`, `GET /users/me/kingdoms`, `GET /users/me/character-sheet`, `GET /users/me/xp-history`, `GET /users/me/insights`, `GET /users/search` | `users.ts` |
| Feats | `GET/POST /users/me/feats`, `POST /users/me/feat-branch`, `POST /users/me/feats/:id/activate` | `class-feats.ts` |
| Patterns | `GET /users/me/patterns` | `patterns.ts` |
| Badges | `GET/POST /users/me/badges`, `GET /badges` | `badges.ts` |
| Notifications | `GET/PUT /users/me/notification-prefs`, `GET /notifications/vapid-key`, `POST/DELETE /notifications/subscribe`, `GET /notifications/subscribed` | `notifications.ts` |
| Devices | `POST /devices`, `DELETE /devices/:token` | `devices.ts` |
| Recaps | `PATCH /users/me/recap-emails`, `GET /recaps`, `GET/POST /recaps/unsubscribe` | `recaps.ts` |
| Tasks/quests | `GET /tasks/suggest-points`, `GET/POST /tasks`, `POST /tasks/parse`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/complete`, `POST /tasks/:id/uncomplete`, `POST /tasks/:id/breakdown`, `POST /tasks/:id/difficulty[/snooze]`, `PATCH /tasks/:id/steps/:stepId`, `PATCH /tasks/:id/focus` | `tasks.ts` (largest route file) |
| Momentum | `GET /tasks/momentum` (**must be registered before `tasksRouter`** — `/tasks/momentum` vs `/tasks/:id` route-order hazard, see `routes/index.ts`) | `momentum.ts` |
| Recurring | `GET/POST/PATCH/DELETE /recurring-tasks`, `POST /recurring-tasks/:id/toggle` | `recurring-tasks.ts` |
| Questlines | `GET/POST/PATCH/DELETE /questlines`, `POST /questlines/:id/claim`, `POST /questlines/suggest-quests` | `questlines.ts` |
| Campaigns | `GET/POST/PATCH/DELETE /campaigns`, `PATCH /campaigns/:id/chapters`, `POST /campaigns/:id/claim`, `POST /campaigns/suggest-arc` | `campaigns.ts` |
| Battle/encounters | `GET /battle/current`, `POST /battle/enter`; `GET /encounter/current`; `GET /world-boss/current`, `POST /world-boss/attack`; `GET /party/encounters` | `battle.ts`, `encounter.ts`, `world-boss.ts`, `party.ts` |
| Bestiary / capital | `GET /bestiary`; `GET /capital` | `bestiary.ts`, `capital.ts` |
| Avatar / hero | `GET/PATCH /avatar` | `avatar.ts` |
| Gear / attunement | `GET /gear/store`, `GET /gear/inventory`, `POST /gear/:id/salvage`, `POST /gear/:id/buy`, `POST /gear/:id/equip`, `POST /gear/:id/unequip`, `POST /gear/:id/attune`, `POST /gear/:id/unattune` | `gear.ts` |
| Consumables | `GET /consumables`, `POST /consumables/:id/buy`, `POST /consumables/:id/activate` | `consumables.ts` |
| Stat perks | `GET /stat-perks`, `POST /stat-perks/:id/buy` | `stat-perks.ts` |
| Mystery box | `GET /mystery-box`, `POST /mystery-box/open` | `mystery-box.ts` |
| Coins / rewards store | `GET /coins`; `GET/POST/DELETE /rewards-store`, `POST /rewards-store/:id/redeem`; `GET/POST/DELETE /dopamine-rewards` | `coins.ts`, `rewards-store.ts`, `dopamine-rewards.ts` |
| Dungeon Master | `GET /dm/beat` (AI-narrated daily beat) | `dungeon-master.ts` |
| Accountability / social | `GET/POST /accountability/partners`, `.../accept\|decline`, `GET .../feed\|detail`, `POST .../nudge`, `GET /accountability/nudges` | `accountability.ts` |
| Body doubling | `GET /body-double/rooms/open`, `POST /body-double/rooms`, `.../join\|leave\|wave\|sprints\|sprints/:id/finish` | `body-double.ts` |
| Leaderboard | `GET /leaderboard/my-week`, `GET /leaderboard` | `leaderboard.ts` |
| Focus sessions | `GET /focus-sessions/presets\|active`, `POST/GET /focus-sessions`, `POST /focus-sessions/:id/interval\|complete` | `focus-sessions.ts` |
| Brain / reflection | `GET /brain/state`, `POST /brain/checkins`; `GET/POST /reflections/today`; `POST /rescue/events` | `brain.ts`, `reflections.ts`, `rescue.ts` |
| Calendar | `GET /calendar/heatmap` | `calendar.ts` |
| Shortcuts (Pocket Gate) | `GET/POST/DELETE /shortcut-tokens`; `POST /shortcuts/capture`, `GET /shortcuts/today` | `shortcut-tokens.ts`, `shortcuts.ts` |

## Authentication

- **Primary:** OIDC/OAuth (`openid-client`) against Auth0 (configurable issuer via `ISSUER_URL`, default Google) — discovery + auth-code flow in `routes/auth.ts` (`/login`, `/callback`), refresh in `middlewares/authMiddleware.ts`.
- **Session model:** server-side sessions in Postgres (`sessions` table), **not JWT** — a `sid` cookie holds a random session id; session data (`gameUserId`, tokens) is read from the DB. Logic in `src/lib/auth.ts` (`createSession`/`getSession`/`updateSession`/`deleteSession`/`refreshIfExpired`).
- **Mobile/iOS:** PKCE flow (`expo-auth-session` on RN, `ASWebAuthenticationSession` on iOS) exchanges the Auth0 authorization code at `POST /api/mobile-auth/token-exchange` for an **opaque FocusQuest session bearer token** — clients never see or store a raw Auth0 token. Stored in `expo-secure-store` (RN) / Keychain (iOS).
- **Secondary path — "shortcut tokens" (Pocket Gate):** bearer tokens prefixed `fqs_`, sha256-hashed and stored in `api_tokens`; a **default-deny allowlist** (`isShortcutRouteAllowed`/`evaluateShortcutAuth` in `src/lib/shortcut-token.ts`) permits only 3 whitelisted routes (`/shortcuts/capture`, `/shortcuts/today`, `POST /tasks/:id/complete`) — see `docs/ops/pocket-gate.md`.
- **CORS:** origin allowlist parsed from `ALLOWED_ORIGINS` env (comma-separated hostnames), credentials enabled — `artifacts/api-server/src/app.ts`.

## Events & Messaging

There is no message queue/pub-sub broker. "Events" here means scheduled/background work and outbound notification fan-out:

- **Cron tick** — `POST /api/cron/tick` (bearer `CRON_SECRET`) is the only background-job trigger, invoked by an **external** scheduler (cron-job.org primary; `.github/workflows/backup-cron.yml` GitHub Actions as a 5-minute fallback). `src/lib/notification-scheduler.ts`'s `tick()` runs, per invocation: `spawnRecurringTasks()` → `sweepBodyDoubleRooms()` → `runEnvelopePass()` (candidate push/email notifications) → `checkWeeklyRecaps()` → `pingHeartbeat()` (a healthchecks.io dead-man's-switch ping, fired only if the whole tick completed — see `docs/ops/steady-ground.md`).
- **Web Push (VAPID)** — `src/lib/push-notifications.ts` (`web-push` package) with an outbound push-service host allowlist for SSRF hardening; dispatch orchestration in `push-dispatch.ts`/`push-dispatch-live.ts`.
- **Expo Push** — `src/lib/expo-push.ts`, for the RN mobile client's device tokens.
- **iOS local notifications** — no server push at all for the native app; `ios/FocusQuest/Services/NotificationManager.swift` schedules on-device `UNCalendarNotificationTrigger` alerts (focus-phase-end, quest due-time) and `ActivityKit` Live Activities, reconciled on foreground rather than trusted from an in-process timer.
- All three push paths (Web Push, Expo, future APNs) are meant to converge behind a single `pushToUser()`/dispatch seam in `src/lib/`.

## External Integrations

| Integration | Purpose | Where | Gate/fallback |
|---|---|---|---|
| Auth0 (OIDC) | Login/identity for all three clients | `openid-client` in `routes/auth.ts`; iOS `Auth/OAuthWebSession.swift` | `ISSUER_URL`/`OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` |
| Google Gemini (`gemini-3.1-flash-lite`) | Text AI: smart parse, task breakdown, questline drafting, difficulty variants, reflection prompts, Dungeon Master narration, campaign arcs, weekly recap copy | `artifacts/api-server/src/lib/ai/client.ts` (+ `dungeon-master.ts`, `campaign-arc.ts`, `task-breakdown.ts`, `weekly-recap.ts`, `questline-quests.ts`, `reflection.ts`, `difficulty-variants.ts`, `quick-add-parse.ts`) | `GEMINI_API_KEY` unset ⇒ feature returns 503, rest of the app runs normally |
| Groq Whisper (`whisper-large-v3-turbo`) | Voice quick-add transcription | `src/lib/ai/transcribe-audio.ts`, called from `routes/tasks.ts` | `GROQ_API_KEY` unset ⇒ 503 |
| Resend | Weekly recap emails | `src/lib/email/send-email.ts` + `render-recap.ts` | `RESEND_API_KEY` |
| web-push (VAPID) | Browser push notifications | `src/lib/push-notifications.ts` | `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_EMAIL` |
| cron-job.org + GitHub Actions | Scheduling the cron tick | external + `.github/workflows/backup-cron.yml` | `CRON_SECRET` |
| healthchecks.io | Dead-man's-switch alerting on a stalled scheduler | `src/lib/heartbeat.ts` | `HEARTBEAT_URL` (unset = no-op) |
| Render API (optional, local tooling only) | `pnpm --filter @workspace/scripts render-status` reads deploy status/logs | `scripts/src/render-status.ts` | `RENDER_API_KEY`, `RENDER_SERVICE_ID` — never set on Render itself |
| Supabase Postgres pooler | Database hosting (implied by the bundled CA cert) | `lib/db/src/ssl.ts`, `lib/db/certs/` | `DATABASE_URL`, `DATABASE_CA_CERT_PATH` |
