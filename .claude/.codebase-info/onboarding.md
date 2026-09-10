# Onboarding

*Last Updated: 2026-09-08*

## Prerequisites

- **Node 24** and **pnpm 11.11.0** (`packageManager` pinned in root `package.json`; enable via `corepack enable`). The root `preinstall` script hard-fails under npm/yarn — use pnpm for everything.
- A **PostgreSQL** database reachable via `DATABASE_URL` (no local Docker Postgres is provided in this repo — bring your own instance).
- An **Auth0** (or other OIDC) application for login, for anything beyond the health check.
- For iOS work: **Xcode 16+**, iOS 17 simulator/device.
- For mobile (Expo) work: an Expo account/dev-client setup (see `artifacts/focusquest-mobile/package.json`).
- Optional (features degrade gracefully without them): `GEMINI_API_KEY`, `GROQ_API_KEY`, `RESEND_API_KEY`, VAPID keys.

## Quick Start

```bash
git clone <repo>
cd questcompanion
pnpm install                                   # installs the whole workspace
cp .env.example artifacts/api-server/.env      # fill in DATABASE_URL, OAUTH_*, etc.
pnpm --filter @workspace/db run migrate        # apply migrations to your DB
pnpm --filter @workspace/api-server run dev    # API on the configured PORT
pnpm --filter @workspace/focusquest run dev    # web app via Vite, in another terminal
```

For iOS: `open ios/FocusQuest.xcodeproj`, copy `ios/Config.xcconfig` to `ios/Config.local.xcconfig` and fill in `FQ_API_HOST`/`FQ_AUTH0_*`, select the **FocusQuest** scheme, run on an iOS 17+ simulator/device.

## Common Commands

| Command | Purpose |
|---------|---------|
| `pnpm run typecheck` (root) | Typecheck every `lib/*` project reference + `artifacts/*`/`scripts` |
| `pnpm run build` (root) | Typecheck, then build every package that has a `build` script |
| `pnpm --filter @workspace/api-server run test` | Run the API server's Vitest suite |
| `pnpm --filter @workspace/focusquest run test` | Run the web app's Vitest suite |
| `pnpm --filter <pkg> run typecheck` | Typecheck a single package |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate `api-zod` + `api-client-react` from `openapi.yaml` |
| `pnpm --filter @workspace/db run generate` | Generate a new Drizzle migration from schema changes |
| `pnpm --filter @workspace/db run migrate` | Apply pending migrations |
| `pnpm --filter @workspace/scripts run seed-gear` / `seed-badges` | Seed catalog tables |
| `pnpm --filter @workspace/scripts run render-status` | Inspect recent Render deploys/logs (read-only, local tooling) |
| `xcodebuild build -project ios/FocusQuest.xcodeproj -scheme FocusQuest -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO` | CI-equivalent iOS build check |

## Common Tasks

- **Add/change an API endpoint:** edit `lib/api-spec/openapi.yaml` first → `pnpm --filter @workspace/api-spec run codegen` → implement the route in `artifacts/api-server/src/routes/*.ts` (register in `src/routes/index.ts`, mind route-ordering hazards like `/tasks/momentum` vs `/tasks/:id`) + logic in `src/lib/*.ts` with a co-located `*.test.ts` → consume the regenerated hook in `artifacts/focusquest/src/pages|components` and (manually) mirror it in `ios/FocusQuest/Models|Services`.
- **Add a new game mechanic (RPG layer):** read the relevant dated plan/spec under `docs/superpowers/plans|specs/` first — most new mechanics "reconcile the roadmap against what ships" before adding anything. Reuse `roll-engine.ts`'s seeded PRNG instead of adding a new random source. Every reward/roll must stay upside-only (anti-shame law) — extend the `xp-monotonicity`-style tests, never weaken them.
- **Change the DB schema:** edit `lib/db/src/schema/*.ts` → `pnpm --filter @workspace/db run generate` → review/commit the generated SQL under `lib/db/drizzle/` and its `meta/` snapshot together → `pnpm --filter @workspace/db run migrate` locally to verify. Never use `drizzle-kit push` (documented as removed/unsafe for this project).
- **Run just one test file:** `pnpm --filter @workspace/api-server exec vitest run src/lib/<file>.test.ts` (same pattern for other packages).
- **Verify before calling anything done:** `pnpm run typecheck` from root, plus the touched package's own tests; for iOS, an actual build/run in Xcode — a description of expected behavior is not sufficient (see `.claude/live-rules/rules/verify-before-done.md`).

## Gotchas

- **pnpm only** — the root `preinstall` deletes stray `package-lock.json`/`yarn.lock` and fails outside pnpm.
- **`minimumReleaseAge: 1440`** — pnpm refuses to install a package version published less than 24h ago; pin to a slightly older patch if `pnpm install` unexpectedly rejects a version.
- **Generated code is generated** — never hand-edit `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`, or `lib/db/drizzle/*.sql` (the last one only after it's been reviewed/committed once — before that it's meant to be edited via re-running `generate`, not by hand).
- **`ios/Config.local.xcconfig` is currently tracked in this repo** with a real dev Auth0 tenant / Render host pointed at it, despite being described as gitignored-in-spirit — check `git status`/`.gitignore` before assuming it's safe to commit further changes to that file, and never put production secrets in it.
- **iOS is built/pushed from Linux CI and has never been compiled in Xcode by its authors** (per `ios/README.md`) — expect small fixes on the first local `⌘B`. There are no iOS test targets at all; CI only does a simulator `xcodebuild build`, never `xcodebuild test`.
- **`artifacts/focusquest-mobile` (Expo/RN) is an earlier, less-complete mobile track** than `ios/FocusQuest` (native SwiftUI) — don't assume RN is the active iOS client; check the current branch/roadmap doc if unsure which one a task means.
- **No linter is configured** (see `coding-style.md`) — `pnpm run typecheck` is the enforced CI bar, not ESLint/Prettier.
- **The web app's PWA service worker never intercepts `/api/*`** — offline-mutation handling goes through the app-level "outbox" (`src/lib/outbox/`), not the service worker; don't add API caching to `public/sw.js` expecting it to help offline writes.
- **`attached_assets/` is legacy Replit-era import** (sprite art, pasted feature specs) — not part of the build (excluded via `.dockerignore`); treat it as historical reference, not a source of truth.
