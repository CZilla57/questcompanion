# Hyperfocus Protection — Design

**Date:** 2026-07-14
**Act:** III — Meet the Brain Where It Is (final quest)
**Status:** Approved, pre-implementation
**Depends on:** cron tick + `notification-scheduler` (`checkHeroCare` pattern), focus sessions, Act III brain modes (`deriveBrainState`, hyperfocus), hero-care (`hungerStage`), web push (`notify`).

## Thesis

ADHD hyperfocus is a gift and a trap: hours vanish, and with them water, food, movement, and sleep. Hyperfocus Protection watches for a long protected stretch — a **long live focus session** or **held hyperfocus mode** — and sends **gentle, spaced, context-aware self-care nudges** (hydrate → stretch → food when the hero's hungry → wind down when it's late). It is the *one* gentle interruption allowed during "Flow protected," it never shames, and you can pause it for the current stretch.

This closes Act III. Its check-in data (like the rest of the act) is also substrate for Act V's pattern learning.

## Decisions locked in brainstorming

1. **Two triggers, combined:** a long active focus-timer session **or** the hyperfocus brain-mode held. (Not fuzzy "sustained activity.")
2. **Context-aware rotation:** the *right* nudge for the moment — hydrate/stretch by default, **food** when the hero is actually hungry or it's a meal window, **bedtime** only when it's late — spaced ~hourly.
3. **Persist per-user timezone** (from `browserTimeZone()`), infer bedtime from a ~11pm local default, derive quiet hours from real local time. No settings screen.
4. **Delivery = gentle, snoozable push via the cron tick** (mirrors hero-care — reaches a heads-down user), plus a **session "pause protection"** control.
5. **Approach A — mirror hero-care:** a few `usersTable` columns + a pure nudge-selector + one cron pass; the protected stretch is *derived*, not stored in an episodes table.

## Non-goals (v1)

- A settings/config screen (timezone is captured automatically; thresholds are code consts).
- A `protection_episodes` history table (Act V pattern-learning can add one later).
- Per-nudge snooze *buttons on the push* (web-push actions) — v1 relies on the pause control + natural ~hourly spacing. Noted as a later refinement.
- In-app rendering of the nudges themselves — delivery is push; the client only renders the pause control + paused state.
- Multi-user quiet-hours correctness beyond the persisted tz (single primary user today).

---

## 1. Data model

Four columns on `usersTable` (`lib/db/src/schema/users.ts`), following the hero-care convention (`lastFedAt`, `hungerNotifiedStage`, `lastFlavorPushAt`):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `timezone` | `text` | `null` | IANA tz (e.g. `America/Chicago`) captured from the client; cron computes the user's local hour from it. |
| `hyperfocus_nudged_at` | `timestamp` | `null` | When the last protection nudge (any kind) fired — drives ~hourly spacing and new-stretch detection. |
| `hyperfocus_last_kind` | `text` | `null` | Last nudge kind (`hydrate` \| `stretch` \| `food` \| `bedtime`) — rotation/variety. |
| `hyperfocus_paused_until` | `timestamp` | `null` | Session pause/snooze; cron skips the user while this is in the future. |

`timezone` is broadly useful (it also lets the existing cron passes eventually use real local time — out of scope to retrofit here, but the column is the enabler).

**Stretch state is derived, never stored** — computed each tick from live `focus_sessions` + the latest hyperfocus `brain_checkin`.

## 2. Detecting the protected stretch (pure)

`protectedStretch(input) → { active: boolean; startedAt: Date | null }` in a new pure module `artifacts/api-server/src/lib/hyperfocus.ts`. Input: `{ activeSessions, mode, latestCheckinAt, now }`.

- **Focus signal:** among `activeSessions` (`status = 'active'`), a session counts only if its `lastIntervalAt ?? startedAt` is within `STALE_SESSION_MIN` (~60 min) of `now` — a live session updates intervals; an abandoned "active" tab does not. Its contribution to `startedAt` is `startedAt`. (60 ≥ the longest preset focus interval (`deep` = 50 min), so a genuine deep session never flickers "stale" between interval completions — otherwise the first nudge would slip past the 90-min mark.)
- **Mode signal:** if `mode === 'hyperfocus'` (from `deriveBrainState`, reused), the stretch contributes `latestCheckinAt`.
- `startedAt` = earliest of the valid contributions; `active` = at least one present. Duration = `now − startedAt`.

## 3. The nudge selector (pure — the heart)

`selectProtectionNudge(input) → ProtectionNudge | null` in `lib/hyperfocus.ts`, where `ProtectionNudge = { kind: 'hydrate'|'stretch'|'food'|'bedtime'; title: string; body: string; tag: string }`. Input: `{ stretch, now, localHour, lastNudgedAt, lastKind, hungerStage, pausedUntil }`.

Order of evaluation (first match wins; `null` = send nothing this tick):

1. **Suppressors →`null`:** no active stretch; `pausedUntil` in the future; stretch duration `< FIRST_NUDGE_MIN` (~90); `lastNudgedAt` is within this stretch **and** `now − lastNudgedAt < INTERVAL_MIN` (~60).
2. **Deep-night stop:** if `localHour` is in `[DEEP_NIGHT_START, MORNING)` (~2:00–6:59) → `null` (never buzz through the small hours).
3. **Bedtime:** if `localHour ≥ BEDTIME_HOUR` (~23) or `localHour < DEEP_NIGHT_START` (~<2) → `bedtime` — *"It's late and you're still going — want to start winding down soon? Tomorrow-you will thank you."* (An anti-shame invitation; the ≥1h spacing across the 23:00–01:59 window + the deep-night stop bound it to at most ~3 a night, and it never nags past 2am.)
4. **Food:** else if `hungerStage` ∈ {hungry, starving} **or** `localHour` ∈ meal windows (~12–13, ~18–19) → `food` — *"Your hero's getting hungry — maybe grab a bite too?"*
5. **Hydrate / Stretch:** else alternate by `lastKind` (if last was `hydrate` → `stretch`, else `hydrate`) — *"Deep in it for a while now — a sip of water?"* / *"You've been locked in. Stand up, roll the shoulders?"*

**Variety rule:** when a non-context kind (hydrate/stretch) would repeat `lastKind`, pick the other. Bedtime/food are context-gated and may legitimately recur across ticks (still bounded by spacing).

Tunable consts (one table, changed only with the tests that pin them): `FIRST_NUDGE_MIN=90`, `INTERVAL_MIN=60`, `STALE_SESSION_MIN=60`, `BEDTIME_HOUR=23`, `DEEP_NIGHT_START=2`, `MORNING=7`, meal windows `[[12,13],[18,19]]`.

## 4. Cron pass

`checkHyperfocusProtection()` in `artifacts/api-server/src/lib/notification-scheduler.ts`, mirroring `checkHeroCare` structurally:

1. Load all users; per-user `try/catch` (one user's failure never aborts the pass).
2. For each user: load `active` focus sessions; derive current `mode` via `deriveBrainState(latestCheckin, now, tz)` and the latest hyperfocus check-in time; compute `protectedStretch`.
3. `localHour = localHour(now, user.timezone ?? SERVER_TZ_FALLBACK)` (reuse `lib/date-buckets` `localHour`).
4. `hungerStage(user.lastFedAt, now)` (reused from hero-care).
5. `selectProtectionNudge({...})`. On a non-null result: `notify(user.id, nudge.title, nudge.body, nudge.tag)` and update `{ hyperfocus_nudged_at: now, hyperfocus_last_kind: nudge.kind }`.
6. Append `"hyperfocus-protection"` to `tick()`'s `ran` list (registered after `checkHeroCare`).

**Quiet-hours difference (deliberate):** the other passes gate on server-local `7–22`; this pass gates on the user's *local* hour via `selectProtectionNudge` and intentionally permits the late bedtime nudge. Spacing + the deep-night stop prevent night spam.

## 5. Timezone persistence

- **Endpoint:** `PUT /me/timezone` body `{ tz: string }` — validates a non-empty IANA-shaped string (reuse/extend `resolveTimeZone`), upserts `usersTable.timezone`, returns `{ ok: true }`. Idempotent.
- **Client:** called once per session from `App.tsx` on authenticated load with `browserTimeZone()`. openapi + orval hook (`usePutMyTimezone`).
- **Fallback:** when `timezone` is still null, cron uses a `SERVER_TZ_FALLBACK` const; bedtime timing is approximate until the first load captures it.

## 6. Session pause / snooze (client)

- **Endpoint:** `POST /me/hyperfocus/pause` body `{ minutes: number }` → sets `hyperfocus_paused_until = now + minutes` (`minutes: 0` clears it = resume). Returns `{ pausedUntil: string | null }`. openapi + orval hooks (`usePauseHyperfocus`).
- **Paused state to the client:** add `hyperfocusPausedUntil: string | null` to the **brain-state** response (`GET /brain/state`) — the layout already fetches it (`useGetBrainState`), so no new read. (Pragmatic overload of that endpoint, chosen for efficiency; a dedicated `GET /me/protection` is the clean alternative if we split later.)
- **UI:** a small **"Pause protection"** control renders (a) in the focus-timer page when a session is running, and (b) in the existing hyperfocus "Flow protected" banner (`layout.tsx`). When paused, it shows **"Protection paused"** with a resume affordance. Default pause = 2h (a typical remaining-session length); resume clears it.
- **Snooze semantics:** the ~hourly `INTERVAL_MIN` spacing already guarantees a given nudge won't repeat within its window; the pause control covers "quiet me for a while." No per-nudge push-action snooze in v1.

## 7. Anti-shame guardrails

- Copy is gentle care/offers only — never "STOP", never guilt about hours worked or a late bedtime.
- No counts ("you've hyperfocused N times"), no streak/again framing over protection.
- Bedtime is an **invitation** that fires ~once or twice and is hard-stopped through the deep night — it never nags all night.
- Protection is the single gentle interruption permitted during "Flow protected" mode; it is spaced and pausable.
- No writes to `activityTable` / ally feeds (private, like hero-care and brain check-ins).
- Respects the global push toggle: an unsubscribed user's `notify()` no-ops, and (as with hunger warnings) in-app state stays coherent.

## 8. Edge cases

- **Stale active session:** guarded by `STALE_SESSION_MIN` recency on `lastIntervalAt ?? startedAt` — a closed-tab "active" row doesn't trigger nudges.
- **`timezone` null:** `SERVER_TZ_FALLBACK`; corrected on first client load.
- **Multiple active sessions:** take the earliest valid `startedAt`.
- **Pause auto-expiry:** protection resumes automatically once `hyperfocus_paused_until` passes; no cleanup needed.
- **Mode + session overlap:** whichever started earlier defines `startedAt`; a single stretch, a single nudge cadence.
- **Deep-night session:** the `[DEEP_NIGHT_START, MORNING)` window (~2:00–6:59) is *fully silent* — no nudges of any kind, so a late all-nighter is never buzzed through the small hours.

## 9. Testing strategy (pure-lib, per repo convention)

Repo has no supertest/RTL harness (Act I/III precedent) — decision-logic lives in tested pure helpers; routes/UI are thin, verified by typecheck + browser e2e.

**Pure (`lib/hyperfocus.test.ts`):**
- `protectedStretch`: focus-only (fresh vs stale session), mode-only (hyperfocus vs not), both (earliest wins), neither → inactive.
- `selectProtectionNudge`: below `FIRST_NUDGE_MIN` → null; within `INTERVAL_MIN` → null; paused → null; deep-night → null; bedtime when `localHour ≥ BEDTIME_HOUR`; food when `hungerStage` hungry / meal window; hydrate↔stretch alternation via `lastKind`; variety (no immediate repeat).

**Routes/cron/UI (typecheck + e2e):** `checkHyperfocusProtection` wiring; `PUT /me/timezone`; `POST /me/hyperfocus/pause`; brain-state field; the pause control. No route/component test files.

## 10. Implementation notes / sequencing

- **Schema push:** additive columns to the shared live Neon DB (no unmerged-schema conflict — Adaptive Difficulty is merged). Controller runs `drizzle push` (see [[reference-shared-live-db-branches]] / [[reference-dev-commands]]).
- **Ordering:** schema → pure `hyperfocus.ts` (+ tests) → cron pass wiring → tz + pause endpoints + brain-state field → openapi/codegen → client (App.tsx tz call, pause control in focus page + banner). The pure module and the tz-persistence piece are independent and can proceed in parallel.
- **Reuse, don't duplicate:** `deriveBrainState`, `localHour`/`resolveTimeZone` (date-buckets), `hungerStage` (hero-care), `notify` (notification-scheduler). Follow `checkHeroCare` line-for-line for the pass structure.
- **`lib/db` composite-dist gotcha:** after schema edits, run `pnpm run typecheck:libs` before an api-server typecheck if phantom missing-field errors appear (known repo quirk).
