# Act III Spine — Brain Check-In & Modes, Momentum Engine, "I'm Stuck" Rescue

**Date:** 2026-07-14
**Status:** Approved
**Roadmap:** Act III "Meet the Brain Where It Is" — the act's spine. Brain Check-In & Modes
and the Momentum Engine are the foundation; the "I'm Stuck" Rescue Button plugs into both.
Adaptive Difficulty and Hyperfocus Protection remain separate follow-up specs that build on
what ships here. Check-ins and rescue events are also the training data Act V ("The App
That Learns You") needs, so both are persisted server-side from day one.

## Context

FocusQuest's thesis is reducing the executive-function cost of *starting*. Act I built the
showing-up loop (focus sessions, Pick Three, initiation XP); Act II beat the blank page
(AI breakdown, quick-add, questlines). Act III makes the app adapt to the brain's current
state instead of assuming a steady one.

What already exists and gets reused:

- **`GET /tasks/recommend`** — a heuristic scorer (priority, UTC time-of-day, queue age,
  category balance, overdue, short-task boost) behind a "Suggest a quest" card on the tasks
  page. The Momentum Engine supersedes it; the endpoint and card are removed.
- **Pick Three** — `isDailyFocus` + `focusDate` on tasks, `PATCH /tasks/{id}/focus` with a
  max-3 guard, and a three-state Today's Focus board (`focus-board.ts`). Act I kept this
  deliberately light because this spec absorbs it.
- **`estimatedMinutes`** on tasks — the "you have 12 minutes" input.
- **AI breakdown** — `POST /tasks/{id}/breakdown` (Groq behind `generateJson`, per-user
  cooldown, atomic step replace). Rescue's "too big" path calls it as-is.
- **Initiation XP** — checking a first step or making the day's first move already awards
  XP with a celebration toast. Emergency Mode and micro-starts ride on it unchanged.
- **Timezone helpers** — `date-buckets.ts` (`resolveTimeZone`, `localDateKey`,
  `localDayStartUtc`, `localHour`). Momentum scoring and mode expiry use these instead of
  the UTC hours the old recommend endpoint used.

## Non-goals

- No Adaptive Difficulty (easy/medium/hard variants) and no Hyperfocus Protection nudges —
  both are follow-up specs. Hyperfocus here is a recordable mode with a calm banner, nothing
  more.
- No Act V analytics, patterns, or predictions over the new tables — we only collect.
- No changes to XP math, streaks, multipliers, daily bonus, or completion flows.
- No new push notifications and no `notification-scheduler` changes.
- Modes never gate features (stat-perks law) and never appear in ally feeds, milestones, or
  any social surface.
- No LLM in the momentum ranking path. The only AI call in this spec is the existing
  breakdown endpoint invoked from Rescue.

## Design law: anti-shame guarantees

These are requirements, not copy suggestions:

1. **No counters over check-ins or rescues.** No "frozen 3 days this week," no rescue
   streaks, no totals shown anywhere.
2. **No activity-feed rows.** `brain_checkins` and `rescue_events` are never written to
   `activityTable`, so they cannot leak into ally feeds or milestone lists.
3. **Emergency Mode is an offer, never a trap.** Entering is a choice presented on the
   Frozen tap; an exit control is always visible; the 2-minute timer reaching zero is not a
   failure state (no red, no "time's up" — the timer is an on-ramp, not a deadline).
4. **Gentle language for waiting quests.** Momentum reasons say a quest "has been waiting
   patiently," never "overdue!" with alarm styling.
5. **Frozen lowers stakes.** In frozen mode the scorer *de-prioritizes* high-priority
   quests — pressure off, smallest thing first.

## Modes

| Mode         | Chip label   | Meaning (one-tap, no typing)                  | UI response                                            |
|--------------|--------------|-----------------------------------------------|--------------------------------------------------------|
| `focused`    | Focused      | Brain is cooperating                          | Normal board; meatier/priority quests welcome           |
| `distracted` | Distracted   | Attention is slippery                         | Board narrows to short easy wins (≤15 min)              |
| `frozen`     | Frozen       | Can't start anything                          | Offer Emergency Mode; smallest steps; stakes lowered    |
| `hyperfocus` | Hyperfocus   | Locked in, protect the flow                   | Prompts muted, calm banner, prefer continuing the thread |
| `neutral`    | (Check in)   | Default / explicit clear                      | Today's behavior                                        |

**Mode is always derived, never stored as state.** Take the newest check-in *of any kind*
(so a `neutral` check-in genuinely clears — older rows are never consulted): it yields its
mode when the mode isn't `neutral`, it's younger than 4 hours (`MODE_TTL_HOURS = 4`), and
it's from the same local calendar day as now (caller's IANA tz). Otherwise `neutral`. A pure function
`currentMode(latestCheckin, now, tz)` in `artifacts/api-server/src/lib/brain-mode.ts`
implements this; `expiresAt = min(createdAt + 4h, next local midnight)`.

## Data model

Two narrow tables in the `initiation_awards` style, exported from `@workspace/db`.

`lib/db/src/schema/brain-checkins.ts`:

| Column      | Type                       | Notes                                          |
|-------------|----------------------------|------------------------------------------------|
| `id`        | serial PK                  |                                                |
| `userId`    | integer NN → users         |                                                |
| `mode`      | text NN                    | `focused \| distracted \| frozen \| hyperfocus \| neutral` |
| `source`    | text NN default `'tap'`    | `tap \| daily_prompt \| emergency_exit`        |
| `createdAt` | timestamp NN default now   | index `(userId, createdAt)` for latest-lookup  |

`lib/db/src/schema/rescue-events.ts`:

| Column         | Type                     | Notes                                            |
|----------------|--------------------------|--------------------------------------------------|
| `id`           | serial PK                |                                                  |
| `userId`       | integer NN → users       |                                                  |
| `taskId`       | integer nullable → tasks | `onDelete: set null`                             |
| `blocker`      | text NN                  | `too_big \| cant_start \| overwhelmed \| wrong_quest` |
| `intervention` | text NN                  | `breakdown \| micro_start \| emergency_mode \| reroll` |
| `createdAt`    | timestamp NN default now |                                                  |

Both tables are additive — no existing table changes — so pushing the schema to the shared
Neon DB while the branch is unmerged is safe (main never touches them).

## API surface

All endpoints go through `openapi.yaml` → orval codegen → generated TanStack Query hooks,
like every existing feature. New schemas: `BrainMode`, `BrainState`, `BrainCheckinRequest`,
`MomentumSuggestion`, `MomentumResponse`, `RescueEventRequest`.

**`POST /brain/checkins`** (new `routes/brain.ts`) — body `{ mode, source?, tz }`. Inserts a
row, returns `201 { mode, since, expiresAt }` (the derived state after this check-in).
Unknown mode/source → 422.

**`GET /brain/state?tz=`** — returns `{ mode, since, expiresAt, checkedInToday }`;
`neutral` with null timestamps when no live check-in. `checkedInToday` (any check-in row on
the local day, live or expired) exists so the daily prompt can tell "expired" from "never
asked" — an expired morning check-in must not re-summon the prompt. This is the single
source of truth the chip, board, and momentum endpoint all share.

**`GET /tasks/momentum?minutes=&tz=&exclude=`** — replaces `/tasks/recommend` (path removed
from the spec, handler deleted). Server derives mode from the latest check-in — the client
never passes mode, so the two can't disagree. Response:

```
{ mode, suggestions: [ { task, reason, kind: "primary" | "alternate" } ] }  // 0–3, primary first
```

**`POST /rescue/events`** (new `routes/rescue.ts`) — body `{ taskId?, blocker,
intervention }`, validates enums and task ownership, returns 201. Fire-and-forget logging
from the client at the moment an intervention is taken.

## Momentum scorer

Pure function `rankMomentum(candidates, ctx)` in `artifacts/api-server/src/lib/momentum.ts`.
`ctx = { mode, minutes?, localHour, todayStr, completedTodayCategories, stepsByTask }`.
Candidates: the user's incomplete tasks minus `exclude` IDs. Weights below are starting
values — a single tuning table at the top of the file, adjusted only with test updates.

| Signal                    | Effect                                                                     |
|---------------------------|----------------------------------------------------------------------------|
| Pinned today & open       | **structural rank precedence** + a +30 signal (amended during implementation from additive-only, which broke under the minutes budget): an eligible open pin always outranks non-pins; it is disqualified — losing both precedence and boost — only when its estimate overshoots the stated minutes, or distracted/frozen mode needs provably tiny wins (est ≤15/≤10) and the pin isn't one |
| Minutes fit (param given) | est ≤ minutes **+25**; est > minutes **−40** (soft exclusion); no estimate −5 |
| `focused`                 | high priority +15; est ≥ 25 min +5                                          |
| `distracted`              | est ≤ 15 +20; est ≤ 5 +5 more; routine categories (self_care, errands) +5   |
| `frozen`                  | est ≤ 10 +25; has breakdown steps +10; high priority **−10** (pressure off) |
| `hyperfocus`              | in-progress quest (≥1 done step, ≥1 open) +25; untouched est ≥ 30 min −10   |
| Time of day (local hour)  | morning 6–11: `MORNING_FOCUS_CATEGORIES` +10; evening 17–21: `EVENING_WINDDOWN_CATEGORIES` +10 and est ≤ 30 +5 |
| Queue age                 | ≥2 days old: `min(days, 7) × 2`                                             |
| Past due (non-anchored)   | +10 — reason copy stays gentle                                              |
| Category variety          | category not completed today +8                                             |

Ties break on earliest `createdAt`. Reasons come from a mode-aware template table in the
same file (one template per dominant signal), written in the app's voice and audited
against the anti-shame law before merge. Local hour comes from the `tz` query param via
`localHour()` — fixing the old recommend endpoint's UTC bug.

## Frontend

**`BrainModeChip`** (in `layout.tsx` header, next to the notification bell): shows the
current mode's label, `Check in` when neutral. Tap → popover with the five options and a
one-line description each. Selecting writes `POST /brain/checkins` (`source: 'tap'`) and
invalidates the brain-state query. Selecting **Frozen** additionally offers Emergency Mode
in the same popover ("Want the two-minute version?" — Enter / Not now), and the popover
keeps showing an "Enter Emergency Mode" row whenever the current mode is frozen, so
declining once doesn't hide the door.

**Daily soft prompt** (dashboard): a dismissible "How's the brain today?" card with the four
non-neutral modes as buttons (`source: 'daily_prompt'`), shown when `checkedInToday` is
false and it wasn't dismissed today (localStorage key). Suppressed
entirely while hyperfocus is active. Dismissing is silent — no badge, no re-ask.

**Momentum board** (tasks page — evolves the Today's Focus section): a client state machine
`momentum-board.ts` (extends the `focus-board.ts` pattern; its tests carry over) renders:

- **Suggestion card** (top): the primary momentum suggestion with its reason, plus actions —
  *Start* (2-minute micro-start on the first open step, or the quest itself if stepless;
  renders as a compact countdown in place on the card), *Not this one* (swaps to the next
  returned alternate instantly; re-fetches with `exclude` once alternates run out — that is
  what the alternates are for), *Pin it*, and *I'm stuck*. An optional "How long do you
  have?" chip row (5 / 15 / 30 / 60 min) feeds the `minutes` param (sessionStorage, cleared
  daily).
- **Pinned quests** below, in the task list's existing order (amended during
  implementation: the momentum response exposes reasons, not scores, so the client cannot
  sort by score; at ≤3 pins the ordering is immaterial and the momentum-ranked pick still
  surfaces as the primary card), with the board's existing done-count chip. Pin/unpin
  controls stay everywhere they are today. When the primary suggestion *is* a pinned quest
  (pins usually win), it appears only in the suggestion card and is omitted from the pinned
  list — no duplicate rows.
- **States**: nothing pinned + no candidates → quick-add invitation; pins all done →
  existing celebration line plus a gentle, optional "one more tiny win?" suggestion;
  otherwise → suggestion card + pinned list.
- **Mode flavor**: one line under the heading ("Distracted? Tiny wins below." / frozen and
  hyperfocus variants); board contents already shift via the scorer.

**`EmergencyMode`** (full-screen overlay, nav hidden): exactly one thing — the momentum
pick's title and its first open step — a 2:00 client-side countdown (no focus-session row
for a 2-minute burst), and three controls: **Did it** (checks the step via the existing
step PATCH, or completes a stepless quest — initiation XP and celebration fire on their
own), **Still stuck** (opens the Rescue sheet), and an always-visible quiet **Exit**. At
0:00: "Still going? Take your time." with Keep going / Done. After *Did it*: celebrate,
then offer "another tiny one?" or exit; the exit screen offers an optional one-tap
"Feeling better — Focused" re-check-in (`source: 'emergency_exit'`). Exiting never changes
mode by itself. Entry points: the Frozen tap offer and Rescue's *overwhelmed* path.

**`RescueSheet`** ("I'm stuck" — on the suggestion card, in each task row's actions, and in
Emergency Mode): four plain-language blockers, each mapping to one intervention using
existing machinery, each logging one `rescue_events` row:

| Blocker (button copy)                  | `blocker`     | Intervention                                                       | `intervention`   |
|----------------------------------------|---------------|--------------------------------------------------------------------|------------------|
| "It's too big"                         | `too_big`     | Run existing AI breakdown; spotlight step 1 with a 2-min offer      | `breakdown`      |
| "I can't make myself start"            | `cant_start`  | Inline 2-minute micro-start on the first open step                  | `micro_start`    |
| "Too much everything"                  | `overwhelmed` | Offer Emergency Mode                                                | `emergency_mode` |
| "This isn't the right quest right now" | `wrong_quest` | Momentum re-roll excluding this quest                               | `reroll`         |

When Rescue opens without a quest in hand (from the suggestion card's general entry), the
`too_big`/`cant_start` options target the current primary suggestion. The shared 2-minute
countdown logic (Emergency Mode + micro-start) lives in one small client reducer with tests.

**Removed**: the tasks-page RecommendCard and its fetch loop (the suggestion card is its
replacement — same skip semantics via `exclude`), and the `/tasks/recommend` handler +
spec path. One "what now" brain remains.

## Error handling

- Momentum with zero candidates → `{ mode, suggestions: [] }`; the board renders its
  quick-add invitation client-side.
- Invalid `tz` anywhere → `resolveTimeZone` falls back to UTC (existing behavior).
- Rescue's breakdown path surfaces the existing 429 cooldown / 503 unconfigured / 502
  failure toasts unchanged; the rescue event logs only after a successful intervention
  (no phantom data).
- `POST /rescue/events` failures are swallowed client-side (logging must never block an
  intervention).
- Emergency Mode with no candidates at all: the overlay itself shows "Nothing in the log —
  add one tiny thing first" with a calm exit (amended during implementation: checking
  candidates before offering would need a task fetch in the layout chip; the in-overlay
  fallback keeps the same guarantee).

## Testing

House style: vitest on pure functions first, thin route tests, client lib tests.

- `brain-mode.test.ts` — TTL expiry at exactly 4h, local-day boundary west and east of UTC,
  `neutral` check-in clears (and does not resurrect an older mode), no check-ins, invalid tz
  fallback, `expiresAt` = min(4h, local midnight), `checkedInToday` across expiry.
- `momentum.test.ts` — pinned structural precedence incl. disqualifiers (absorption), minutes fit + overshoot exclusion,
  each mode's weights (incl. frozen's high-priority penalty and hyperfocus's
  continue-the-thread), exclude list, variety, tie-break, empty candidates, reason template
  selection.
- Validation logic (mode/source/blocker/intervention enums, momentum params) is unit-tested
  at the lib level; routes stay thin per house style (no route-test harness exists in this
  repo — amended during implementation).
- Client — `momentum-board.test.ts` state machine (extends focus-board tests),
  countdown reducer (start/tick/zero/restart — and zero is not a failure state).
- Pre-merge: anti-shame copy pass over every new user-facing string.

## Rollout

1. Branch `feat/act3-spine` (this document commits on it).
2. Schema: new tables only → `drizzle push` to the shared Neon DB early (additive, safe).
3. Backend spine (brain-mode lib, momentum lib, routes) → openapi.yaml → codegen → UI.
4. Single PR: spec + implementation + campaign-map status flip (Brain Check-In, Momentum
   Engine, I'm Stuck → cleared/building as merged).
