# FocusQuest

A gamified task and habit tracker for ADHD — complete quests, earn XP, build streaks, and unlock badges.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/focusquest run dev` — run the React frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 at `/api`
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite + Tailwind + shadcn/ui at `/`
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — source of truth for all DB tables
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/api-client-react/src/generated/` — generated hooks (do not hand-edit)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/` — gamification, auto-points, habit-streaks, scheduler
- `artifacts/focusquest/src/pages/` — React pages (dashboard, tasks, recurring, progress, partners, leaderboard)
- `artifacts/focusquest/public/sw.js` — Web Push service worker

## Architecture decisions

- **Auto-point assignment**: server-side keyword matcher (`auto-points.ts`) assigns XP by category (Health, Deep Work, Learning, Finance, etc.) — client cannot supply its own points value.
- **Recurring tasks via templates**: `recurring_tasks` table stores schedules; scheduler spawns real `tasks` rows daily with `recurring_task_id` FK so completions can be attributed.
- **Habit streaks separate from account streak**: `habit_streaks` table tracks per-template current/longest/total, advanced on task completion; account streak tracks overall daily activity.
- **Badge check on completion**: task completion route checks all badge categories in one pass; habit streak badges checked separately in `habit-streaks.ts` and merged into the same response.
- **XP history**: `GET /users/me/xp-history?days=N` sums `activity.points > 0` grouped by UTC date — no separate timeseries table needed.

## Product

- **Quest Log** — create, complete, and uncomplete tasks with auto-assigned XP and category labels
- **Recurring Quests** — schedule templates by day of week with per-template habit streak tracking
- **Progress** — real 14-day XP bar chart, categorized badge wall, habit streak milestone preview
- **Allies** — send/accept accountability partner requests, view partner activity
- **Leaderboard** — weekly XP ranking across all users
- **Push Notifications** — 8am/noon/7pm task reminders and 9pm streak alerts via Web Push

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after editing `openapi.yaml`
- Always run `pnpm --filter @workspace/db run push` after editing schema files
- Typecheck with `pnpm run typecheck` (not `build`) — `build` needs `PORT`/`BASE_PATH` env vars from the workflow
- Deduplication in `spawnRecurringTasksForToday` uses `recurring_task_id` FK match, not title match
- Badge category enum in `openapi.yaml` must stay in sync with values inserted into the `badges` table

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
