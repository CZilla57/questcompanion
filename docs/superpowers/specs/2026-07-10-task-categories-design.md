# Task Categories as a User-Facing Field

## Overview

Make task categories explicit and user-controllable. Today, categories are derived at runtime by keyword-matching the task title via `assignPoints()`. Users see the auto-detected category but cannot override it. This change adds a persisted `category` column, lets users pick from the 9 fixed categories, and enables filtering by category.

## Categories

Fixed set of 9 slugs (no custom categories):

| Slug | Label | Color token |
|------|-------|-------------|
| `health` | Health | green-400 |
| `deep_work` | Deep Work | blue-400 |
| `learning` | Learning | purple-400 |
| `finance` | Finance | yellow-400 |
| `admin` | Admin | orange-400 |
| `household` | Household | emerald-400 |
| `social` | Social | pink-400 |
| `creative` | Creative | fuchsia-400 |
| `default` | General | muted-foreground |

## Database Schema

### `tasks` table

Add column:
```
category text NOT NULL DEFAULT 'default'
```

Migration backfills existing rows by running the `assignPoints(title, priority)` logic for each row to compute the correct category from historical data.

### `recurring_tasks` table

Add column:
```
category text NOT NULL DEFAULT 'default'
```

Same backfill strategy.

## API Changes

### Task creation — `POST /tasks`

Accept optional `category` field in the request body:
- If provided and valid (one of the 9 slugs), use it
- If omitted or invalid, fall back to `assignPoints(title, priority).category`
- Response includes `category` and `categoryLabel`

### Task update — `PATCH /tasks/:id`

Accept optional `category` in request body for incomplete tasks, same validation as creation.

### Task response — `formatTask()`

Add `category` (slug) and `categoryLabel` (human-readable) to the response object. The label is resolved from the existing `CATEGORY_LABELS` map in `auto-points.ts`.

### Task filtering — `GET /tasks`

Add optional `category` query parameter. When provided, adds `eq(tasksTable.category, category)` to the WHERE conditions.

### Point suggestion — `GET /tasks/suggest-points`

No change needed — already returns `category` and `categoryLabel`.

### Recurring tasks

- `POST /recurring-tasks` — accept optional `category`, same fallback logic
- `PATCH /recurring-tasks/:id` — accept optional `category`
- `formatRecurring()` — read `category` from the stored column instead of re-deriving via `assignPoints()`
- `spawnRecurringTasksForToday()` — copy `category` from the recurring template to the spawned task row

### Insights — `GET /users/me/insights`

Read `task.category` directly from the column instead of re-deriving with `assignPoints(task.title, task.priority)`.

### OpenAPI spec

- Add `category` (string) and `categoryLabel` (string) to the `Task` response schema
- Add `category` (string, optional) to task create/update request bodies
- Add `category` query param to `GET /tasks`
- Add `category` (string) and `categoryLabel` (string) to `RecurringTask` response schema
- Add `category` (string, optional) to recurring task create/update request bodies
- Re-run orval to regenerate `api-client-react` and `api-zod` types

## Frontend Changes

### Shared constants — `artifacts/focusquest/src/lib/categories.ts`

Extract `CATEGORY_COLORS` map and `CATEGORIES` list (slug + label pairs) to a shared module. Currently `CATEGORY_COLORS` is duplicated in `tasks.tsx` and `insights.tsx`.

### Create Quest dialog (`tasks.tsx`)

Add a category `<Select>` dropdown below the XP preview area:
- Pre-populated from the `pointPreview.category` auto-detection
- Shows all 9 categories with colored badge styling
- Reactive behavior: typing a title updates the auto-suggestion which sets the dropdown value; if the user manually picks a different category, the manual pick sticks and is no longer overwritten by subsequent auto-suggest updates
- The selected category is sent in the `createMutation` payload

### Edit Quest dialog (`tasks.tsx`)

Same category `<Select>`, pre-filled from `task.category`.

### Task item card (`task-item.tsx`)

Add a colored category badge in the metadata row alongside priority, XP, and time badges. Style uses `CATEGORY_COLORS` from the shared constants.

### Task list filter bar (`tasks.tsx`)

Add a category filter `<Select>` next to the existing status filter:
- Options: "All Categories" (default, no filter) + the 9 categories
- Passes `category` query param to `useGetTasks` hook

### Recurring tasks page (`recurring.tsx`)

- Category dropdown on create/edit forms
- Category badge on list items (replace the current `categoryLabel` that's derived server-side — now it comes from the stored column)

### Insights page (`insights.tsx`)

Replace local `CATEGORY_COLORS` with the shared import. No other changes needed — the insights API response shape stays the same, it just reads from the column now.

## Migration Plan

1. Add `category` column to `tasks` and `recurring_tasks` with `DEFAULT 'default'`
2. Backfill: for each existing row, compute `assignPoints(title, priority).category` and update the row
3. The backfill runs as a Drizzle migration or a one-time script

## Files to Modify

### Database layer (`lib/db/`)
- `src/schema/tasks.ts` — add `category` column
- `src/schema/recurring-tasks.ts` — add `category` column
- New migration file for the column addition + backfill

### API server (`artifacts/api-server/src/`)
- `lib/auto-points.ts` — export `CATEGORY_LABELS` and `VALID_CATEGORIES` set
- `routes/tasks.ts` — accept/store/return/filter by `category`
- `routes/recurring-tasks.ts` — accept/store/return `category`, pass through on spawn
- `routes/users.ts` — insights endpoint reads `task.category` directly
- `middlewares/` — no changes

### API spec (`lib/api-spec/`)
- `openapi.yaml` — add `category`/`categoryLabel` to schemas and params

### Generated clients (`lib/api-zod/`, `lib/api-client-react/`)
- Re-run orval codegen after OpenAPI spec update

### Frontend (`artifacts/focusquest/src/`)
- New file: `lib/categories.ts` — shared constants
- `pages/tasks.tsx` — category select in create/edit dialogs, category filter in filter bar
- `components/task-item.tsx` — category badge
- `pages/recurring.tsx` — category select and badge
- `pages/insights.tsx` — import shared `CATEGORY_COLORS`
