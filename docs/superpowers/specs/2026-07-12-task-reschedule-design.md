# Change a Quest's Date After Entry

## Overview

Let a user change the **due date** of a quest after it has been created. Today a
quest's date is fixed at creation time — the "Edit Quest" dialog can change the
title, description, category, priority, and time estimate, but not the date, and
there is no other way to move a quest to a different day.

This lands as two entry points:

1. **A due-date field in the existing Edit Quest dialog** — for users already
   editing a quest.
2. **A quick-reschedule control on each quest row** — a calendar button with
   shortcut chips (Today / Tomorrow / Next week) plus a full calendar, for fast
   moves without opening the full editor.

The feature is almost entirely frontend: the backend `PATCH /tasks/:id` endpoint
and the generated `useUpdateTask` client already accept `dueDate`. No database
schema or migration changes.

## Scope

- **Incomplete quests only.** This matches the current Edit dialog gating
  (`onEdit && !task.completed` in `task-item.tsx`) and the backend, which already
  rejects field edits on completed tasks with a `409` (only `actualMinutes` is
  writable once complete). The quick-reschedule control is likewise shown only on
  incomplete quests.
- **Due date only.** `focusDate` / `isDailyFocus` (the "Today's Focus" pin) is a
  separate concept and is left untouched by rescheduling.
- No recurring-*template* rescheduling. This is about individual quest rows in the
  Quest Log, not the recurrence rules on the Habits page.

## Product decisions (settled)

| Decision | Choice |
|---|---|
| Where to change the date | **Both**: a field in the Edit dialog *and* a quick-reschedule control on each quest row |
| Which quests | Incomplete only (consistent with existing edit rules + backend) |
| Quick shortcuts | Today, Tomorrow, Next week (+ full calendar for any date) |
| Backend | Add a small guard so a recurring-collision returns a friendly `409` instead of a raw `500` (no shortcuts) |

## Architecture

Four focused units, each independently understandable and testable:

### 1. Shared date helper — `artifacts/focusquest/src/lib/reschedule.ts` (new)

Pure, dependency-light functions so date math lives in one tested place rather than
being duplicated across two components:

- `parseDueDate(s: string): Date` — wraps date-fns `parseISO`. A date-only string
  (`yyyy-MM-dd`) parses to **local** midnight.
- `toDueDateString(d: Date): string` — wraps date-fns `format(d, 'yyyy-MM-dd')`.
- `todayDueDate(): string`, `tomorrowDueDate(): string`, `nextWeekDueDate(): string`
  — computed from the local "today" via date-fns `startOfToday` / `addDays`,
  returning `yyyy-MM-dd` strings.

**Why `parseISO` + `format` (local) rather than `new Date('yyyy-MM-dd')`:** a bare
`new Date('2026-07-12')` is parsed as **UTC** midnight, which in negative-offset
timezones renders as the previous day. Routing every parse/format through this
helper keeps the picker's selected day, the shortcut math, and the stored string
consistent in the user's local time. (The existing `format(new Date(task.dueDate), …)`
display quirk in `task-item.tsx` is pre-existing; this change does not depend on
fixing it, but the reschedule control itself will use the helper and be correct.)

Unit-tested in `reschedule.test.ts`, matching the existing `lib/*.test.ts` pattern.

### 2. Edit dialog date field — `artifacts/focusquest/src/pages/tasks.tsx`

- Add `editDueDate: Date | undefined` state.
- `handleOpenEdit(task)` initializes it via `parseDueDate(task.dueDate)`.
- Render a labeled **"Due date"** control in the edit form: a `Button` trigger
  inside a `Popover` wrapping the `Calendar` (`mode="single"`), reusing the exact
  pattern already used by this page's date filter and create flow.
- `handleSaveEdit` includes `dueDate: toDueDateString(editDueDate)` in the
  `useUpdateTask` payload when a date is set.

### 3. Quick-reschedule control — `artifacts/focusquest/src/components/task-item.tsx`

- A new calendar-icon action `Button` in the existing actions cluster, rendered
  **only when `!task.completed`** (alongside pin / edit / delete).
- Clicking opens a `Popover` containing:
  - A row of shortcut chips: **Today**, **Tomorrow**, **Next week**
    (values from the helper).
  - A full `Calendar` (`mode="single"`, `selected` = current due date) for any
    arbitrary date.
- Selecting any option calls the existing `useUpdateTask` mutation with
  `{ id: task.id, data: { dueDate } }`, then:
  - invalidates `getGetTasksQueryKey()` (and closes the popover),
  - shows a toast: `Rescheduled to Jul 15`.
- Errors surface via toast, reusing the component's existing
  `err?.response?.data?.error ?? err?.message` pattern — this is how the friendly
  recurring-collision `409` from unit 4 reaches the user.

### 4. Backend guard — `artifacts/api-server/src/routes/tasks.ts` (`PATCH /tasks/:id`)

The `tasks` table has `unique("tasks_recurring_unique_idx").on(userId,
recurringTaskId, dueDate)`. Rescheduling a **habit-spawned** quest (non-null
`recurringTaskId`) onto a date that already holds a sibling instance of the same
recurring template violates this constraint. Currently that surfaces as an
uncaught Postgres error → `500`.

Wrap the incomplete-task `UPDATE` so a unique-violation (Postgres error code
`23505`) is caught and returned as:

```
409 { error: "A quest from this habit already exists on that date." }
```

Regular / manually-created quests have `recurringTaskId = null`, which Postgres
treats as distinct, so they never hit this path. All other update behavior is
unchanged.

## Data flow (quick reschedule)

```
User clicks calendar button on a quest row
  → Popover opens (shortcuts + Calendar)
  → User picks "Tomorrow" / a calendar day
  → toDueDateString(date) → useUpdateTask({ id, data: { dueDate } })
  → PATCH /tasks/:id  (incomplete-task branch)
      → success: returns updated task
      → recurring collision: 409 friendly message
  → onSuccess: invalidate getGetTasksQueryKey(), toast "Rescheduled to …"
  → onError: toast(server error message)
```

## Behavior notes / edge cases

- **Filtered view:** the Quest Log can be filtered to a specific date
  (`useGetTasks({ date })`). Rescheduling a quest to a *different* day moves it out
  of the current view. This is intended; the confirmation toast names the new date
  so the move is not silent.
- **Completed quests:** show no reschedule control and cannot be rescheduled via
  the dialog (dialog opens only for incomplete quests). Belt-and-suspenders: the
  backend already rejects `dueDate` edits on completed tasks with `409`.
- **Focus pin:** unaffected — `focusDate` is independent of `dueDate`.
- **Timezone:** all parse/format goes through the helper (local time) to avoid the
  UTC off-by-one described in unit 1.

## Testing / verification

- **Unit tests** (`reschedule.test.ts`, vitest): `toDueDateString` round-trips,
  `parseDueDate` returns local midnight (no off-by-one), and the shortcut functions
  return the expected offsets from a fixed "today".
- **Backend:** manual reasoning for the `23505 → 409` guard; no route-test harness
  exists for `tasks.ts` today, so this is verified by inspection + preview.
- **Preview verification:**
  - Edit dialog: open an incomplete quest, change the date, save → quest reflects
    the new date.
  - Quick reschedule: use each shortcut and an arbitrary calendar day → toast fires,
    quest moves, list updates.
  - Completed quest: confirm no reschedule control is present.
