# FocusQuest / questcompanion

A gamified (D&D-style RPG) ADHD productivity app. Quests = tasks; completing them earns
XP, coins, gear, and levels. Three user-facing surfaces plus shared libraries, in one
**pnpm workspace monorepo** (pnpm only — `npm`/`yarn` are blocked by a `preinstall` guard).

## Layout

- `artifacts/api-server` — TypeScript/Express API. **Source of truth for all game logic.**
  Route handlers in `src/routes`, pure logic in `src/lib` (leveling, gear, loot, battle,
  quests, etc.). Tests are Vitest, colocated as `*.test.ts`.
- `artifacts/focusquest` — the web app: React 19 + Vite + wouter + TanStack Query +
  Tailwind 4. Components in `src/components`, pages in `src/pages`. It renders game state
  (level, gear, `meetsLevel`, etc.) straight from the API — it does **not** re-implement
  game rules.
- `ios/FocusQuest` — the **native Swift app, and the active mobile target.** Features in
  `Features/`, models in `Models/`, networking in `Services/`. Widgets in
  `ios/FocusQuestWidgets`. Like web, it renders API-computed state; no client-side rules.
- `artifacts/focusquest-mobile` — the older React Native app. **Not the active target** —
  don't build here unless explicitly asked.
- `lib/*` — shared workspace packages: `lib/db` (Drizzle schema + `gear-catalog.ts`),
  `lib/api-spec` / `lib/api-zod` (the API contract + generated Zod/TS types),
  `lib/api-client-react`, `lib/auth-web`, plus feature libs (`hero-options`, `pomodoro`,
  `quick-add`).
- `scripts/` — seed/build scripts (e.g. `seed-gear.ts`).

## Commands (run from repo root)

- Typecheck everything: `pnpm run typecheck`  •  Build everything: `pnpm run build`
- API-server tests: `pnpm --filter ./artifacts/api-server test`  (or `cd` in + `npx vitest run`)
- Web tests: `pnpm --filter ./artifacts/focusquest test`
- Per-package typecheck: `pnpm --filter <pkg> typecheck`
- iOS build (simulator):
  `cd ios && xcodebuild -project FocusQuest.xcodeproj -scheme FocusQuest -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build`

## Gotchas (bite people repeatedly)

- **Game rules live on the server.** Leveling is `artifacts/api-server/src/lib/gamification.ts`;
  `getLevelInfo` is a pure function of `totalPoints`. Web + iOS never carry their own level
  tables — change the server and clients follow. A cross-surface feature usually ships
  server + web + iOS together (keep them at parity).
- **Drizzle migrations:** committing a migration means committing `meta/_journal.json` **and**
  the snapshot, not just the `.sql`, or the journal desyncs.
- **iOS API host:** the real host lives in `ios/Config.local.xcconfig` — gitignore-*listed*
  but actually tracked/committed (present after any checkout). `Config.xcconfig` holds the
  `api.example.com` placeholder.
- **pnpm overrides** are duplicated in `pnpm-workspace.yaml` and root `package.json` on
  purpose (different pnpm versions read different files) — keep them in sync with the lockfile.

## Workflow

- Branch + PR for changes (`gh pr create`). Don't commit workspace-config files (this
  `CLAUDE.md`, `.claude/settings.local.json`) into an unrelated feature PR.
