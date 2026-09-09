# Architecture

*Last Updated: 2026-09-08*

## Summary

FocusQuest (repo: **questcompanion**) is a gamified, ADHD-focused task/habit companion built as a **pnpm workspace monorepo**. One Express API server (`artifacts/api-server`) backed by PostgreSQL (via Drizzle ORM, `lib/db`) is the single source of truth for every client: a React/Vite installable PWA (`artifacts/focusquest`, the most complete and primary client), a native SwiftUI iOS app (`ios/FocusQuest`, a separate Xcode project sharing the same backend/Auth0 app), and an earlier-phase Expo/React Native client (`artifacts/focusquest-mobile`). All clients authenticate through Auth0 (OIDC + PKCE) and exchange a code for the same kind of opaque, server-issued session bearer token — there is no client-trusted business logic; XP, streaks, rolls, and rewards are always computed server-side.

On top of the base habit-tracking loop (quests/tasks, streaks, badges, focus/Pomodoro sessions, calendar heatmap, accountability partners, body-doubling) the product layers an incrementally-built **D&D-style RPG progression system**: derived ability scores and a seeded d20 roll engine, personal and shared (party) monster encounters that make up a discoverable bestiary, a growing "capital"/kingdom home base, class-based feat trees with free respec, an expanded gear/attunement/inventory/salvage system, consumables, loot tables, and an AI Dungeon Master that narrates it all. This RPG layer was built out in a sequence of dated "Act" plans (see `docs/superpowers/plans/`) under one **non-negotiable design law**: every mechanic is upside-only — no penalty, debuff, or shame-inducing copy is ever allowed, only reframed setbacks or added benefit.

The API contract (`lib/api-spec/openapi.yaml`) is the connective tissue between the server and the TypeScript clients: it is hand-authored first, then `orval` code-generates both the server's Zod validation types (`lib/api-zod`) and the web app's typed React Query hooks (`lib/api-client-react`) from it. The iOS app hand-mirrors the same contract in Swift, since it sits outside the TypeScript/orval pipeline.

## High-Level Diagram

```
                         ┌───────────────────────────┐
                         │   lib/api-spec/openapi.yaml │  (hand-authored contract)
                         └─────────────┬─────────────┘
                            orval codegen (pnpm --filter @workspace/api-spec codegen)
                    ┌───────────────────┴───────────────────┐
                    ▼                                        ▼
        lib/api-zod (Zod schemas)                lib/api-client-react (RQ hooks)
                    │                                        │
                    ▼                                        ▼
        ┌─────────────────────────┐          ┌───────────────────────────────┐
        │  artifacts/api-server   │◄────────►│  artifacts/focusquest (web)   │
        │  Express 5 + Drizzle    │   /api   │  React 19 + Vite + wouter     │
        │  routes/ + lib/         │          │  (production PWA)             │
        └────────────┬────────────┘          └───────────────────────────────┘
                      │                                        ▲
                      │ Drizzle ORM                            │ shared hooks
                      ▼                                        │
             ┌─────────────────┐            ┌───────────────────────────────┐
             │  lib/db (schema) │            │ artifacts/focusquest-mobile   │
             │  → PostgreSQL    │            │ Expo/React Native (early)     │
             └─────────────────┘            └───────────────────────────────┘

                      ▲  same REST API + Auth0 app, hand-mirrored contract
                      │
             ┌─────────────────────────┐
             │       ios/FocusQuest     │   + ios/FocusQuestWidgets (widgets/Live Activity)
             │  Swift/SwiftUI, no SPM   │
             └─────────────────────────┘

  External services (called directly over HTTP from api-server, not via clients):
  Auth0 (OIDC/PKCE) · Google Gemini (text AI) · Groq Whisper (voice) · Resend (email)
  · web-push/VAPID + Expo Push (notifications) · cron-job.org + GitHub Actions (scheduling)
  · healthchecks.io (dead-man's switch) · Render/Railway (hosting, Docker)
```

## Components

- **`artifacts/api-server`** — Express 5 API, the security/business-logic boundary (per `threat_model.md`: "all state-changing behavior must be enforced server-side"). Owns auth, all game/reward math, scheduling, and every third-party integration. Talks to `lib/db` directly (no repository layer) and validates select request/response shapes with `@workspace/api-zod`. See `communication.md`, `database.md`.
- **`artifacts/focusquest`** — the production web PWA. React Query hooks generated from the OpenAPI spec do all data fetching; `@workspace/auth-web` handles cookie/session auth; an offline "outbox" queues mutations made while offline. See `modules.md`.
- **`ios/FocusQuest`** — native SwiftUI client with broad feature parity, MVVM-per-screen, a single `APIClient` actor, PKCE via `ASWebAuthenticationSession`, Keychain token storage, on-device local notifications + Live Activities (no APNs backend yet). Companion `FocusQuestWidgets` extension shares state via an App Group. See `modules.md`.
- **`artifacts/focusquest-mobile`** — Expo/React Native client from the project's iOS foundation-spike phase (auth, focus timer, deep-link routing, push registration). Superseded in priority by the native iOS app for reaching feature parity, per `docs/superpowers/specs/2026-08-11-ios-app-roadmap.md`.
- **`lib/db`** — Drizzle ORM schema (~35 tables) + migrations, the persistence boundary shared by every server-side consumer.
- **`lib/api-spec` / `lib/api-zod` / `lib/api-client-react`** — the OpenAPI-driven contract pipeline described above.
- **`lib/hero-options` / `lib/pomodoro` / `lib/quick-add`** — small, pure, cross-client TypeScript logic packages (customization catalogs, focus-timer cycles, NL quick-add parsing) — the only genuinely shared business logic between server and web/RN clients; iOS reimplements equivalent rules natively.
- **`scripts`** — operational CLIs (seeding, asset building, Render deploy inspection).
- **`artifacts/mockup-sandbox`** — dev-only shadcn/ui design sandbox, explicitly out of production scope.

## Data Flow

A representative flow (quest completion) is traced end-to-end in `entry-points.md`. In short: **client → Express route (thin, auth-checked) → pure `lib/*` game-logic functions (roll engine, rewards, progression) → Drizzle transaction against Postgres, with a reversible completion snapshot → JSON response validated against the OpenAPI-generated contract → client cache invalidation → best-effort async push/email notification.**

Background work (recurring-task spawning, notification fan-out, weekly recaps) is not an in-process scheduler — it's driven by an **external cron hitting `POST /api/cron/tick`** (cron-job.org primary, GitHub Actions backup), with a healthchecks.io ping confirming the whole tick completed.

## Key Decisions & Constraints

- **Server is the single source of truth for game rules across all clients** — no client (web, iOS, RN) is trusted to compute XP, rolls, or rewards; this is a stated security constraint (`threat_model.md`), not just a style preference.
- **OpenAPI-first, codegen-driven contract** — `openapi.yaml` is hand-edited before code; generated output is never hand-edited. This is the actual dependency graph between server and TS clients.
- **Anti-shame, upside-only design law** — a deliberate product constraint that shapes almost every RPG mechanic added since the "Act" roadmap began; see `patterns.md` for how it's tested/enforced.
- **No message broker / job queue** — all "background" work is one HTTP endpoint (`/api/cron/tick`) triggered externally; there is no in-process `setInterval`/`node-cron`, and cross-instance duplication of scheduled work is a named threat in `threat_model.md` (mitigated by DB-level unique-index dedup, not distributed locks).
- **iOS has no server push yet** — Phases 1–5 of the current iOS program are deliberately local-notification-only (`UNUserNotificationCenter`/`ActivityKit`); adding real APNs push is an explicit, not-yet-done follow-on (device-token schema already exists server-side for Expo).
- **No linter/formatter enforced** — TypeScript's own strict compiler settings (`tsconfig.base.json`) are the enforced correctness bar in CI, not ESLint/Prettier (neither is configured beyond `prettier` being an unused devDependency).
- **pnpm workspace discipline is load-bearing, not cosmetic** — the root `preinstall` script actively hard-fails under npm/yarn, and `minimumReleaseAge`/dependency `catalog:` centralization are enforced conventions, not suggestions.
