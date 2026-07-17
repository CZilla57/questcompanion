# Context-Aware Notifications — Design

**Date:** 2026-07-16
**Act V, quest 3** — "bills take you ~6 min — before dinner?" Rides cron + push, imports the
pattern substrate directly. Replaces the legacy fixed-time reminder pass with per-user,
timezone-aware, pattern-timed nudges.

## 1. Problem & Goal

The cron scheduler still carries a legacy pass (`checkDueTasks`) from the pre-patterns era:
blanket reminders at fixed **server-local** 8:00 / 12:00 / 19:00, hardcoded to
`DEFAULT_USER_ID = 1`. Meanwhile Act V's substrate (`derivePatterns`, PR #47) knows each
user's power hours, per-category real durations, and confidence levels — and
`steering.ts` (PR #48) already exports `inPowerWindow` / `isBigSwing` explicitly as the
import surface for this quest.

**Goal:** replace the legacy reminder pass with a context-aware nudge engine that sends
*fewer, better-timed, personalized* pushes: timed into the user's learned power window,
framed with their real category durations, per-user and tz-aware, under a strict
anti-shame envelope.

**Non-goals (v1):** modernizing the 21:00 daily summary (stays as-is, still
`DEFAULT_USER_ID`); mode-aware suppression via `modeByBlock` (deferred); LLM-drafted copy;
a pause/settings UI (the 2/day cap is the volume control; a hyperfocus-style pause is a
natural later increment); weekly recap email (quest 4).

## 2. Architecture

House pattern (mirrors Hyperfocus Protection): **pure decision function + per-user cron
pass + dedup columns on `users`.** No new API endpoints, no OpenAPI/orval changes, no
client UI — the feature is entirely cron + push.

```
cron tick ─▶ checkContextNudges()            (new pass, replaces checkDueTasks)
               per user (try/catch):
                 resolveTimeZone(user.timezone)         # UTC fallback
                 cheap pre-gates (hour, caps)           # skip most ticks
                 open-quests query (1 query)            # all kinds need one
                 loadPatternInputs + derivePatterns     # reused from routes/patterns.ts
                 selectContextNudge(inputs)             # pure authority (lib/context-nudges.ts)
                 notify() + write dedup columns
```

### Components

- **`artifacts/api-server/src/lib/context-nudges.ts`** — pure decision engine.
  - `type ContextNudgeKind = "due_today" | "power_window" | "quick_win"`
  - `selectContextNudge(inputs): ContextNudge | null` where
    `ContextNudge = { kind, title, body, tag, url }`. At most **one** nudge per tick.
  - Inputs are plain serializable data: `now`, `localHour`, `localToday`, per-kind
    last-sent local dates, `contextNudgedAt` (spacing), `PatternSummary | null`, and the
    user's open quests (id, title, dueDate, category, estimatedMinutes, difficulty,
    priority).
  - Imports `isBigSwing` and `inPowerWindow` from `./steering`.
- **`notification-scheduler.ts`** — `checkDueTasks()` deleted; new `checkContextNudges()`
  per-user pass; tick's `ran[]` reports `"context-nudges"` in place of
  `"check-due-tasks"`. `sendDailySummary()` untouched.
- **`lib/db/src/schema/users.ts`** — four new nullable columns (§4).

## 3. Nudge kinds & decision rules

Priority when several kinds are eligible in the same tick:
**`due_today` > `power_window` > `quick_win`.**

| Kind | Fires when (local) | Condition |
|---|---|---|
| `due_today` | hour == 19 (first eligible tick in the hour wins) | ≥1 open quest with `dueDate == localToday`. Pattern-independent — works at any confidence. |
| `power_window` | **learned** (confidence == `ok` and `powerHours` non-empty): the top power hour by score; if that hour is outside the 7–22 envelope, the next-best in-envelope power hour; if none qualifies, the 9:00 default. **Default** (below `ok`): hour == 9. | ≥1 open quest *for today*: `dueDate == localToday`, overdue (`dueDate < localToday`), or anchored (`dueDate IS NULL` — guard the null). Names the top big-swing quest (`isBigSwing`) if any, else the first open quest. |
| `quick_win` | hour in [16, 18) — the pre-dinner gap. Ends at 18 (not 19) so its latest send (17:59) clears the 90-min spacing rule in time for a 19:29+ `due_today` — the two can coexist on one day. | **Learned:** an open quest (for today, as above) whose category has `medianActual ≤ 10` and `count ≥ 3` in `categoryMinutes`. **Default fallback:** an open quest with `estimatedMinutes ≤ 10`. Neither → silent. |

"Open" always means `completed == false`.

**Deterministic quest selection:** power_window picks the top big-swing quest, tie-broken
by lowest id; no big-swing → lowest-id open quest. quick_win (learned) picks the
qualifying quest with the smallest category median, tie-broken by lowest id; (default)
the lowest-id quest with `estimatedMinutes ≤ 10`.

### Global anti-shame envelope (checked first, in the pure function)

- Local hour in **[7, 22)** — no pushes outside waking hours.
- **Max 2 context nudges per user per local day** (count = how many per-kind date columns
  equal `localToday`).
- **Each kind at most once per local day** (its date column != `localToday`).
- **≥ 90 minutes since `contextNudgedAt`** — prevents e.g. a 19:00 `due_today` followed
  one minute later by a power-window push when the learned power hour is also 19.
  Spacing is chronological and can suppress a higher-priority kind (a 18:30 power-window
  send blocks `due_today` for all of hour 19 → it misses the day). Intended: the user was
  just nudged; stacking a second push an hour later is the nag pattern this quest removes.

Firing is **hour-window semantics, not minute-match**: the pass fires on the first
*eligible* tick inside the hour (spacing may push that past the top of the hour) and the
per-day dedup column makes the rest of the hour silent.
A missed minute (cold start, cron hiccup) only delays the nudge within its hour; a fully
missed hour skips that kind for the day. No catch-up sends.

### Timezone handling

`resolveTimeZone(user.timezone ?? "")` with **UTC fallback** — daily reminders must not
vanish for tz-less users (legacy sent them in server time anyway). This matches
hero-care/hyperfocus, deliberately *not* the reflection pass's skip-without-tz rule:
reflection is an optional evening ritual; these replace the core reminder system.

## 4. Schema

Four new nullable columns on `users` (mirroring `reflectionPromptedDate` /
hyperfocus-column style; no new tables):

```ts
// Context-aware nudges (Act V q3): per-kind once-per-day dedup gates. Local-date
// strings (YYYY-MM-DD); today's sent-count for the 2/day cap is derived by
// comparing them to the user's localToday — no separate counter.
nudgeDueTodayDate: text("nudge_due_today_date"),
nudgePowerWindowDate: text("nudge_power_window_date"),
nudgeQuickWinDate: text("nudge_quick_win_date"),
// Instant of the last context nudge of any kind — enforces 90-min spacing.
contextNudgedAt: timestamp("context_nudged_at"),
```

Schema goes live via `drizzle-kit push` to the shared Neon DB (additive, nullable — safe
for other branches per the shared-live-DB convention).

## 5. Copy

Anti-shame law: no "warning", no guilt, quest titles quoted, real numbers. Learned copy
may claim a rhythm only at `ok` confidence; default copy makes no pattern claims.

| Kind | Title | Body |
|---|---|---|
| `due_today` | Still time for a win 🌙 | "N quest(s) due today are still open — even one keeps the momentum. Clear them all for the daily bonus!" (singular variant: "'[Quest]' is due today and still open — one small push keeps the momentum. Daily bonus if you clear it!") |
| `power_window` (learned) | Power window open ⚡ | "This is usually your strongest hour. '[Quest]' would fit great right now." |
| `power_window` (default) | Fresh start ☀️ | "'[Quest]' is ready when you are — mornings are for momentum." |
| `quick_win` (learned) | Quick win nearby ⏱️ | "'[Quest]' — [category] quests usually take you ~N min. Sneak it in before dinner?" |
| `quick_win` (default) | Quick win nearby ⏱️ | "'[Quest]' is only ~N min by your estimate. Sneak it in before dinner?" |

All three use push tag **`context-nudge`** (a newer nudge replaces an older one in the
notification tray — never a pile) and `data.url: "/"` (Today board).

## 6. Data flow & cost

Per user per tick, in order, cheapest first:

1. Pre-gates from already-loaded user row: local hour in [7,22); sent-count today < 2;
   ≥1 kind unsent whose window could include this hour (power_window's learned hour is
   unknown before patterns load, so its potential window is the whole envelope); 90-min
   spacing satisfied.
2. **Open-quests query** (1 query): all three kinds require an open quest — users with
   nothing open cost one query and skip.
3. **`loadPatternInputs` (4 queries) + `derivePatterns`** — reused verbatim from
   `routes/patterns.ts` (exported there since PR #47). Loaded only if a pattern-dependent
   kind is still in play.
4. `selectContextNudge(...)` → if non-null: `notify()` then write the kind's date column
   + `contextNudgedAt`.

Cost class matches the existing hyperfocus pass (which runs 2 queries/user/tick, every
minute). Fine at current scale; if user count grows, batch the users scan or throttle the
pass to a coarser cadence — noted, not built.

**Ordering:** dedup columns are written **after** a successful `notify()` — a failed
write risks one duplicate on the next tick, the same tradeoff every existing pass
accepts ("dedup gates make the next tick's retry safe").

## 7. Error handling

- Per-user try/catch: one user's failure (transient DB error, push failure) never aborts
  the pass for others — house pattern.
- `notify()` already prunes dead push subscriptions on send failure.
- Users with no push subscriptions: `notify()` no-ops but dedup columns still update —
  in-app state stays the source of truth and a late subscription doesn't trigger a
  backlog of stale nudges (same rationale as hero-care).

## 8. Testing

Exhaustive vitest unit tests on the pure `selectContextNudge`
(`lib/context-nudges.test.ts`):

- Envelope boundaries: 6:59 / 7:00 / 21:59 / 22:00; quick_win at 15:59 / 16:00 / 17:59 /
  18:00.
- Daily cap (2), per-kind once-per-day, 90-min spacing (89 vs 91 min), spacing
  suppressing a later higher-priority kind (18:30 send → due_today silent all hour 19).
- Priority collision: hour 19 with due-today quests AND learned power hour 19 → due_today
  wins; power_window blocked by spacing afterwards.
- Deterministic selection tie-breaks (lowest id; smallest category median).
- Confidence gating: `low`/`none` → default 9:00 timing + default copy; `ok` → learned
  hour + learned copy.
- Out-of-envelope top power hour (e.g. 23) → next-best in-envelope power hour → default 9
  when none.
- Big-swing preference in power_window quest selection; fallback to first open quest.
- quick_win: category median ≤ 10 with count ≥ 3; count 2 → estimate fallback; estimate
  ≤ 10; neither → null.
- Anchored quests: `dueDate IS NULL` counts as "for today" for power_window/quick_win,
  never for due_today.
- Singular/plural due_today copy; ~N numbers rendered from real data.

Scheduler pass stays thin (queries + delegation) and is not integration-tested, matching
every other pass. Gate: full api-server vitest suite + typecheck + server boot.

## 9. Increments (explicitly deferred)

- Mode-aware filter (`modeByBlock`): suppress in usually-Frozen blocks.
- Pause/settings control (hyperfocus-style `contextNudgesPausedUntil`).
- Modernize `sendDailySummary` to per-user/tz-aware.
- Weekly AI recap email (Act V quest 4 — needs email infra decision).
