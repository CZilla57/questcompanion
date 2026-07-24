# Monthly & Yearly Recurring Quests — Design

**Date:** 2026-07-24
**Builds on:** the existing weekly recurring-task subsystem (`recurring_tasks`, `habit_streaks`,
`spawnRecurringTasksForToday`), the tz helpers from [[project-act5-reflection-patterns]]
(`lib/date-buckets.ts`), and the anti-shame design law ([[project-feature-roadmap]]).

## Problem

Recurring quests are weekly-only by construction. `recurring_tasks` stores a single `days_of_week`
CSV, and the spawner asks one question — "is today one of those weekdays?" — so every real routine
with a longer period has no home in the app:

- pay rent on the 1st
- deep-clean on the last Saturday of the month
- renew the car registration every March
- annual physical, tax filing, domain renewals

Today these become either a one-off quest the user has to remember to re-create every cycle (which
is exactly the remembering ADHD makes expensive), or nothing at all. The subsystem built to carry
routines quietly refuses the routines that are hardest to hold in your head.

## What it is

`recurring_tasks` grows a **frequency**: `weekly` (today's behavior, unchanged), `monthly`, or
`yearly`. Monthly and yearly quests each pick one of two anchors:

- **day of month** — "the 15th", "the 1st"
- **nth weekday** — "the first Monday", "the last Saturday"

Yearly is the monthly rule scoped to a chosen month, so both anchors work at both cadences
("March 3" or "the first Monday of March").

Every template also gains a **lead time**: how many days before the occurrence the quest should
appear in the Quest Log, carrying the true occurrence date as its due date.

## Decisions (locked with Chad, 2026-07-24)

| # | Decision | Choice |
|---|---|---|
| D1 | Monthly anchor | **Both** day-of-month and nth-weekday, user picks per template |
| D2 | Streaks | Count **occurrences**, labelled by cadence ("3 months in a row") |
| D3 | Lead time | **Per-template `lead_days` field**, not a fixed per-cadence default |
| D4 | Timezone | **Per-user local dates for all cadences** — weekly moves off UTC too |
| D5 | Missing dates | **Clamp** to the last valid day (Jan 31 → Feb 28/29) |
| D6 | Schema shape | **Flat typed columns**, not a JSON blob and not RRULE |

### Why flat columns (D6)

A single JSON `schedule` column reads cleaner but goes opaque to SQL, breaks the pattern every other
table in `lib/db/src/schema` follows (`days_of_week` CSV, `time_of_day` text), and gives up
column-level constraints. An iCalendar RRULE string is a real standard and maximally expressive, but
it adds a dependency, is hostile to render back into a form UI, and buys expressiveness with no
consumer. Flat columns migrate existing rows by defaulting `frequency` to `'weekly'` — zero backfill.

### Why clamping (D5)

A "31st of the month" quest that silently skips February is a quest that vanished. The user cannot
tell a deliberate skip from a bug or from their own mistake, and a missing quest reads as *your*
fault. Clamping keeps every occurrence visible and keeps the streak beat intact.

## Data model

### `recurring_tasks` — six new columns (migration `0007`)

| column | type | notes |
|---|---|---|
| `frequency` | text NOT NULL default `'weekly'` | `'weekly' \| 'monthly' \| 'yearly'` |
| `monthly_mode` | text NULL | `'day_of_month' \| 'nth_weekday'`; required when `frequency ≠ 'weekly'` |
| `day_of_month` | int NULL | 1–31, for `day_of_month` mode |
| `week_of_month` | int NULL | 1–4, or `-1` = "last", for `nth_weekday` mode |
| `month_of_year` | int NULL | 1–12, yearly only |
| `lead_days` | int NOT NULL default `0` | 0–60 |

Rulings:

- **`days_of_week` is reused, not duplicated.** For `weekly` it keeps its current meaning (the set of
  weekdays). For `nth_weekday` mode it carries the single weekday of the rule. A separate
  `weekday_of_month` column would be redundant with a column that is already NOT NULL.
- **`week_of_month` offers 1–4 and `-1` (last), never 5.** A "5th Tuesday" does not exist in most
  months; "last" is what people actually mean and always resolves.
- **Existing rows are untouched.** `frequency = 'weekly'` with the new columns NULL and
  `lead_days = 0` reproduces today's behavior exactly.

### `habit_streaks` — one new column (same migration)

| column | type | notes |
|---|---|---|
| `last_period_key` | text NULL | the cadence period the last completion belonged to |

Overloading `last_completed_date` was rejected: the UI renders it as a real date ("Last completed:
Mar 14"), so storing an occurrence date there would make an honest field lie.

## Architecture

### 1. `lib/recurrence.ts` — the pure engine

One new module. No DB, no `Date.now()`, no I/O — it takes a rule and a date key and answers
questions. This is where every calendar edge case lives and where the test weight sits.

```ts
export type Frequency = "weekly" | "monthly" | "yearly";

export interface RecurrenceRule {
  frequency: Frequency;
  daysOfWeek: number[];
  monthlyMode: "day_of_month" | "nth_weekday" | null;
  dayOfMonth: number | null;
  weekOfMonth: number | null;   // 1–4, or -1 = last
  monthOfYear: number | null;
  startDate: string;            // YYYY-MM-DD
  endDate: string | null;
}

/** Does this rule produce an occurrence on `dateKey`? */
export function occursOn(rule: RecurrenceRule, dateKey: string): boolean;

/** Every occurrence in [from, to], inclusive, oldest first. */
export function occurrencesInWindow(rule: RecurrenceRule, from: string, to: string): string[];

/** Human phrasing: "3rd Friday of every month", "every March 3". */
export function describeRule(rule: RecurrenceRule): string;
```

Rulings:

- **Date math runs on UTC anchors of `YYYY-MM-DD` keys**, the same trick `buildDayDates` uses in
  `lib/date-buckets.ts`. A DST transition can never shift an occurrence by a day.
- **Clamping lives here**, not in the spawner: `dayOfMonth: 31` resolves to Feb 28 (29 in a leap
  year); `monthOfYear: 2, dayOfMonth: 29` resolves to Feb 28 in common years.
- **`describeRule` is the single source of the human phrasing.** The API serves its output as
  `scheduleLabel` so the client never re-derives it and the two can't drift — the same server-owned
  copy pattern as `bigSwing` ([[project-energy-patterns-steering]]).
- **A malformed rule returns `false` / `[]`, it never throws.** Nulls where the mode requires values
  must not be able to break a shared tick for every other user.
- `startDate` / `endDate` gating happens inside the engine, so the spawner has exactly one predicate
  to consult.

### 2. The spawner — window-based

`spawnRecurringTasksForToday` is rewritten around a date window, which subsumes both lead time and
the existing same-day case:

```
join recurring_tasks → users to read each owner's timezone
tz     = resolveTimeZone(user.timezone)
today  = localDateKey(now, tz)
window = [today, today + leadDays]

for each date in occurrencesInWindow(rule, window[0], window[1]):
    insert task { userId, recurringTaskId, dueDate: date, ... } onConflictDoNothing
```

Rulings:

- **Weekly with `leadDays: 0` collapses to a one-day window**, reproducing today's behavior — now
  evaluated in the user's own calendar rather than UTC (D4). This is a one-time timing shift for
  non-UTC users, not a data migration.
- **The existing `unique(user_id, recurring_task_id, due_date)` index still does all dedup work.** No
  index change. Re-evaluating the same window on every tick is a no-op after the first insert, which
  is what makes the every-minute tick safe.
- **Quests spawn early but carry the true occurrence date as `due_date`**, so they sit quietly in the
  Quest Log without firing due-today nudges — `contextNudgeCandidate` filters on
  `dueDate <= localToday` — until the day actually arrives. Completing one early is allowed and
  counts; that is the entire point of lead time.
- **No backfill of missed occurrences.** The window only looks forward, matching current behavior.
  A server outage loses that day's spawns, as it does today.
- Changing `lead_days` on an existing template does not retro-spawn.

### 3. Cadence-aware streaks

`advanceHabitStreak` gains the template's `frequency` and buckets completions into **periods**
derived from the **quest's `due_date`**, not the completion date:

| cadence | period key | consecutive when |
|---|---|---|
| weekly | the date itself | `last_completed_date` is the previous calendar day — **unchanged logic** |
| monthly | `YYYY-MM` | stored `last_period_key` is the immediately preceding month |
| yearly | `YYYY` | stored `last_period_key` is the immediately preceding year |

Rulings:

- **Bucketing on `due_date` is what makes this forgiving.** A monthly quest due the 31st and finished
  on the 2nd still lands in the right period, so being a couple of days late costs nothing. Falls
  back to the completion date when a task has no `due_date` ([[project-anchored-tasks]] made
  `due_date` nullable — guard it).
- **Weekly walks the existing `getPreviousDay` path untouched** and leaves `last_period_key` NULL —
  the column is written only for monthly and yearly. No existing streak can shift.
  (Weekly streaks are already calendar-day based even for Mon/Wed/Fri templates; that is a
  pre-existing quirk and explicitly out of scope here.)
- **`HabitStreakPreviousState` gains `prevLastPeriodKey`.** Snapshots already serialized into
  `tasks.habit_streak_snapshot` predate the field, so `JSON.parse` yields `undefined` — it must be
  read as `null`. Every old completion stays reversible.
- **`habit_streak` badges are awarded for weekly cadence only.** The catalog's thresholds are days
  (3, 7, 14, 30); granting a "7-day streak" badge for seven *years* of a yearly quest is a mislabel,
  not a reward. Gear milestones key off `total_completions`, which is cadence-neutral, so those keep
  working for every cadence.
- The API returns `streakUnit: "day" | "month" | "year"` so the client renders "4 months in a row"
  without re-deriving cadence rules.

### 4. API contract

`lib/api-spec/openapi.yaml`, then regenerate the orval clients:

- `RecurringTaskInput` / `RecurringTaskUpdate` gain `frequency`, `monthlyMode`, `dayOfMonth`,
  `weekOfMonth`, `monthOfYear`, `leadDays`.
- `daysOfWeek` becomes required **only** when `frequency` is `weekly`.
- `RecurringTask` additionally returns read-only `scheduleLabel` (from `describeRule`) and
  `streakUnit`.

Validation rejects incoherent rules with a 400 and a plain-language message:

| condition | message shape |
|---|---|
| `frequency` not weekly, no `monthlyMode` | pick how the month should be anchored |
| `monthlyMode: day_of_month`, `dayOfMonth` missing or outside 1–31 | day of month must be 1–31 |
| `monthlyMode: nth_weekday`, no weekday in `daysOfWeek` | pick a weekday |
| `weekOfMonth` not in {1,2,3,4,-1} | pick 1st–4th or last |
| `frequency: yearly`, `monthOfYear` missing or outside 1–12 | pick a month |
| `leadDays` outside 0–60 | lead time must be 0–60 days |

Messages explain the gap; they never scold — same posture as the campaign chapter-removal refusal.

### 5. UI

`artifacts/focusquest/src/pages/recurring.tsx`:

- A **frequency segmented control** at the top of the form swaps the schedule editor beneath it:
  - `weekly` → the existing `DaySelector`, unchanged
  - `monthly` → mode toggle, then either a day-of-month picker or an ordinal + weekday pair
  - `yearly` → a month select plus that same monthly editor
- A **lead-days input** on all three, prefilled 0 / 3 / 14 by cadence as a starting suggestion the
  user can override (D3 — the default is a convenience, the field is the contract).
- The card's schedule line renders `scheduleLabel` from the API instead of the local `formatDays`.
- `StreakBadge` renders `streakUnit`: "12 day streak" / "3 months in a row" / "2 years in a row".

## Testing

The pure engine carries the weight:

- clamping: Jan 31 → Feb 28, and → Feb 29 in a leap year
- `last` weekday resolution across months with 4 vs 5 of that weekday
- Feb 29 yearly in common and leap years
- DST-boundary stepping (a zone with a spring-forward inside the window)
- window edges — occurrence exactly on `from`, exactly on `to`, one day outside each
- `startDate` / `endDate` gating, including an `endDate` inside a lead window
- malformed rules return `[]` rather than throwing

Spawner: idempotence across repeated ticks, exactly one row per lead window, two users in different
timezones on the same UTC instant landing on different local dates, and `onConflictDoNothing`
absorbing a concurrent second tick.

Streaks: consecutive months advancing, a skipped month resetting to 1, yearly across a year boundary,
uncomplete rollback both with and without `prevLastPeriodKey` present in the snapshot, and weekly
behavior being bit-identical to today.

## Failure modes

| failure | behavior |
|---|---|
| Malformed rule (nulls where mode requires values) | engine yields no occurrences; template spawns nothing; other users unaffected |
| Two ticks race on the same occurrence | unique index + `onConflictDoNothing`; one row, no error |
| Unknown/absent user timezone | `resolveTimeZone` falls back to UTC — today's behavior |
| Server down across an occurrence | that occurrence is not backfilled; the next occurrence spawns normally |
| Old completion uncompleted after deploy | `prevLastPeriodKey` absent → read as `null` → streak restores to its pre-completion value |

## Out of scope

- Backfilling missed occurrences after downtime
- Fixing the weekly-cadence streak quirk (Mon/Wed/Fri templates counting by calendar day)
- Per-occurrence notifications distinct from the existing envelope
- Custom intervals ("every 6 weeks", "every 2 years")
- Migrating existing weekly templates to any new cadence
