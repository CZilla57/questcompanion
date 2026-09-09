# Patterns & Conventions

*Last Updated: 2026-09-08*

## Code Organization

- **Pure-logic lib + thin route**, applied consistently across both `artifacts/api-server/src/lib/` and `artifacts/focusquest/src/lib/`: business/game logic lives in plain, dependency-injected functions; the Express route (or React page/component) is a thin adapter that authenticates, parses input, calls the lib function, and shapes the response. There is deliberately no `controllers/`/`services/`/`models/` layering — see `directory-structure.md`.
- **Almost every logic file has a co-located `*.test.ts` sibling** (e.g. `roll-engine.ts` + `roll-engine.test.ts`, `feature-gates.ts` + `feature-gates.test.ts`). This is the primary correctness mechanism, not a validation-middleware layer — see Testing below.
- **The OpenAPI spec is upstream of the code, not derived from it.** `lib/api-spec/openapi.yaml` is hand-edited first; `pnpm --filter @workspace/api-spec codegen` regenerates `lib/api-zod` and `lib/api-client-react`. Never add a new endpoint by writing the route first and back-filling the spec — see `docs/superpowers/plans/*` for how features are actually sequenced ("server-first... exposed through OpenAPI → regenerated api-zod + api-client-react, then web + iOS off the same generated types").
- **Derive at read time instead of storing computed state.** Level, kingdom/capital tier, active-boost status ("is `xpBoostExpiresAt` non-null and in the future?"), unlocked feats (from class + level), and "ready-to-claim" statuses are all computed on read, not written by a cron sweep. When adding a new derived value, prefer this pattern over a stored+synced column.
- **Atomic invariants live in the schema, not just the route.** "Exactly one active X" or "once per period" rules are enforced with partial/composite unique indexes (one running campaign per user, one un-felled personal encounter, one world-boss attack per user per day) — "the insert is the guard," per code comments in `lib/db/src/schema/world-boss.ts`. Prefer this over an application-level lock when adding a similar constraint.
- **Completion snapshotting for reversibility.** `tasks.pointsAwarded`/`coinsAwarded`/`badgesGrantedIds`/`gearGrantedIds`/etc. are written at completion time so `/uncomplete` can reverse *exactly* what was granted, rather than recomputing. Any new reward type given on completion should follow this snapshot-then-reverse shape.

## Recurring Patterns

- **The "anti-shame" / upside-only design law** — the single most important cross-cutting convention in this codebase, stated explicitly in nearly every recent plan doc (e.g. `docs/superpowers/plans/2026-09-06-dnd-campaign-layer.md`, `2026-09-07-attunement.md`, `2026-09-08-dnd-act4-tactics-stakes.md`): no mechanic may ever produce a penalty, debuff, guilt-inducing copy ("warning", "you didn't"), or an XP/level/streak/coin *decrease*, except the one explicit, fully-reversible `/uncomplete` transaction. A "missed" roll, a locked feat, a cooldown, or "no loot" must always read as neutral or as reframed upside, never as failure. This is enforced by tests named things like `xp-monotonicity.test.ts` — extend these tests, never weaken them, when adding a new roll/reward mechanic.
- **Seeded, deterministic randomness.** `artifacts/api-server/src/lib/roll-engine.ts` is the one PRNG in the codebase (a seeded `hashSeed`/`seededUnit` pair); loot tables, skill checks, and other "chance" mechanics derive their randomness from stable inputs (encounter id + tier + user, etc.) rather than `Math.random()`, so a result is fair, deterministic, and cannot be improved by refetching.
- **Feature-gated progressive unlock ("Gentle Door").** `feature-gates.ts` (server) / `src/lib/feature-gates.ts` (web) derive which routes/pages a user can see from server-reported `unlockedFeatures`, keyed off account age/level rather than a client-side flag; the web router's `withGate(featureKey, Page)` HOC (`artifacts/focusquest/src/App.tsx`) redirects ungated routes to `/`.
- **"Act"-labeled incremental delivery.** Comments and route/lib names reference "Act I…VII" and, most recently, a five-"Act" RPG-depth roadmap (`docs/superpowers/plans/2026-09-06-dnd-campaign-layer.md` through `2026-09-08-dnd-act5-depth-collection.md`). New RPG-layer work is expected to "reconcile the roadmap against what ships" before adding anything — these plan docs explicitly audit what already exists before proposing new mechanics; read the relevant one before building a new game-progression feature.
- **Server-first, multi-client parity.** New game mechanics land in `artifacts/api-server` + the OpenAPI spec first, then render on web and iOS off the same generated/hand-mirrored types — "no mechanic is native-only." iOS `Models/`/`Services/` are hand-maintained mirrors of the OpenAPI schemas since Swift isn't part of the orval pipeline; keep them in sync manually when the contract changes.
- **Offline-first mutation queue ("outbox").** The web app's `src/lib/outbox/{core,api,store,replay}.ts` is a storage-agnostic 4-method interface for queuing mutations made while offline and replaying them on reconnect — this is the intended extension point for a future SQLite-backed mobile outbox (per `docs/superpowers/specs/2026-08-11-ios-app-roadmap.md`), not the service worker.

## Error Handling

- **No global Express error-handling middleware.** Errors are handled per-route with local `try/catch`; manual guard clauses return explicit status codes (`401` unauthenticated, `403` ownership/level-gate failure, `404` missing entity, `409` state conflict e.g. "already owned"/"unequip before salvaging", `500` in catch blocks around DB/business-logic calls).
- **Request validation is mostly manual**, not a pervasive zod-middleware layer: bodies are destructured with an inline type-cast and checked with `if (!field) res.status(400)...`. `@workspace/api-zod` schemas are used for validation in specific spots (notably auth: `GetCurrentAuthUserResponse`, `ExchangeMobileAuthorizationCodeBody`) rather than on every route body.
- **iOS** maps any 401 from `APIClient` to an automatic sign-out via `AuthManager`; errors surface through `APIError` and the `Loadable<Value>` enum / shared `AsyncContentView` for loading/error/loaded UI states.

## Testing

- **Vitest everywhere** in the TypeScript packages — no Jest, no Mocha. Convention: co-located `*.test.ts` next to the module it tests (not a separate `__tests__/` or `test/` directory).
- **api-server tests** (`artifacts/api-server/src/lib/*.test.ts`) are pure unit tests — no `supertest`, no live DB; network/DB boundaries are injected so they can be stubbed (e.g. Gemini/Groq/Expo-push calls take an injected `fetch`).
- **focusquest tests** (`artifacts/focusquest/src/lib/**/*.test.ts`) run with `environment: "node"` (not jsdom) — testing is concentrated on the pure-logic `lib/` layer; there is no component/rendering test suite under `src/components/`, `src/pages/`, or `src/hooks/`.
- **iOS has no test targets at all** (`find ios -iname "*Test*"` returns nothing; CI runs `xcodebuild build`, never `test`) — a real gap; a manual on-device `⌘R` check is the only verification for iOS changes today (see `.claude/live-rules/rules/verify-before-done.md`).
- Run tests per-package: `pnpm --filter @workspace/api-server run test`, `pnpm --filter @workspace/focusquest run test`, etc. (all wrap `vitest run`).

## Configuration

- **Env vars** are the only configuration mechanism for the server — read directly via `process.env` in the owning `lib/` file, loaded via `dotenv` in dev. `.env.example` (repo root) documents every server-side var by name (never values); see `docker.md` for the full list.
- **iOS config** lives in `ios/Config.xcconfig` (tracked template) + `ios/Config.local.xcconfig` (real values, gitignored-in-spirit — a real dev-tenant copy happens to be tracked in this repo currently, see `onboarding.md` gotchas), injected into `Info.plist` and read by `AppConfig.swift`.
- **Feature flags** are server-derived (`unlockedFeatures` on the stats payload / `feature-gates.ts`), not env vars or a client-side config file.
- **Shared dependency versions** are pinned once in `pnpm-workspace.yaml`'s `catalog:` block (kept in sync with `pnpm.overrides` in the root `package.json` — both must match the lockfile per an inline comment) rather than per-package.
