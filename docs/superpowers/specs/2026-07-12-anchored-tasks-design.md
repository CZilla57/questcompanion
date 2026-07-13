# Anchored Tasks — No-Deadline Quests That Nag Until Done

## Overview

Add a new class of task: an **Anchored** quest. It has **no due date**, stays
visible in the Quest Log every day until it is completed, and — after a one-day
grace period — withholds the daily "all tasks done" bonus while it remains open.

Anchored tasks are for one-off things that are important but easy to procrastinate
and have no hard deadline: *schedule a doctor's appointment*, *renew the passport*,
*call the accountant*. A normal dated quest disappears from view once its day
passes; an anchored quest deliberately does not.

This is distinct from two existing concepts:

- **Recurring tasks** (Habits) — templates that spawn a fresh instance per scheduled
  day. Anchored tasks are one-off; they never regenerate.
- **Today's Focus** (`isDailyFocus` / `focusDate`) — a day-scoped pin, capped at 3,
  that resets daily and grants a focus bonus. Anchored is not day-scoped, is not
  capped, and uses its own flag and icon.

## Scope

- Anchored tasks have **no due date** (`due_date` becomes nullable).
- They are **injected into every date view** of the Quest Log until completed.
- They **gate the daily bonus** starting the day *after* creation (grace period).
- Marked via a **card toggle** and a **checkbox in the New/Edit Quest dialogs**.
- **Out of scope (follow-up candidates):** pulling past-grace anchored tasks into
  the push reminders (`notification-scheduler.ts`); anchoring via the Quick-Add bar;
  any recommend-score boost for anchored tasks.

## Product decisions (settled)

| Decision | Choice |
|---|---|
| Due date | **None** — `due_date` nullable; anchored tasks store `null` |
| Visibility | Injected into **every** date's Quest Log until completed |
| Daily-bonus block | **Grace for today's** — an anchored task gates the bonus starting the day after it is created (by `createdAt` date) |
| How to mark | **Card toggle** (Anchor icon) **+ checkbox** in New/Edit dialogs |
| Toggle rules | Anchoring **nulls** the due date; un-anchoring sets it to **today** |
| Name / icon | **"Anchored"**, lucide `Anchor` (distinct from the Focus `Pin`) |
| Cap | None |
| Reminders | Deferred — anchored tasks are absent from date-based push reminders in v1 |

## Data model

`lib/db/src/schema/tasks.ts`:

- `due_date`: change `text("due_date").notNull()` → `text("due_date")` (nullable).
- Add `is_anchored: boolean("is_anchored").notNull().default(false)`.
- **Convention (app-maintained, not a DB constraint):** `is_anchored = true` ⟺
  `due_date IS NULL`. An explicit boolean is kept (rather than inferring from a null
  date) so the API contract and UI affordances are self-documenting and match the
  `isDailyFocus` precedent.

**Migration:** `drizzle push` to Neon. No backfill — existing rows keep their dates
and default `is_anchored = false`. The new unique index behavior is unaffected
(`unique(userId, recurringTaskId, dueDate)` — anchored tasks have `recurringTaskId =
null`, which Postgres already treats as distinct, and a null `dueDate` never
collides).

## API contract

`lib/api-spec/openapi.yaml`, then regenerate `api-zod` + `api-client-react`
(`pnpm` codegen).

- **`Task`** response schema: add `isAnchored: boolean`; change `dueDate` from a
  required string to `["string", "null"]`.
- **CreateTask** body: add `isAnchored: boolean` (optional, default false).
  `dueDate` is already `["string","null"]`.
- **UpdateTask** body: add `isAnchored: boolean` (optional). `dueDate` already
  `["string","null"]`.

`formatTask` in `artifacts/api-server/src/routes/tasks.ts` gains
`isAnchored: task.isAnchored` and already passes `dueDate` through (now possibly
null).

## Architecture

### 1. List query — `GET /tasks` (`artifacts/api-server/src/routes/tasks.ts`)

Today the handler builds `conditions` with an optional exact `eq(dueDate, date)`.
Change the **date-filtered** path to a union of two buckets:

- **Bucket A (dated):** the existing set — `dueDate = date`, plus the `completed`
  and `category` filters.
- **Bucket B (anchored):** `is_anchored = true AND completed = false`, plus the
  `category` filter, **ignoring date**.

Rules:

- Result `WHERE` = `and(userId, or(bucketA, bucketB))` when the anchored bucket
  applies.
- When `completed=true` is requested, **only Bucket A** is used (a completed
  anchored task has left the daily flow; its null date never matches Bucket A, so it
  simply won't appear in a per-date completed view — it shows in the date-cleared
  "all" view and in history/progress).
- The `category` filter, when present, applies to **both** buckets (anchored tasks
  of other categories are hidden while a category filter is active — consistent).
- **When `date` is absent** (date cleared): unchanged — all of the user's tasks are
  returned, anchored included naturally.
- **Ordering:** `orderBy(desc(is_anchored), desc(createdAt))` — in a date-filtered
  view Bucket B is incomplete-only, so this floats the anchored tasks to the **top**
  and preserves the existing newest-first order within each group.
- **Dedup:** not a concern — an anchored task's `dueDate` is null and never equals
  a selected date, so it appears via Bucket B only.

### 2. Create — `POST /tasks`

- Accept `isAnchored` in the body.
- **Validation:** currently `if (!title || !dueDate) 400`. Relax so that when
  `isAnchored` is true, `dueDate` may be omitted; require `dueDate` only for
  non-anchored tasks. When `isAnchored` is true, force-store `dueDate = null`
  regardless of any value sent.
- Insert `isAnchored` and `dueDate` (null for anchored) accordingly.

### 3. Anchor toggle — `PATCH /tasks/:id`

Handle `isAnchored` in the incomplete-task edit branch (anchoring a completed task
is not offered; completed tasks already reject edits):

- `isAnchored: true` → set `is_anchored = true` **and** `due_date = null`.
- `isAnchored: false` → set `is_anchored = false` **and** `due_date = today` (unless
  the same request also supplies an explicit `dueDate`, which wins).

Both the card Anchor toggle and the dialog checkbox route through this single
endpoint (no dedicated `/anchor` endpoint — unlike Focus, there is no cap or
per-day stamping to house).

### 4. Daily-bonus gate — `POST /tasks/:id/complete`

Today the bonus check reads `todayTasks = tasks where dueDate = today` and awards
`DAILY_BONUS_POINTS` when `todayTasks.length > 0` and every task is completed
(treating the just-completed `id` as done).

Change the **gating set** to:

```
gatingTasks = tasks where userId = user AND (
      dueDate = today
   OR (is_anchored = true AND createdAt < startOfToday)   -- grace: skips today's
)
```

- `startOfToday` is derived from the same UTC `today` string the endpoint already
  computes (`now.toISOString().split("T")[0]`), consistent with the rest of the
  file. (Timezone nuance is pre-existing and out of scope.)
- `allDone = gatingTasks.every(t => t.id === id || t.completed)`; award when
  `allDone && gatingTasks.length > 0` and the once-per-day guard passes (unchanged).
- Completed anchored tasks match the `is_anchored` clause but are trivially
  `completed`, so they never block; incomplete **pre-today** anchored tasks block;
  incomplete **today-created** anchored tasks are excluded (grace).
- Consequence (intended): if the only thing you clear on a quiet day is an anchored
  task you *created today*, the gating set can be empty → no daily bonus that day.
  Clearing a pre-today anchored task (in the set) as your last task **does** award
  the bonus.

### 5. Un-complete accounting — `POST /tasks/:id/uncomplete`

The streak-restore decision reads `otherCompletedToday = completed tasks where
dueDate = today` to check whether this task was the sole streak driver. Anchored
tasks have a null `dueDate` and would be missed. Extend that check to also count
anchored tasks completed today by **`completedAt` date = today**, so uncompleting an
anchored task restores streak state correctly and two anchored completions in one
day don't double-restore.

### 6. Recommend — `GET /tasks/recommend`

The scorer's overdue bonus uses `task.dueDate < today`. Guard it so a **null**
`dueDate` is never treated as overdue (anchored tasks have no deadline). All other
scoring (priority, days-in-queue via `createdAt`, category balance) already works
for anchored tasks unchanged.

### 7. Task card — `artifacts/focusquest/src/components/task-item.tsx`

- Add an **Anchor toggle** button in the actions cluster (beside the Focus pin),
  shown on incomplete tasks. Filled/active when `task.isAnchored`. Clicking calls
  `useUpdateTask({ id, data: { isAnchored: !task.isAnchored } })`, invalidates
  `getGetTasksQueryKey()`, and toasts ("Quest anchored" / "Anchor removed").
- **Date display:** when `task.isAnchored` (or `dueDate == null`), render an anchor
  badge + "No deadline" in place of the `format(parseDueDate(task.dueDate), …)` date
  line — which must be guarded against a null `dueDate` to avoid a parse crash.
- The reschedule control is hidden for anchored tasks (no date to move).

### 8. Dialogs — `artifacts/focusquest/src/pages/tasks.tsx`

- **New Quest:** add an "Anchor — no deadline, keep until done" checkbox. When
  checked, hide the implicit due-date coupling and send `{ isAnchored: true }` with
  no `dueDate`. When unchecked, behavior is unchanged (uses the page's selected
  date).
- **Edit Quest:** add the same checkbox. Checked hides the "Due date" picker and
  sends `isAnchored: true`; unchecking reveals the picker (defaulting to today).

## Data flow (anchor an existing quest)

```
User clicks Anchor button on an incomplete dated quest
  → useUpdateTask({ id, data: { isAnchored: true } })
  → PATCH /tasks/:id (incomplete branch)
       → sets is_anchored = true, due_date = null
  → onSuccess: invalidate getGetTasksQueryKey(), toast "Quest anchored"
  → quest now appears in every date's Quest Log until completed;
    starting tomorrow it withholds the daily bonus while open
```

## Behavior notes / edge cases

- **Grace boundary:** an anchored task created today is visible and injected
  everywhere immediately, but does not gate the daily bonus until the next calendar
  day (by `createdAt` date, UTC — consistent with the endpoint's existing "today").
- **Completed anchored tasks** leave the daily flow: not injected into per-date
  views, not gating. They remain visible in the date-cleared "all" view and in
  history/progress.
- **Category filter** hides anchored tasks whose category doesn't match — intended
  and consistent with dated tasks.
- **Focus + Anchor** are orthogonal flags; no special interaction is added. (An
  anchored task has no `focusDate` semantics; pinning is left available but
  unremarkable.)
- **Reminders:** anchored tasks are absent from the date-keyed morning/noon/evening
  push reminders in v1 (no regression; they were never dated). Pulling past-grace
  anchored tasks into the evening reminder is a natural follow-up.

## Testing / verification

**Backend** (vitest, matching existing `lib/*.test.ts` and route patterns where
present):

- `GET /tasks?date=X` injects an incomplete anchored task regardless of `X`;
  respects the `category` filter; excludes anchored under `completed=true`.
- `POST /tasks` with `isAnchored: true` and no `dueDate` succeeds and stores a null
  date; non-anchored still requires `dueDate` (400 otherwise).
- `PATCH /tasks/:id` anchoring nulls the date; un-anchoring sets today.
- Daily-bonus gate: a **today-created** anchored task does **not** block the bonus;
  a **yesterday-created** anchored task **does**; completing that pre-today anchored
  task as the last open task awards the bonus.
- Recommend is null-`dueDate` safe (no crash, never "overdue").

**Preview verification:**

- Create an anchored quest from the New Quest dialog → appears with an anchor badge
  and "No deadline"; visible when the date picker is moved to other days.
- Anchor an existing dated quest via the card toggle → date clears, badge appears.
- With a pre-today anchored quest open, complete all of today's dated quests →
  **no** daily-bonus toast; then complete the anchored quest → daily-bonus toast.
- Un-anchor → a due date (today) returns and the quest behaves normally.
