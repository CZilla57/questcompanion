# Focus Sessions & Timer

## Overview

FocusQuest can plan and reward *finishing* quests, but has no model for the
act of *doing the work* — sitting down and focusing. This is the biggest gap in
the roadmap (planning → doing). This feature adds a **Pomodoro-style focus
timer** that runs client-side, records each completed focus interval on the
server, and awards **XP for time focused**.

Scope for v1:

- Pomodoro cycles (focus / short break / long break) driven by a small set of
  **fixed presets** — no free-form customization.
- A session may be **optionally linked to a task**; linked focus minutes roll
  up into that task's `actualMinutes`.
- XP is **server-computed** from validated wall-clock elapsed time, never from a
  client-asserted minute count.
- Refresh/navigation resilient: an in-flight session resumes on reload.

Out of scope for v1 (noted at the end).

## Timer model

Classic Pomodoro: a **focus interval**, then a **short break**, repeating, with
a **long break** every N cycles, up to a **planned cycle target**. Three presets
(the server owns the numbers; the client renders labels from `GET /presets`):

| Preset  | Focus | Short break | Long break | Long break every | Planned cycles |
|---------|-------|-------------|------------|------------------|----------------|
| classic | 25    | 5           | 15         | 4                | 4              |
| deep    | 50    | 10          | 20         | 2                | 3              |
| short   | 15    | 3           | 10         | 4                | 4              |

Only **focus** time earns XP; break time never does.

## XP formula (exact)

- **Per completed focus interval:** `round(focusMinutes × 0.2) + 5`.
  The `round(focusMinutes × 0.2)` term is the per-minute time reward (0.2 XP/min);
  the `+ 5` is the block-completion bonus.
- **Trailing partial focus** on a manual stop taken mid-focus-interval:
  `round(partialMinutes × 0.2)`, with **no** block bonus (block not completed).
- **Full-set bonus:** `+25` when `completedIntervals` reaches `plannedCycles`,
  awarded on the interval call that completes the final planned cycle.

Per-block XP by preset: classic `round(5)+5 = 10`, deep `round(10)+5 = 15`,
short `round(3)+5 = 8`. A full classic session (4×25) = `4×10 + 25 = 65 XP`.

XP is always computed **server-side** from the session's snapshotted
`focusMinutes` and validated elapsed time — the client never sends a minute count
that is trusted for scoring.

### Interaction with existing gamification

Three deliberate decisions (confirmed during design):

1. Focus XP is **flat** — it does **not** run through the streak multiplier used
   for task completion. Keeps it predictable; it is already a generous time reward.
2. Focus sessions **do not** modify `streakDays` / `lastActiveDate` in v1. The
   streak stays driven by task completion. (Easy future enhancement.)
3. Focus XP **does** add to `totalPoints` **and** `weeklyPoints`, so it counts
   toward levels (`gamification.ts` bands) and the weekly leaderboard.

## Data model

One new table. Config is **snapshotted at start** so a later preset change never
shifts an in-flight session. No reversal machinery (unlike tasks) — focused time
cannot be "uncompleted"; `xpAwarded` exists only for audit/idempotency.

`lib/db/src/schema/focus-sessions.ts`:

```
focus_sessions
  id                 serial pk
  userId             int notNull  → users.id
  taskId             int nullable → tasks.id  (onDelete: set null)   -- optional link
  preset             text notNull            -- 'classic' | 'deep' | 'short'
  focusMinutes       int notNull             -- snapshot
  breakMinutes       int notNull             -- snapshot (short break)
  longBreakMinutes   int notNull             -- snapshot
  longBreakEvery     int notNull             -- snapshot (cycles between long breaks)
  plannedCycles      int notNull             -- target focus intervals
  completedIntervals int notNull default 0
  focusedSeconds     int notNull default 0   -- server-derived, not client-asserted
  xpAwarded          int notNull default 0   -- running total granted, for audit
  status             text notNull default 'active'   -- 'active' | 'completed' | 'stopped'
  startedAt          timestamp notNull defaultNow
  lastIntervalAt     timestamp               -- server time of last credit (anti-cheat)
  endedAt            timestamp
  createdAt          timestamp notNull defaultNow
```

- **`status`** values: `active` (in progress), `completed` (all planned cycles
  done), `stopped` (ended early by the user or auto-finalized on a stale resume).
- **One active session per user** is enforced in the route (see `POST
  /focus-sessions`), not by a partial unique index — a single user has no real
  concurrency, and this avoids a `drizzle-kit push` partial-index edge case.
- Applied with `pnpm --filter @workspace/db push` (additive table; no migrations
  in this repo). Remember the `DATABASE_URL` export gotcha for `drizzle.config.ts`.
- Export the table + `FocusSession` type from `lib/db/src/schema/index.ts`.

## API (spec-driven → orval)

Add to `lib/api-spec/openapi.yaml`, then regenerate with
`pnpm --filter @workspace/api-spec codegen` (never hand-edit `*/src/generated`).
New route module `artifacts/api-server/src/routes/focus-sessions.ts`, mounted in
`routes/index.ts`. All routes are auth-guarded and scoped to the current user.

### `GET /focus-sessions/presets`

Returns the preset catalog (array of `{ key, label, focusMinutes, breakMinutes,
longBreakMinutes, longBreakEvery, plannedCycles }`). The client renders the
picker from this so labels/durations never drift from the server.

### `POST /focus-sessions`

Body `{ preset, taskId? }`. Looks up the preset config, snapshots it into a new
row (`status: 'active'`, `startedAt: now`). If an `active` session already exists
for the user, returns **409** with the existing session (the client should resume
it, not start a second). If `taskId` is given, it must belong to the user and be
incomplete. Returns the created session.

### `GET /focus-sessions/active`

Returns the user's current `active` session, or `null`. Drives resume-on-load.

### `POST /focus-sessions/{id}/interval`

Credits the **next** completed focus interval. Body `{ intervalIndex }`
(1-based). All within one transaction:

- **Ownership + state:** session must exist, belong to the user, and be `active`.
- **Idempotency / ordering:** require `intervalIndex === completedIntervals + 1`.
  A duplicate/late retry (`intervalIndex <= completedIntervals`) returns the
  current session unchanged (200, no double-credit); a gap
  (`intervalIndex > completedIntervals + 1`) returns **409**.
- **Anti-cheat:** require `now − startedAt ≥ intervalIndex × focusMinutes × 60 −
  GRACE` (`GRACE = 5s`). This is a breaks-excluded lower bound: real elapsed also
  includes breaks, so the check is never too strict, but it blocks spamming
  intervals for XP. On failure return **409** (`interval not yet elapsed`).
- **Credit:** `completedIntervals += 1`; `focusedSeconds += focusMinutes × 60`;
  `xp = computeIntervalXp(focusMinutes)`; if `completedIntervals === plannedCycles`
  add `+25` and set `status = 'completed'`, `endedAt = now`. Add `xp` to
  `user.totalPoints` + `user.weeklyPoints`; bump `xpAwarded`; set `lastIntervalAt
  = now`. If `taskId` set, `task.actualMinutes += focusMinutes`. Insert one
  `activity` row (`type: 'focus'`, points = xp, description e.g.
  `"Focused 25 min"` / on final cycle `"Completed focus session · 4 cycles"`).

Returns `{ session, xpDelta }`.

### `POST /focus-sessions/{id}/complete`

Ends a session early. Body `{ partialSeconds? }` = elapsed within the current,
*in-progress* focus interval (0 if stopped during a break). Server **clamps**
`partialSeconds` to `[0, focusMinutes × 60]` and to wall-clock (`now −
(lastIntervalAt ?? startedAt)`), converts to whole minutes, awards
`computePartialXp(minutes)` (no block bonus), rolls those minutes into the task
if linked, appends an `activity` row if `xp > 0`, sets `status = 'stopped'`
(or leaves `completed` if already so), `endedAt = now`. Returns `{ session,
xpDelta }`. Idempotent: completing an already-ended session is a no-op returning
the session.

### `GET /focus-sessions?limit=`

Recent sessions for the current user (default `limit = 20`, capped), newest
first, for the insights/history surface.

## Client / UI

New route **`/focus`** (`artifacts/focusquest/src/pages/focus.tsx`) plus a nav
entry in `components/layout.tsx` (lucide `Timer` icon; `mobileShow: true`) and a
light **"Start focus"** entry point on the dashboard that links to `/focus`.

**Timer as a pure state machine.** A helper module
`artifacts/focusquest/src/lib/pomodoro.ts` holds the phase logic (pure, no React):

- `reconstructTimerState(config, startedAt, now)` → `{ phase, cycleIndex,
  remainingSeconds, impliedCompletedIntervals }`, where `phase ∈ {focus, break,
  longBreak, done}`. Walks the focus→break→(long break every N) sequence from
  `startedAt` to `now`.

The page renders from this helper on a 1s tick (`setInterval`), so the running
clock is entirely client-side and unaffected by server cold starts.

States:

- **Idle:** preset picker (from `GET /presets`), optional task selector (open
  quests), Start button → `POST /focus-sessions`.
- **Active:** large countdown, phase label (Focus / Break / Long break), cycle
  dots (`●●○○`), **Pause/Resume**, **Stop**. When a focus interval reaches 0:
  fire `POST /interval`, play a chime + toast, auto-advance to the break, then to
  the next focus.
- **Complete:** summary card (minutes focused · cycles · XP earned) using the
  existing toast/confetti pattern, then back to Idle. Invalidate the stats query
  so level/XP refresh.

**Pause** stops the *countdown* but not wall-clock time. This is safe against the
anti-cheat check: pausing only ever makes the user slower, so `now − startedAt`
still exceeds the required lower bound when the interval later completes.

**Resume on load:** `GET /active`; if present, `reconstructTimerState` places the
user at the right phase/remaining.

- **Short gap** (refresh, quick nav): resume seamlessly. If elapsed legitimately
  crossed one or more focus boundaries while away, the client fires the pending
  `POST /interval` call(s) in order to catch up — those pass the anti-cheat check
  because the time genuinely passed.
- **Stale gap** (`now − (lastIntervalAt ?? startedAt)` exceeds one full cycle =
  `focusMinutes + longBreakMinutes`, i.e. the user was clearly absent): do **not**
  retroactively credit. Call `POST /complete` with `partialSeconds: 0` to
  finalize the session with only already-banked intervals. Kills the "leave it
  running overnight for XP" exploit.

**Interval-credit resilience:** the `POST /interval` endpoint is idempotent, so a
network blip or cold-start latency just retries with backoff; the client clock
never blocks on the server. The client tracks the highest `intervalIndex` it has
successfully credited to avoid re-sending.

## Error handling / edge cases

- **Multiple active sessions:** prevented — `POST /focus-sessions` 409s with the
  existing session; the client resumes it.
- **Double-fire / retry of an interval:** strict `intervalIndex` ordering makes
  re-sends no-ops; gaps 409.
- **Interval called too early:** 409 (`interval not yet elapsed`); should not
  happen with a correct client clock.
- **Stop mid-break:** `partialSeconds: 0` → no focus XP, clean finalize.
- **Task deleted mid-session:** `taskId` FK is `onDelete: set null`; rollup calls
  guard on `taskId != null`.
- **Cold start:** the Start / interval / complete requests may be slow on a cold
  server; Start shows a loading state, and the running client clock is unaffected.
- **Integer XP:** `Math.round` per interval / `Math.round` (then floor to whole
  minutes) for partials, keeping the `integer` points column exact.

## Testing

Extract scoring + phase logic as **pure functions** and unit-test them where a
runner already lives.

Server (`artifacts/api-server`, vitest already configured):

- `src/lib/focus-sessions.ts` (pure, **no `db` import**): the `PRESETS` catalog,
  `computeIntervalXp(focusMinutes)`, `computePartialXp(minutes)`, and
  `expectedElapsedForInterval(focusMinutes, intervalIndex)`.
- `src/lib/focus-sessions.test.ts` asserts: per-preset per-block XP
  (classic 10, deep 15, short 8), the full classic session totals 65, partial XP
  has no block bonus and rounds correctly, and the anti-cheat lower bound matches
  `intervalIndex × focusMinutes × 60`.

Client (`artifacts/focusquest`, vitest configured):

- `src/lib/pomodoro.ts` pure helper with `pomodoro.test.ts`: `reconstructTimerState`
  places the correct phase/remaining at representative offsets (mid-focus 1,
  during break 1, mid-focus 2, past the last cycle → `done`), and the
  short-gap-catch-up vs stale-gap boundary is exercised.

The thin DB route logic is covered by typecheck; end-to-end crediting is verified
by running a real session against the app + database.

## Build / integration order

1. `focus_sessions` schema + `db push` + export.
2. Pure server lib (`focus-sessions.ts`) + tests.
3. `openapi.yaml` endpoints + `codegen`.
4. Route module + mount + wire into gamification/activity/task rollup.
5. Pure client helper (`pomodoro.ts`) + tests.
6. `/focus` page, nav entry, dashboard entry point.
7. Verify: typecheck, run the suites, exercise a live session.

## Out of scope (v1)

- Free-form / custom Pomodoro durations (presets only).
- Focus sessions affecting the daily streak.
- Streak multiplier applied to focus XP.
- Body-doubling / shared realtime rooms (Act III; depends on this session model).
- Session editing, deletion, or XP reversal.
- Rich focus analytics beyond a recent-sessions list.
