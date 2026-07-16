# Energy Patterns Steering Surface — Design

Act V quest 2. PR #47 built the pattern substrate (`derivePatterns`: power hours,
best day, confidence gate) and a display-only rhythms card. This quest makes the
patterns *act*: steer hard quests into the user's productive windows, in both
directions:

- **In-the-moment:** when the user is inside a power window, the momentum engine
  tilts toward a "big swing" quest and names the window as the reason.
- **Plan-ahead:** when the user is outside the window, big-swing quests offer a
  one-tap "save it for your window" that parks them into the next one
  (`dueDate` + `dueTime`).

Fully deterministic — no LLM, no schema changes, no migrations, no Neon push.

## Thesis

ADHD brains don't lack knowledge of when they work best; they lack the executive
function to *route work* into those windows at the moment routing decisions
happen. The rhythms card tells; this surface does. Steering must feel like a
tailwind, never a leash: it only ever boosts and offers — nothing is penalized,
nagged, or locked for being at the wrong hour.

## Non-goals (v1)

- No push notifications about windows (Context-Aware Notifications is quest 3).
- No prediction beyond the existing 28-day power hours (no forecasting models).
- No steering UI for allies, world boss, or focus sessions.
- No per-quest "best category hour" matching (categoryMinutes stays unused here).
- No dismissal persistence for the chip (compact inline affordance; revisit if
  noisy).

## Definitions

**Big swing** — a quest worth steering into a power window. Predicate (any of):

- adaptive-difficulty rung is `hard`
- `priority === "high"`
- `estimatedMinutes >= 25`

Single-sourced **server-side** in `api-server/src/lib/steering.ts` and exposed
on every task as `bigSwing: boolean` via `formatTask` (same pattern as
`difficultyOfferable`). The client never re-derives hardness.

**Power window** — the top-3 `powerHours` from `derivePatterns`, treated as a
set of local hours (they may be non-contiguous, e.g. 9, 14, 21). "In a window"
means the current local hour is in the set.

**Confidence gate** — every steering surface (momentum signal, chip, popover
button, dashboard banner) requires `confidence === "ok"`. At `low`/`none` the
surfaces are absent entirely — no teaser states.

## Server design

### `lib/steering.ts` (new, pure)

- `isBigSwing(t: { difficulty, priority, estimatedMinutes }): boolean`
- `inPowerWindow(localHour: number, powerHours: { hour: number }[]): boolean`

### `formatTask` (tasks route)

Gains `bigSwing` computed from `isBigSwing`. Flows through GET /tasks and
momentum suggestions automatically.

### Momentum integration

- Route: after resolving the timezone, load `loadPatternInputs` +
  `derivePatterns` (one substrate load on this single dashboard call — the hot
  GET /tasks path is untouched). When `confidence === "ok"`, pass
  `powerHours: number[]` into the ranking context (else empty array).
- Route timezone: adopt `resolveUserTimeZone` (persisted `users.timezone` beats
  query `tz` beats UTC) for consistency with the patterns route. Small behavior
  fix; previously query-only.
- `rankMomentum`: new signal `power_window`, weight `powerWindowBigSwing: 15`,
  applied when the quest is a big swing AND the current local hour is in a power
  window AND `mode ∈ { focused, neutral }`. **Mode gates the boost** — frozen
  and distracted brains never get big-swing pressure; brain mode beats the
  clock. Hyperfocus keeps its own continue logic.
- DOMINANCE placement: `power_window` sits between `distracted_short` and
  `focused_priority` — when it's the dominant signal the reason reads:
  "You're usually strongest right now — good time for a big swing."
- Boost-only invariant: there is no negative weight for being outside a window.

### Struggle-score suppression

`PATCH /tasks/:id` request gains optional `viaSteering?: boolean`
(request-only, never persisted). When true, `struggleDeltaOnReschedule` is
skipped: parking a quest into your window is planning, not avoidance. Client
sends it from the chip and the popover's power-window button only.

## Client design

### `lib/steering.ts` (new, pure — focusquest)

- `nextPowerWindowSlot(now: Date, powerHours: { hour: number }[]):
  { dueDate: string; dueTime: string; label: string } | null` — nearest power
  hour strictly after the current hour today, else the earliest power hour
  tomorrow. `dueTime` is `"HH:00"`; `label` is a short hour label ("9am").
- `showSteeringChip(task, patterns, nowLocalHour, mode): boolean` — true when
  ALL of: `task.bigSwing`; `confidence === "ok"` with nonempty `powerHours`;
  current hour NOT in a window (in-window is momentum's moment); quest is
  unscheduled, due today, or past due (never pulls a deliberately future-dated
  quest earlier); not completed; not anchored (anchored quests are datesless by
  design); mode is not `frozen` (pressure-free).

Window label formatting reuses the existing `formatPowerHours` from
`lib/rhythms.ts` where a range is shown (dashboard banner); the chip uses the
single-slot `label`.

### Task cards (`task-item.tsx`)

Compact inline chip in the metadata row: **"⚡ Best around 9am — save it for
then?"** Tap → PATCH `{ dueDate, dueTime, viaSteering: true }` → toast
"Saved for your power window." Standard task-list invalidation (momentum key
included, per the Act III invariant).

### Reschedule popover (`task-item.tsx`)

A "Power window" quick button beside Today / Tomorrow / Next week, shown under
the same confidence gate (but regardless of `bigSwing` — if the user opened
reschedule, offer the slot for any quest). Sends `viaSteering: true`.

### Dashboard momentum board

When the current hour is in a power window (confidence `ok`, mode not frozen),
a small banner line above the suggestion: **"⚡ 9–11am — your power window"**
(via `formatPowerHours`). Display-only; the suggestion's reason string carries
the steering rationale.

## Anti-shame invariants

- Boost-only: no quest is ever downranked, flagged, or grayed for the hour.
- Mode beats clock: frozen/distracted never see big-swing steering anywhere.
- Steered reschedules never increment `struggleScore`.
- Copy is invitation-shaped ("good time for", "save it for then?") — never
  "you should", never "you missed your window." No missed-window state exists.
- Confidence gating means new users see nothing rather than noisy guesses.

## API changes (openapi.yaml → orval regen both clients)

- `Task` schema: add required `bigSwing: boolean`.
- `UpdateTaskRequest`: add optional `viaSteering: boolean`.
- No new endpoints; momentum response shape unchanged (reason string suffices).

## Testing

- Server `steering.test.ts`: big-swing predicate matrix; window membership.
- `momentum.test.ts` additions: boost fires in-window for focused/neutral only;
  never frozen/distracted; pin still structurally wins over a boosted big
  swing; reason string when dominant; empty powerHours ⇒ no signal.
- Tasks route test: `viaSteering: true` skips the struggle increment; absent or
  false keeps existing behavior.
- Client `steering.test.ts`: slot rollover across midnight; non-contiguous
  hours; strictly-after-current-hour; chip-visibility matrix (bigSwing ×
  confidence × in-window × schedule state × anchored × frozen).

## Follow-ups (explicitly deferred)

- Chip dismissal persistence if the surface proves noisy.
- Category-hour matching (`categoryMinutes`) for finer steering.
- Quest 3 (Context-Aware Notifications) will import the same server
  `steering.ts` predicates for push-side steering.
