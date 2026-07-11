# Starter Quests on Account Creation

## Overview

New users currently land on empty pages — no quests, no activity, blank dashboard.
This change seeds a small set of relatable starter quests the first time an account is
created, so the app has content to show and the new user has something to complete
immediately (feeling the XP / level-up loop on day one).

Scope: seed **exactly once per account**, at creation time. No re-seeding, no
onboarding wizard, no UI changes.

## Starter quests

Four quests, chosen so their titles map to four **distinct** categories through the
existing `assignPoints()` keyword engine — no hardcoded points or categories, keeping
seeded quests indistinguishable from user-created ones.

| Title | Keyword hit | Category | Points |
|-------|-------------|----------|--------|
| Take a 10-minute walk | `walk` | `health` | 15 |
| Read for 15 minutes | `read` | `learning` | 20 |
| Tidy up your desk | `tidy` | `household` | 20 |
| Plan your top 3 tasks for today | `plan` | `deep_work` | 20 |

All quests use `priority: "medium"` and `dueDate` = today (UTC), matching the
`new Date().toISOString().split("T")[0]` convention used elsewhere, so they appear on
the "today" views the new user sees first.

## Architecture

Two units, split so the content/logic is pure and testable while the DB write stays thin.

### `artifacts/api-server/src/lib/starter-quests.ts` (pure — no `db` import)

- `STARTER_QUESTS`: readonly array of `{ title }` (priority defaults to medium).
- `buildStarterQuestRows(userId: number, today: string)`: maps each starter quest to a
  full task insert row using `assignPoints(title)` for `points` + `category`, stamping
  `userId`, `dueDate: today`, `priority: "medium"`. Returns the array of rows.

This module imports only `./auto-points`, both pure, so it can be unit-tested without a
database connection. (The `@workspace/db` singleton throws at import time when
`DATABASE_URL` is unset, which is why the existing test suite avoids importing it — this
split keeps the new test in the same pure style.)

### `artifacts/api-server/src/routes/auth.ts`

- `upsertGameUser()` is the single seam where brand-new accounts are minted (shared by
  the web `/callback` and the mobile token-exchange). After the `db.insert(usersTable)`,
  call a new local `seedStarterQuests(userId)` that inserts
  `buildStarterQuestRows(userId, today)` in one batch `db.insert(tasksTable).values(...)`.
- The `existing` early-return above guarantees this runs **once per account** and never
  re-seeds, even if the user later deletes every quest.

## Error handling

Seeding is wrapped in `try/catch` and logged as a warning on failure. **A seed failure
must never block login** — account creation still succeeds and the user simply lands on
empty pages (today's behavior). Seeding is best-effort, not part of the auth critical
path.

## Testing

New api-server vitest setup (the package has none today): add `vitest ^2.1.9` (already in
the lockfile via focusquest), a `test: "vitest run"` script, and a minimal
`vitest.config.ts` (node environment, `src/**/*.test.ts`).

`starter-quests.test.ts` (pure, no DB) asserts:

- `STARTER_QUESTS` has 4 entries.
- `buildStarterQuestRows(userId, today)` returns 4 rows whose categories are exactly
  `health`, `learning`, `household`, `deep_work` (all distinct).
- Every row carries the passed `userId`, `dueDate === today`, `priority === "medium"`,
  and a positive `points` value equal to `assignPoints(title).points`.

The thin DB insert in `auth.ts` is covered by typecheck; end-to-end seeding is verified
by exercising a fresh login against a real database.

## Out of scope

- Re-seeding / "restore examples" affordance.
- Pre-pinning starter quests to the 3-slot daily focus.
- Any onboarding UI or copy changes.
