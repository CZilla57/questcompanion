# Directory Structure

*Last Updated: 2026-09-08*

## Organizing Principle

A **pnpm workspace monorepo** organized as `artifacts/*` (deployable apps) + `lib/*` (shared packages) + `lib/integrations/*` (reserved, currently empty) + `scripts` (one-off/ops scripts), per `pnpm-workspace.yaml`. Each app/package is internally **layer-based** (`routes/`+`lib/` in the API server; `pages/`+`components/`+`lib/` in the web app; `Features/`+`Services/` in iOS) rather than feature-folder-based — RPG systems like bestiary/capital/gear/feats are cross-cutting concerns named by file, not by directory.

`ios/` is a sibling native Xcode project, **not** part of the pnpm workspace (no `package.json`), but shares the same backend and Auth0 app as everything under `artifacts/`.

## Root Layout

```
questcompanion/
├── artifacts/                 # deployable apps (pnpm workspace glob `artifacts/*`)
│   ├── api-server/            # Express API — the production backend
│   ├── focusquest/            # React/Vite web PWA — the production frontend
│   ├── focusquest-mobile/     # Expo/React Native iOS client (early-phase, pre-parity)
│   └── mockup-sandbox/        # dev-only shadcn/ui component sandbox (out of scope for prod)
├── lib/                       # shared packages (glob `lib/*`)
│   ├── api-client-react/      # generated: TanStack Query hooks (from lib/api-spec/openapi.yaml)
│   ├── api-spec/              # openapi.yaml (hand-authored contract) + orval codegen config
│   ├── api-zod/               # generated: Zod schemas + TS types (from the same openapi.yaml)
│   ├── auth-web/              # useAuth() cookie/session hook for the web app
│   ├── db/                    # Drizzle ORM schema, migrations, DB client
│   ├── hero-options/          # pure hero customization option catalogs
│   ├── pomodoro/               # pure focus-timer/pomodoro logic
│   ├── quick-add/              # pure natural-language quick-add parser
│   └── integrations/          # reserved workspace glob (`lib/integrations/*`) — currently empty
├── ios/                        # native SwiftUI iOS app — SEPARATE Xcode project, not in pnpm workspace
│   ├── FocusQuest/             # main app target
│   ├── FocusQuest.xcodeproj/
│   ├── FocusQuestWidgets/      # widget + Live Activity extension target
│   ├── Shared/                 # code compiled into both the app and widget targets
│   ├── scripts/                # ios/scripts/build-hero-assets.mjs (asset bridge from the web app)
│   └── Config.xcconfig / Config.local.xcconfig   # build-time config (no secrets in source)
├── scripts/                    # workspace package `@workspace/scripts` — ops/seed/build CLIs
├── docs/
│   ├── superpowers/plans/      # ~64 dated implementation plans (one per feature)
│   ├── superpowers/specs/      # ~55 dated design specs (paired with many plans)
│   └── ops/                    # pocket-gate.md, steady-ground.md — operational runbooks
├── attached_assets/            # legacy Replit-imported design assets (sprite art, pasted specs)
├── .github/workflows/          # ci.yml (typecheck/build/iOS build), backup-cron.yml
├── Dockerfile                  # multi-stage build: deps → build-frontend/build-api → production
├── render.yaml / railway.json   # deploy configs (Render primary, Railway alternate)
├── threat_model.md             # STRIDE-style security threat model
├── pnpm-workspace.yaml          # workspace globs + shared dependency `catalog:`
├── tsconfig.base.json / tsconfig.json   # shared TS compiler options + project-reference graph
└── .env.example                 # documents every server env var (names only)
```

## Key Directories

### artifacts/api-server/src/
- `routes/` — one Express router per feature area, ~44 files (`tasks.ts`, `gear.ts`, `bestiary.ts`, `campaigns.ts`, `world-boss.ts`, …). Thin: auth check, parse request, call into `lib/`, shape JSON response.
- `lib/` — ~150 files of actual domain/game logic, almost every one paired with a sibling `*.test.ts` (e.g. `roll-engine.ts` + `roll-engine.test.ts`). This is where DB queries and game-rule math live — no separate "service"/"controller" layer.
  - `lib/ai/` — Gemini prompt-building + Groq transcription client.
  - `lib/email/` — Resend email rendering/sending.
- `middlewares/authMiddleware.ts` — the single global auth middleware (session + shortcut-token).
- `index.ts` / `app.ts` — process entry / Express app assembly (see `entry-points.md`).
- `migrate.ts` / `seed-gear.ts` — standalone scripts, bundled as separate esbuild entry points, run at container boot.

### artifacts/focusquest/src/
- `pages/` — one file per route, ~20 files (`now.tsx`, `tasks.tsx`, `bestiary.tsx`, `avatar.tsx`, …), thin containers around generated API hooks.
- `components/` — flat, ~48 shared/domain components (no per-feature subfolders) plus a `components/ui/` subdirectory of shadcn/ui primitives (~50 files).
- `hooks/` — small reusable hooks (`use-consumables.ts`, `use-outbox.ts`, `use-pwa-install.ts`, …), 13 files.
- `lib/` — the largest layer: pure logic/domain modules with co-located `*.test.ts`, plus `lib/hero/` (hero rendering/catalog) and `lib/outbox/` (offline mutation queue) subfolders.
- `App.tsx` / `main.tsx` — composition root / mount point (see `entry-points.md`).
- `dm-beat-harness.tsx` / `hero-harness.tsx` — dev-only harness entry points outside normal routing.

### lib/db/src/
- `schema/` — one file per table, ~35 files, barrel-exported from `schema/index.ts`. See `database.md`.
- `index.ts` — `pg.Pool` + Drizzle client setup (exports `db`, `pool`).
- `migrate.ts` / `migrate-cli.ts` — migration runner (used both by api-server at boot and by the `pnpm migrate` CLI).
- `ssl.ts` — TLS config for the Postgres connection (bundled Supabase CA cert).
- `gear-catalog.ts` — hand-authored gear roster/power formulas (seed data + shared power math).
- `drizzle/` — generated SQL migrations (`0000_baseline.sql` … `0018_last_thing.sql`) + `meta/` snapshots.

### lib/api-zod/src/generated/ and lib/api-client-react/src/generated/
Both are **fully generated** by orval from `lib/api-spec/openapi.yaml` (`pnpm --filter @workspace/api-spec codegen`) — never hand-edit anything under either `generated/` directory. `api-zod` splits into ~325 per-schema files under `generated/types/`; `api-client-react` emits one `generated/api.ts` (React Query hooks) and `generated/api.schemas.ts` (plain TS types).

### ios/FocusQuest/
- `App/` — app entry, root routing, tab bar, `AppConfig`.
- `Auth/` — Auth0 PKCE flow (`ASWebAuthenticationSession`), Keychain wrapper, `AuthManager`.
- `Networking/` — the single `APIClient` actor + `APIError`.
- `Models/` — Codable models mirroring the OpenAPI schemas.
- `Services/` — typed API call groups per resource (`QuestService`, `FocusService`, …) plus non-networking services (`NotificationManager`, `FocusActivityController`, `QuestNudgeScheduler`, `SpeechRecognizer`).
- `Features/` — one folder per screen area (`Hero/`, `Quests/`, `Focus/`, `Rewards/`, `Social/`, `Brain/`, `Settings/`, …), MVVM (View + `@MainActor` view model where state warrants one).
- `DesignSystem/` — theme tokens + reusable SwiftUI components.
- `Support/` — `Loadable<Value>` state helper, date utilities, haptics.
- `Intents/` — App Intents / Siri Shortcuts (`AddQuestIntent`).

### docs/superpowers/
Dated markdown design history — `plans/YYYY-MM-DD-<feature>.md` (implementation plans, often multi-phase) paired with `specs/YYYY-MM-DD-<feature>-design.md` (the design rationale). Reading the relevant dated doc before touching a feature area is the fastest way to recover the "why" behind a mechanic — this is the project's primary design-history record, not just historical trivia. Recent entries (`2026-09-06` through `2026-09-08`) document a five-"Act" RPG-depth roadmap (roll engine → encounters/party → living-world narrative → consumables/tactics → capital/feats/bestiary collection).
