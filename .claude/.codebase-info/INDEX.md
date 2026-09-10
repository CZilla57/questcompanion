# Codebase Map — QuestCompanion (FocusQuest)

*Last Updated: 2026-09-08*

FocusQuest is a gamified, ADHD-focused task/habit companion with a D&D-style RPG progression layer (bestiary, capital, feat trees, gear/attunement, consumables, an AI Dungeon Master) built incrementally as a dated "Act" roadmap. One Express/Postgres API serves three clients: a React PWA (primary), a native SwiftUI iOS app, and an earlier-phase Expo/React Native app.

**Stack:** TypeScript (Express 5 + React 19/Vite + Drizzle ORM/PostgreSQL) · Swift/SwiftUI (native iOS) · pnpm workspace monorepo
**Shape:** monorepo (`artifacts/*` apps + `lib/*` shared packages) with one OpenAPI-spec-driven contract pipeline, plus a separate native iOS Xcode project

## Documents

| Document | What's inside |
|----------|---------------|
| [architecture.md](./architecture.md) | System overview, components, data flow, key decisions/constraints |
| [tech-landscape.md](./tech-landscape.md) | Languages, frameworks, infra, source-of-truth files |
| [directory-structure.md](./directory-structure.md) | Annotated root + per-package folder tree |
| [entry-points.md](./entry-points.md) | Process/app entry points, key HTTP routes, a traced completion flow |
| [modules.md](./modules.md) | Every workspace package + app + iOS target: purpose, deps, exports |
| [communication.md](./communication.md) | Full API route table, auth model, background jobs, external integrations |
| [database.md](./database.md) | Drizzle schema (~35 tables) by subsystem, migrations, relationships |
| [dependencies.md](./dependencies.md) | Categorized runtime/dev packages, pinned-version notes |
| [patterns.md](./patterns.md) | Pure-lib+thin-route convention, anti-shame design law, testing, error handling |
| [coding-style.md](./coding-style.md) | Naming conventions (no linter/formatter is configured) |
| [docker.md](./docker.md) | Dockerfile stages, Render/Railway deploy config, env vars (names only) |
| [onboarding.md](./onboarding.md) | Quick start, common commands/tasks, gotchas |

## How to use this map

- New here? Read `onboarding.md` then `architecture.md`.
- Building a new game mechanic? Read the relevant dated plan/spec under `docs/superpowers/plans/` or `docs/superpowers/specs/` first — most new RPG-layer work explicitly reconciles against what's already shipped.
- Before touching code, skim the doc(s) for the area you're changing — these docs hold concrete file paths, use them to navigate straight to the relevant code.
- `ios/` is a separate Xcode project (not in the pnpm workspace) sharing the same backend/Auth0 app — see `modules.md` and `docker.md`/`onboarding.md` for its build path.

## Keeping this map current

After a change that affects architecture, directory structure, dependencies, the data model, entry points, APIs/events, or conventions, refresh the affected docs with the `update-codebase-map` skill (`/codebase-mapper:update-codebase-map`). Small, internal-only changes don't need an update.
