# iOS Native Focus Screen — Full Parity — Design (device-track #4b)

**Date:** 2026-08-14
**Status:** Approved (design)
**Artifact:** `artifacts/focusquest-mobile` (Expo Router 5 / React Native 0.79 / Hermes)
**Predecessor:** device-track #4 deep-link routing spine (PR #100) — shipped the minimal native `/focus` route this spec grows into full parity.
**Successor (separate spec):** #4c native Reflection screen (full parity).

## Purpose

Grow the minimal native `/focus` route (#4, one read + status line) into a real,
interactive Focus screen at **parity with the web app** (`artifacts/focusquest/src/pages/focus.tsx`):
an idle rhythm/quest picker that starts a session, and an active view with a live
1s clock, phase label, remaining-time readout, cycle-progress dots, pause/resume,
stop, and the background logic that credits focus intervals and finalizes stale
sessions — with XP/initiation/completion feedback.

This keeps #4's auth-guard + `Stack.Screen` header pattern and stays inside the
device-track constraints (no worktrees, branch-guard, explicit-path commits, pure-only
Vitest, typecheck + on-device gate for the RN screen).

## Decisions settled during brainstorming

1. **Pomodoro engine location — extract to a shared workspace lib `@workspace/pomodoro`.**
   The engine is pure, zero-import, and already unit-tested — the textbook extraction.
   It has two consumers (web `focus.tsx` and mobile); a single source of truth prevents
   drift of correctness-critical timer math. (`lib/body-double-countdown.ts` only
   *mentions* pomodoro in a comment — it does not import it.)
   Rejected: copying into the mobile package (forks the math; future fixes applied twice).
2. **Parity scope — core idle+active timer + minimal in-app toast + `ProtectionPause`;
   defer `BodyDoubleCard`.** Toast is required (initiation/XP/completion feedback) and
   RN has no shadcn `useToast`, so a thin mechanism is built. `ProtectionPause` is cheap
   (one query, one mutation, one control) and comes along. `BodyDoubleCard` is a whole
   subsystem (partners + rooms + create/join + a realtime-ish `BodyDoubleRoom` child on
   30s refetch) → deferred to a later spec.
3. **In-app entry — add a "Start Focus" button on the mobile home** (`app/index.tsx`).
   Deep-link-only leaves the screen practically unreachable (needs a body-double push)
   and hard to G4-test. Rejected: stay deep-link-only.
4. **Native UI — React Native primitives + a tiny local styled set** (`Card`,
   `PrimaryButton`, `SecondaryButton`, `DestructiveButton`, `Dot` via `StyleSheet`),
   no new UI dependency, no icon library (text labels instead of lucide). Matches the
   existing mobile inline-style aesthetic; zero Hermes/RN-compat risk. Rejected: adding
   an RN component lib (paper/tamagui/nativewind) — unjustified for this screen.
5. **Timer robustness on device — keep web's derive-from-wall-clock model, add one
   `AppState` foreground re-sample.** State is derived from `startedAt` + real wall-clock,
   so it self-heals across background/foreground. An `AppState` listener re-samples `now`
   the instant the app returns for a correct readout without waiting for the next tick.
   Pause stays client-only; relaunch cancels pause (same as web — no persistence).

## Architecture — four units

### 1. `@workspace/pomodoro` — NEW shared lib (extraction)

Move `pomodoro.ts` and `pomodoro.test.ts` **verbatim** from
`artifacts/focusquest/src/lib/` into a new workspace package that mirrors
`@workspace/hero-options`:

- `package.json`: `{ "name": "@workspace/pomodoro", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" }, "scripts": { "test": "vitest run",
  "typecheck": "tsc -p tsconfig.json --noEmit" }, devDeps: `@types/node` (catalog),
  `vitest` `^2.1.9` }.
- `tsconfig.json`: extends `../../tsconfig.base.json`, `composite`, `emitDeclarationOnly`,
  `outDir dist`, `rootDir src`, `types: ["node"]`.
- `src/index.ts` = the current `pomodoro.ts` contents (`Phase`, `TimerConfig`,
  `TimerState`, `reconstructTimerState`, `isStaleGap`). No logic change.
- `src/pomodoro.test.ts` = the current test, imports from `./index`.

Repoint the single web consumer and add the workspace dependency to both apps:

- `artifacts/focusquest/src/pages/focus.tsx:17`: import from `@workspace/pomodoro`
  instead of `@/lib/pomodoro`.
- Delete `artifacts/focusquest/src/lib/pomodoro.ts` and its co-located test (moved).
- `artifacts/focusquest/package.json` and `artifacts/focusquest-mobile/package.json`:
  add `"@workspace/pomodoro": "workspace:*"`; then `pnpm install` to link + update the
  lockfile.

No tsconfig `references` entry is needed — both apps use `moduleResolution: bundler`
and resolve the package via its `exports` map to `src/index.ts` (the same way the web
app already consumes `@workspace/hero-options`, which has no reference entry).

This is the one intentional change outside `artifacts/focusquest-mobile`. It is
import-path-only and covered by the migrated tests plus existing web tests.

### 2. `focusquest-mobile/src/focus/derivations.ts` — NEW, pure, TDD

The thin correctness layer the RN screen leans on, so effects stay dumb and testable.
No React, no RN imports.

```ts
// effective clock excluding accumulated paused time (web focus.tsx:75)
export function effectiveNow(nowMs: number, pausedAtMs: number | null, pausedAccumMs: number): number;

// seconds of the current focus block already elapsed, for a stop (web focus.tsx:165)
export function partialSeconds(state: TimerState, focusMinutes: number): number;

// the interval index to credit now, or null (web focus.tsx:110-111 guard)
export function nextCreditIndex(state: TimerState, creditedSoFar: number, plannedCycles: number): number | null;

// local calendar date "YYYY-MM-DD" for useGetTasks, replacing date-fns `format`
export function localDateString(nowMs: number, tz: string): string;
```

- `effectiveNow`: `(pausedAtMs ?? nowMs) - pausedAccumMs`.
- `partialSeconds`: `state.phase === "focus" ? max(0, floor(focusMinutes*60 - state.remainingSeconds)) : 0`.
- `nextCreditIndex`: `const next = creditedSoFar + 1; return (state.completedIntervals >= next && next <= plannedCycles) ? next : null;`.
- `localDateString`: `new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(nowMs))`
  yields `YYYY-MM-DD`. Hermes-safe (Intl is available; `reflection.tsx` already relies on it).

These carry the bulk of the test coverage.

### 3. `focusquest-mobile/src/components/ui.tsx` — NEW local styled set

A minimal component kit built on `View`/`Text`/`Pressable`/`StyleSheet`:
`Card`, `PrimaryButton`, `SecondaryButton`, `DestructiveButton`, `Dot`. Props kept
small (`onPress`, `disabled`, `title`/`children`, `active` for the dot). No new dep,
no icons — button labels are text ("Pause" / "Resume" / "Stop" / "Start Focus").
Reused by the Focus screen and the toast banner. Presentational only; not unit-tested
(verified via typecheck + on-device gate).

### 4. `focusquest-mobile/src/toast/` — NEW minimal in-app toast

`ToastProvider` + `useToast()` preserving the web `{ title, description?, ... }` call
shape so all copy (`initiationToast`, `+N XP`, "Session complete!", "Session ended")
transfers unchanged.

- `useToast()` returns `{ toast }`; `toast({ title, description? })` enqueues a banner.
- The provider renders a single transient banner (absolute-positioned near the top,
  built from the `ui.tsx` `Card`) that auto-dismisses after a fixed duration via
  `setTimeout`, then clears.
- Mounted once in `app/_layout.tsx` inside the existing provider tree (so both the
  Focus screen and any future screen can call `useToast`).
- Latest-toast-wins (a new toast replaces the visible one and resets the timer). Any
  non-trivial "which toast is visible / when does it expire" decision that can be
  expressed purely is extracted and unit-tested; the trivial state+timeout wiring is not.

Port `initiation-toast.ts` too: copy `artifacts/focusquest/src/lib/initiation-toast.ts`
into `focusquest-mobile/src/toast/initiation-toast.ts` (pure, depends only on the
`InitiationXp` type from `@workspace/api-client-react`). It is a candidate for a shared
lib as well, but per YAGNI it is small and copied here to avoid widening the extraction;
noted as a future consolidation.

### 5. `app/focus.tsx` — rewrite (keeps #4's auth guard + header)

Retain from #4: `useAuth()` guard (`loading` → spinner text; `!authed` → `<Redirect href="/" />`),
the `<Stack.Screen options={{ headerShown: true, title: "Focus Session" }} />`, and the
ungated-fetch safety note (route is only reached post-auth). Hooks are called
unconditionally (rules-of-hooks); rendering branches on state, exactly like web.

**Idle view** (no active session):
- Rhythm picker from `useGetFocusPresets()` — a vertical list of `Pressable` cards,
  selected state highlighted; shows `label` and `{plannedCycles} × {focusMinutes} min
  focus · {breakMinutes} min breaks`.
- Optional quest selector from `useGetTasks({ completed: false, date: localDateString(Date.now(), tz) })`
  — rendered as a native pressable list (a "Just focus (no quest)" option + open tasks),
  **not** an HTML `<select>`. Tracks `taskId: number | null`.
- Start `PrimaryButton` → `useStartFocusSession().mutate({ data: { preset: presetKey,
  taskId: taskId ?? undefined }, params: { tz } })`. On success: reset pause accounting,
  fire `initiationToast(res.initiationXp)`, invalidate active-session + my-stats. On
  error (409 = already active): invalidate active-session to resume.

**Active view** (`active.status === "active"`):
- 1s `setInterval` ticking `now`; an `AppState` listener re-samples `now` on foreground.
- `effectiveNowMs = effectiveNow(now, pausedAtMs, pausedAccumRef.current)`.
- `state = reconstructTimerState(configOf(active), startedAtMs, effectiveNowMs)`.
- Phase label (`focus`/`break`/`longBreak`/`done`), big `fmt(state.remainingSeconds)`
  readout, cycle-progress `Dot` row (`i < state.completedIntervals` filled), "Paused" hint.
- Pause/Resume `SecondaryButton` — client-only pause accounting (`pausedAtMs` +
  `pausedAccumRef`), identical to web lines 154–161.
- Stop `DestructiveButton` → `useCompleteFocusSession().mutate({ id, data: {
  partialSeconds: partialSeconds(state, active.focusMinutes) } })`; invalidate
  active-session + my-stats; "Session ended" toast.
- `<ProtectionPause />` — native port (see below), mounted only in the active view.

**Background effects** (mirror web `focus.tsx`):
- **Stale finalize on load**: `isStaleGap(configOf(active), lastActivityMs, Date.now())`
  → `completeMut.mutate({ id, data: { partialSeconds: 0 } })`, guarded by a
  `staleHandledRef` keyed on session id; invalidate active-session on settle.
- **Credit intervals as boundaries pass**: on each tick, if
  `next = nextCreditIndex(state, creditedRef.current, active.plannedCycles)` is non-null
  and no credit is in flight and the session isn't stale-handled →
  `creditFocusInterval.mutate({ id, data: { intervalIndex: next } })`. On success: `+N XP`
  toast when `xpDelta > 0`, invalidate active-session + my-stats, and on
  `res.session.status === "completed"` invalidate coins + fire the "Session complete!"
  toast. On error: roll `creditedRef` back one to retry next tick, invalidate active-session.
- `creditedRef` seeded from `active.completedIntervals` on session id/count change (web lines 84–86).

### `ProtectionPause` — native port

`focusquest-mobile/src/components/protection-pause.tsx`: `useGetBrainState({ tz })` +
`usePauseHyperfocus()`. Derives `isPaused` from `state.hyperfocusPausedUntil >
Date.now()`; the control toggles `pause.mutate({ data: { minutes: isPaused ? 0 : 120 } })`
and invalidates `getGetBrainStateQueryKey()`. Rendered as a `SecondaryButton`/ghost-style
text button. Only mounts inside the active view, so its fetch is naturally gated (no
`{query:{enabled}}` needed — avoids the generated-hook `queryKey`-required caveat).

### `app/index.tsx` — modify

Add a "Start Focus" `Button`/`PrimaryButton` in the authed branch → `router.push("/focus")`.
Minimal, matches the existing bare smoke-test style. No other home changes.

### `app/_layout.tsx` — modify

Mount `<ToastProvider>` inside the existing provider tree (alongside `AuthProvider` /
`QueryClientProvider` / `DeepLinkProvider`) so `useToast` is available to routed screens.
No change to the #4 deep-link wiring.

## Data flow

```
Idle:   presets/tasks queries ─► pick rhythm + optional quest ─► Start
          └─► startFocusSession({preset,taskId?},{tz}) ─► initiation toast ─► invalidate(active,stats)

Active: setInterval(1s) + AppState(foreground) ─► now
          now ─► effectiveNow(now,pausedAt,accum) ─► reconstructTimerState ─► {phase,remaining,dots}
          each tick ─► nextCreditIndex(state,credited,planned)
                          └─ non-null ─► creditFocusInterval({intervalIndex}) ─► +XP toast / complete toast ─► invalidate(active,stats[,coins])
          Stop ─► partialSeconds(state,focusMin) ─► completeFocusSession ─► "Session ended" toast ─► invalidate(active,stats)

On load w/ active: isStaleGap(cfg,lastActivity,now) ─► completeFocusSession({partialSeconds:0})  (once per session id)
```

## Testing (TDD, per repo convention)

- **`@workspace/pomodoro`**: the migrated `pomodoro.test.ts` (the existing suite) runs
  green in the new package, imported from `./index`.
- **`focusquest-mobile/src/focus/derivations.test.ts`** (Vitest, node, pure):
  - `effectiveNow` — running (no pause), paused (frozen at `pausedAtMs`), with accumulated pause.
  - `partialSeconds` — mid-focus value, break/longBreak/done → 0, floor + non-negative clamp.
  - `nextCreditIndex` — returns `credited+1` when a boundary passed and within `plannedCycles`;
    `null` when not yet reached, when already credited, and past the final cycle.
  - `localDateString` — a known `nowMs`+`tz` yields the expected `YYYY-MM-DD`; a tz across
    the date line yields the neighboring day.
- **Toast**: any extracted pure "visible/expiry" decision helper is tested; trivial wiring is not.
- **No RN render tests** — none exist in the repo and none are added. The screen,
  `ProtectionPause`, the `ui.tsx` set, the toast provider, and the home button are verified
  by `pnpm --filter focusquest-mobile typecheck` and the on-device G4 gate.
- **Suites stay green**: mobile `pnpm --filter focusquest-mobile test` (currently 5 files /
  26 tests) grows by the derivations file; web suite stays green after the pomodoro repoint.
- Focused run: `pnpm --filter focusquest-mobile exec vitest run src/focus/derivations.test.ts`.

## Files

New:

- `lib/pomodoro/package.json`
- `lib/pomodoro/tsconfig.json`
- `lib/pomodoro/src/index.ts` (moved from `artifacts/focusquest/src/lib/pomodoro.ts`)
- `lib/pomodoro/src/pomodoro.test.ts` (moved from `artifacts/focusquest/src/lib/pomodoro.test.ts`)
- `artifacts/focusquest-mobile/src/focus/derivations.ts`
- `artifacts/focusquest-mobile/src/focus/derivations.test.ts`
- `artifacts/focusquest-mobile/src/components/ui.tsx`
- `artifacts/focusquest-mobile/src/components/protection-pause.tsx`
- `artifacts/focusquest-mobile/src/toast/toast.tsx` (`ToastProvider` + `useToast`)
- `artifacts/focusquest-mobile/src/toast/initiation-toast.ts` (copied from web)

Modified:

- `artifacts/focusquest-mobile/app/focus.tsx` — rewrite to full parity (keep #4 guard + header).
- `artifacts/focusquest-mobile/app/index.tsx` — add "Start Focus" → `/focus`.
- `artifacts/focusquest-mobile/app/_layout.tsx` — mount `<ToastProvider>`.
- `artifacts/focusquest-mobile/package.json` — add `@workspace/pomodoro` dep.
- `artifacts/focusquest/package.json` — add `@workspace/pomodoro` dep.
- `artifacts/focusquest/src/pages/focus.tsx:17` — repoint pomodoro import.
- `pnpm-lock.yaml` — regenerated by `pnpm install` after the new package + deps.

Deleted:

- `artifacts/focusquest/src/lib/pomodoro.ts` (moved to the shared lib).
- `artifacts/focusquest/src/lib/pomodoro.test.ts` (moved).

Untouched: `src/auth/*`, `src/push/*`, `src/routing/*`, `app.config.ts`, the server
(`artifacts/api-server`), all focus endpoints (they already ship).

## Non-goals (this spec)

- `BodyDoubleCard` / body-double rooms on the native Focus screen (→ later spec).
- Any server change — focus endpoints already exist.
- New UI or icon dependencies.
- Pause persistence across relaunch (web doesn't do it either; relaunch cancels pause).
- Native Reflection parity (→ #4c).

## Constraints (carried from #4 — verified, same repo)

- **NO git worktrees** (OneDrive locks). Branch-guard `git branch --show-current ==
  feat/ios-focus-parity` before EVERY commit.
- Commit **explicit paths only** (`git add -- <path>`); never `git add -A`/`.`; never
  stage the 13 phantom `lib/api-zod/src/generated/types/` files; verify `git show --stat HEAD`
  after each commit.
- Vitest is node-env, **pure-function tests only**; no RN render-testing library exists
  and none is added. TDD the pure timer/derivation logic; verify the RN screen via
  typecheck + the on-device runbook gate.
- **Generated-hook caveat**: `{ query: { enabled } }` on a generated `useGet*` fails
  typecheck (TS2741, `queryKey` required). Gate by mount instead (ProtectionPause only
  in the active view; presets/tasks fetch ungated post-auth). Confirm real mutation arg
  shapes in `lib/api-client-react/src/generated/api.ts` (verified:
  `useStartFocusSession {data,params?}`, `useCreditFocusInterval {id,data}`,
  `useCompleteFocusSession {id,data?}`, `usePauseHyperfocus {data}`).
- Extensionless local imports. Never print/commit the root `.env`.

## Execution model (matches the #4 / #99 runs)

Subagent-driven development: implementers + per-task reviewers on sonnet, final
whole-branch review on opus. Append a **new** section to `.superpowers/sdd/progress.md`
(do not overwrite #4's). Append a **G4** on-device section to
`docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md` (Chad's manual gate).

## Device-gated verification (G4 — Chad's side, needs the iPhone)

After merge, a dev-client rebuild + on-device check:

1. **Home → Start Focus** launches the native Focus screen (idle view).
2. **Idle**: pick a rhythm (+ optional quest), tap Start → active view appears; an
   initiation "You started…" toast fires; XP reflected in stats.
3. **Active**: clock ticks down each second; phase label + dots correct; Pause freezes the
   readout, Resume continues; background the app for a stretch, foreground it → the readout
   jumps to the correct current time (self-heals) without waiting a tick.
4. **Interval boundary**: let a focus block elapse → a `+N XP` toast fires and a dot fills;
   completing the last block fires "Session complete!".
5. **Stop** mid-focus → "Session ended"; returning shows the idle view (no active session).
6. **Stale finalize**: start a session, hard-quit past one focus+long-break span, reopen
   `/focus` → the abandoned session is finalized (idle view), not back-credited.
7. **ProtectionPause**: toggling "Pause protection" flips to "Protection paused · Resume"
   and persists across a refetch.
8. **Deep link still works**: a body-double `/focus` push tap lands on the (now full) Focus
   screen (no regression to #4's routing).

Record pass/fail per path. A runbook G4 section is authored during implementation.
