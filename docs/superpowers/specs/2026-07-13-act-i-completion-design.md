# Act I Completion — Celebrate Starting, Pick Three Board, Anti-Shame Audit

**Date:** 2026-07-13
**Status:** Approved
**Roadmap:** Act I "Show Up & Do the Work" — the two remaining quests (Celebrate Starting,
"Pick Three" Daily Board) plus the Anti-Shame Design law's copy audit and the campaign-map
refresh. When this ships, Act I is fully cleared.

## Context

Act I has three cleared quests (Focus Sessions PR #14, PWA PR #15, web push). Remaining:

- **Celebrate Starting** (locked): XP for initiation — the ADHD wall is *starting*, not
  finishing. Today `POST /focus-sessions` awards nothing at start (XP is per-interval),
  checking a breakdown step awards nothing, and nothing marks "I began this project."
- **"Pick Three" Daily Board** (building): pin/unpin with a max-3 server guard, a Today's
  Focus section, and a +10 XP all-three-done bonus all exist. But the section returns
  `null` when nothing is pinned — there is no invitation to pick, so it never functions as
  a morning board. It also vanishes the moment all pinned quests complete (the board
  disappears exactly at the victory moment). Act III's Momentum Engine will absorb this
  feature, so investment stays deliberately light: two small conditional renders.
- **Anti-Shame audit** (design law): audit existing streak / daily-bonus / hero-faint copy;
  fix guilt-shaped copy. Copy-only fixes land here; structural issues become follow-ups.
- **Campaign map refresh**: the artifact still shows Voice Quick-Add (shipped, PR #37) as
  building; Act I statuses flip when this work merges.

## Non-goals

- No Momentum Engine / Act III work — Pick Three stays minimal.
- No changes to completion XP, streaks, multipliers, or the daily bonus math.
- No retroactive initiation awards for historical activity.
- No new pages or navigation; no push notifications for initiation.

## Celebrate Starting

### Award schema

Constants live in `artifacts/api-server/src/lib/initiation.ts` (single tuning point):

| Kind                | XP | Guard                                                        |
|---------------------|----|--------------------------------------------------------------|
| `session_start`     | +2 | Cooldown — no award within 10 min of the last *awarded* start |
| `first_step`        | +3 | Once per quest, ever (sticky: uncheck never refunds, recheck never re-pays) |
| `questline_kickoff` | +5 | Once per questline, ever                                      |
| `first_move`        | +5 | Once per user-local calendar day                              |

Two **events** drive everything:

1. **Session started** (`POST /focus-sessions` succeeds), optionally linked to task T.
2. **Step checked** (`PATCH /tasks/:id/steps/:stepId` with `done: true`, transitioning a
   step from not-done to done) on task T.

On each event, all applicable kinds are evaluated independently:

- `session_start` — event 1 only, subject to cooldown.
- `first_step` — event 2 only, when no *other* step of T was already done and no ledger row
  exists for (user, `first_step`, T).
- `questline_kickoff` — either event, when T exists, `T.questlineId` is set, and no ledger
  row exists for (user, `questline_kickoff`, questlineId).
- `first_move` — either event, when no `first_move` ledger row exists on or after the
  user-local day start.

Kickoff and first-move fire **even when the base award does not** (a start inside cooldown
still counts as the day's first move). Typical morning burst: start a session on a
questline task → +12 XP (2+5+5). Initiation XP is additive garnish — completion XP,
interval XP, and bonuses are untouched.

### Data model

New table `initiation_awards` (`lib/db/src/schema/initiation-awards.ts`, exported from the
schema barrel):

```
id          serial primary key
user_id     integer not null references users(id)
kind        text not null            -- 'session_start' | 'first_step' | 'questline_kickoff' | 'first_move'
ref_id      integer                  -- taskId for first_step, questlineId for questline_kickoff, else NULL
awarded_at  timestamp not null default now()
```

- **Unique index** on `(user_id, kind, ref_id)` — race-safe once-ever guard for
  `first_step` / `questline_kickoff`. Postgres treats NULL `ref_id` as distinct, so the
  time-window kinds never collide with it.
- **Index** on `(user_id, kind, awarded_at)` — serves cooldown and day-boundary lookups.

Migration via `drizzle-kit push` to the shared Neon DB. Main has no unmerged schema in
flight, so pushing at implementation start is safe.

### Award engine

`grantInitiationAwards(tx, user, event, timeZone)` in
`artifacts/api-server/src/lib/initiation.ts`:

- `event` is `{ type: 'session_start', task?: Task } | { type: 'step_check', task: Task }`.
- Runs **inside the caller's transaction**, which must hold the user row `FOR UPDATE`
  (serializes the time-window guards; both call sites lock it).
- Once-ever kinds insert the ledger row with `.onConflictDoNothing().returning()` and only
  award points when a row comes back — no error path, airtight under concurrency.
- Time-window kinds check the latest matching ledger row: cooldown pays iff no
  `session_start` row exists with `now − awarded_at < 10 min` (i.e. ≥ 10 min elapsed pays);
  first-move pays iff no `first_move` row has
  `awarded_at >= localDayStartUtc(localDateKey(now, tz), tz)`. Then insert.
- For each granted kind: insert the ledger row, insert an `activity` row
  (type `initiation`, anti-shame copy, `points` set), and accumulate the user point bump.
  One combined `users` update sets `totalPoints`/`weeklyPoints` at the end.
- Returns `{ total: number, awards: [{ kind, points }] }` (empty when nothing granted).

Activity feed copy (type `initiation`) — celebration framing, never scorekeeping of
what's left: "Started a focus session", "Checked the first step of \<task\>",
"Kicked off \<questline\>", "First move of the day".

### Endpoint changes

Both endpoints accept an optional `?tz=` IANA query param (same
`resolveTimeZone`-with-UTC-fallback pattern as the accountability routes; client sends
`Intl.DateTimeFormat().resolvedOptions().timeZone`).

1. **`POST /focus-sessions`** — already a transaction with the user row locked. After the
   session insert, call `grantInitiationAwards`. The 201 body gains
   `initiationXp: { total, awards }` (always present; zero/empty when nothing granted).
2. **`PATCH /tasks/:id/steps/:stepId`** — currently a bare update; becomes a transaction
   that locks the user row, loads the task + steps, applies the update, and calls
   `grantInitiationAwards` only on a false→true transition. Response body gains the same
   always-present `initiationXp`. `done: false` never touches the engine.

OpenAPI (`lib/api-spec/openapi.yaml`) gains the `InitiationXp` schema and the two response
extensions + `tz` params; `pnpm codegen` regenerates the react-query client and zod types.

### Error handling

- Award evaluation shares the endpoint's transaction: if the parent write fails, no award
  leaks; `.onConflictDoNothing()` means award races cannot produce errors or double-pays.
- An invalid/absent `tz` silently falls back to UTC (existing behavior elsewhere).
- The endpoints' existing error contracts (401/400/404/409) are unchanged.

## Pick Three finishing touch (web)

In `artifacts/focusquest/src/pages/tasks.tsx`, the Today's Focus IIFE currently returns
`null` when no *incomplete* pinned tasks exist. New behavior:

- **Nothing pinned today** (no pinned, no completed-pinned): render an invitation card —
  dashed border, Pin icon, "Pick up to three quests to focus on today", subline pointing
  at each quest's pin button. No new API.
- **All pinned complete** (pinned exist, all done): render a compact "Focus cleared —
  all three done" line in the section (celebration framing; the +10 bonus toast already
  fired at completion time).
- Otherwise: unchanged.

With this, the quest is functionally a daily board and is marked **cleared** on the map.

## Anti-shame copy audit

**Law:** returns after absence get "welcome back," never guilt; no red missed-day walls;
streaks restart clean; stat perks never gate basics.

**Method:** sweep user-facing copy in `artifacts/focusquest/src` (streak chips,
daily-bonus and focus-bonus toasts, insights, notification banners, empty states),
cron push notification copy in `artifacts/api-server` (hunger, ally nudges, reminders),
and hero-care vignettes/faint copy. Grep seeds: `missed`, `failed`, `overdue`, `broke`,
`lost`, `didn't`, `streak`, `faint`, plus red/destructive styling tied to missed states.

**Deliverable:** an audit table (surface → verdict → change) in the PR description.
Copy-only fixes land in this branch; anything structural (layout/behavior changes) is
logged as a follow-up task, not smuggled in.

## New-copy rule

All copy introduced by this feature follows the law by construction: initiation toasts and
activity lines celebrate what happened, never enumerate what didn't ("You started — that's
the hard part," not "1 of 3 focus quests still waiting").

## Frontend celebration (web)

- **Focus page** (`focus.tsx`): when the start response carries `initiationXp.total > 0`,
  toast — title "You started — that's the hard part. +N XP", description joining the parts
  ("Started +2 · Kicked off \<questline\> +5 · First move today +5"). Existing toast helper
  and `border-primary` styling.
- **Task item** (`task-item.tsx`): same treatment when a step-check response carries
  awards.
- Both mutations invalidate the user-stats query (points/level) and the activity feed
  query — the allies-era invalidation bug is the known trap; tests assert the keys.
- Client passes `tz` on both calls.

## Testing

Vitest, TDD per task:

- **Engine unit tests:** cooldown boundary (9:59 no / 10:01 yes, measured from last
  *awarded* start), first_step once-ever + sticky uncheck/recheck, kickoff once per
  questline across both event types, first_move day boundary with non-UTC timezone
  (reuse `date-buckets` test patterns), stacking (+12 burst), empty result when nothing
  applies, once-ever race via conflict path.
- **Endpoint tests:** start response carries `initiationXp`; second start inside cooldown
  pays 0 but still grants first_move when applicable; first vs. subsequent step check;
  `done: false` never awards; step on a questline task fires kickoff exactly once;
  response shapes match the OpenAPI contract.
- **Web tests:** toast rendering from `initiationXp`, query invalidation keys, Today's
  Focus empty/all-done states.

## Rollout

1. Branch `feat/celebrate-starting` off main (verify branch before every commit —
   concurrent sessions share this working tree).
2. Drizzle push of `initiation_awards` at implementation start (main clean; I run it).
3. Subagent-driven TDD implementation; PR with the audit table in the description.
4. After merge: refresh the campaign-map artifact (Voice Quick-Add → cleared, Pick Three →
   cleared, Celebrate Starting → cleared, Act I kicker → "Cleared"; tallies 12 cleared /
   1 building / 18 ahead) and update the roadmap memory.
