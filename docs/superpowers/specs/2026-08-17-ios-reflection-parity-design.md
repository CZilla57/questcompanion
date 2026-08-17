# iOS Native Reflection Screen — Full Parity — Design (device-track #4c)

**Date:** 2026-08-17
**Status:** Approved (design)
**Artifact:** `artifacts/focusquest-mobile` (Expo Router 5 / React Native 0.79 / Hermes)
**Predecessors:** device-track #4 deep-link routing spine (PR #100) — shipped the minimal
native `/reflection` route this spec grows into full parity; #4b native Focus parity
(PR #101) — established the shared-code gradient, the RN UI kit, the toast mechanism, and
the home in-app entry pattern this spec reuses.

## Purpose

Grow the minimal native `/reflection` route (#4: one authenticated read + today's prompt
line) into the real evening-reflection form at **parity with the web app**
(`artifacts/focusquest/src/pages/reflection.tsx`): an unanswered view with two multi-select
chip groups plus optional free-text and a Done action, and an answered view showing the
selected chips, the free-text, and the acknowledgement, with an "Edit tonight's answer"
path that re-populates the form and re-enters editing.

This keeps #4's auth-guard + `Stack.Screen` header pattern and its Hermes-safe
`Intl.DateTimeFormat().resolvedOptions().timeZone` (do **not** import `@/lib/timezone`), and
stays inside the device-track constraints (no worktrees, branch-guard, explicit-path
commits, pure-only Vitest, typecheck + on-device gate for the RN screen).

## Decisions settled during brainstorming

1. **Pure shared bits — copy into mobile (not a shared lib).** `reflection-chips.ts`
   (+ its test) and `api-error.ts` are copied verbatim into
   `artifacts/focusquest-mobile/src/lib/`. This matches #4b's `initiation-toast.ts`
   decision (small pure helpers → copy; avoid new-package ceremony) rather than #4b's
   `@workspace/pomodoro` extraction (reserved for correctness-critical, multi-consumer
   math). The chip file's only dependency is the `@workspace/api-client-react` enums,
   which mobile already consumes; the exhaustive `CHIP_LABELS`
   `Record<ReflectionChip, string>` still fails compile in *each* copy if a chip lacks a
   label, so a new server-side chip is caught at build time on both platforms.
   Rejected: extracting `@workspace/reflection-chips` — a new package.json / tsconfig /
   root composite reference / `pnpm install` for ~20 lines of display constants is
   over-engineering versus the pomodoro case.
2. **Parity scope — full unanswered + answered + edit flow.** RN `TextInput` (multiline,
   `maxLength={500}`) for the free-text; the toast reuses #4b's `useToast`. This is the
   full web feature set; nothing deferred.
3. **In-app entry — add an "Evening reflection" button on the mobile home**
   (`app/index.tsx`) → `router.push("/reflection")`, mirroring #4b's "Start Focus". Keeps
   the screen reachable and G-testable without waiting for an evening reflection push.
   Rejected: deep-link-only.
4. **Native UI — reuse #4b's local `ui.tsx` kit + add one `Chip` toggle.** Free-text uses
   the RN `TextInput` primitive. No lucide (web's `Moon`/`Sparkles` become text / an emoji
   ✨). No new UI dependency. Matches the existing mobile inline-style aesthetic; zero
   Hermes/RN-compat risk. Rejected: adding an RN component/icon library.

## Web feature set (parity target)

From `artifacts/focusquest/src/pages/reflection.tsx`:

- **Read:** `useGetTodayReflection({ tz, draft: true })`; `data.reflection` is
  `Reflection | null` with `prompt`, `chips: ReflectionChip[]`, `freeText: string | null`,
  `ack: string | null`, `answeredAt: string | null`.
- **Loading:** "Setting up tonight's reflection…".
- **Unanswered:** show `prompt`; two multi-select chip groups — "What helped?"
  (`HELPED_CHIPS`) and "What got in the way?" (`HINDERED_CHIPS`), labels from
  `CHIP_LABELS`; optional free-text (`maxLength` 500); Done disabled until ≥1 chip **or**
  some non-blank text. Submit via `useAnswerTodayReflection` with `{ chips, freeText?, tz }`.
- **Answered:** show the selected chips, `freeText` (italic), `ack` (with a sparkle);
  "Edit tonight's answer" re-populates the form and re-enters editing.
- **After submit:** invalidate **both** `getGetTodayReflectionQueryKey({ tz, draft: true })`
  **and** `getGetTodayReflectionQueryKey({ tz })` plus `getGetMyStatsQueryKey()`; on error,
  toast via `apiErrorMessage`.

### Verified API contract (`lib/api-client-react/src/generated`)

- `useGetTodayReflection(params?: GetTodayReflectionParams)` — `params` carries `tz` and
  `draft`. Returns `ReflectionResponse { reflection: Reflection | null }`.
- `useAnswerTodayReflection().mutate({ data: ReflectionAnswerRequest })` where
  `ReflectionAnswerRequest = { chips: ReflectionChip[]; freeText?: string /* @maxLength 500 */; tz?: string }`.
  Returns `ReflectionAnswerResponse { reflection: Reflection; xpAwarded: number }`.
- `getGetTodayReflectionQueryKey`, `getGetMyStatsQueryKey` are exported.
- **Parity fix:** the current #4 route reads `useGetTodayReflection({ tz })` (no `draft`);
  the rewrite reads `{ tz, draft: true }` to match web.
- **Parity note (XP):** web does **not** toast `xpAwarded`; it surfaces the inline `ack`.
  The native screen matches — the toast is used **only** for the save-error path.

## Architecture — four units

### 1. Copied pure libs — `focusquest-mobile/src/lib/`

- `reflection-chips.ts` + `reflection-chips.test.ts` — verbatim copy of
  `artifacts/focusquest/src/lib/reflection-chips.ts` (+ test). The test imports
  `./reflection-chips` and asserts the groups don't overlap and every chip has a label.
- `api-error.ts` — verbatim copy of `artifacts/focusquest/src/lib/api-error.ts`
  (`apiErrorMessage(err, fallback)`), for the save-error toast.

Extensionless local imports throughout.

### 2. `focusquest-mobile/src/reflection/derivations.ts` — NEW, pure, TDD

The testable logic factored out of the component (mirrors `src/focus/derivations.ts`), so
effects/render stay thin and the pure-only Vitest constraint is satisfied. No React, no RN
imports.

```ts
import type { Reflection, ReflectionAnswerRequest, ReflectionChip } from "@workspace/api-client-react";

// The exact answer payload the mutation receives (web reflection.tsx:74).
export function buildReflectionAnswer(
  chips: ReflectionChip[], freeText: string, tz: string,
): ReflectionAnswerRequest;
//  { chips, freeText: freeText.trim() || undefined, tz }

// Whether Done is enabled (web reflection.tsx:152 guard, inverted).
export function canSubmitReflection(selectedCount: number, freeText: string): boolean;
//  selectedCount > 0 || freeText.trim().length > 0

// Whether to show the answered (read-only) view vs the form (web reflection.tsx:61).
export function isAnswered(reflection: Reflection | null, editing: boolean): boolean;
//  reflection?.answeredAt != null && !editing
```

These carry the bulk of the test coverage.

### 3. `focusquest-mobile/src/components/ui.tsx` — add a `Chip` toggle

A pressable pill built on `Pressable`/`Text`/`StyleSheet`, alongside the existing `Card`,
`PrimaryButton`, `SecondaryButton`, `DestructiveButton`, `Dot`. Props kept small:
`label: string`, `active: boolean`, `onPress?: () => void` (omitted → read-only, for the
answered-view pills). Presentational only; not unit-tested (verified via typecheck +
on-device gate). No new dependency, no icons.

### 4. `app/reflection.tsx` — rewrite to full parity (keeps #4's guard + header)

Retain from #4: `useAuth()` guard (`loading` → "Loading…" text; `!authed` →
`<Redirect href="/" />`), the `<Stack.Screen options={{ headerShown: true, title:
"Reflection" }} />`, and the Hermes-safe `tz` via `Intl`. All hooks are called
unconditionally before any return (rules-of-hooks); rendering branches on state, exactly
like web. The single read is ungated and safe (route reached only post-auth — the
DeepLinkRouter navigates here only when authed, and the Redirect guards any direct mount),
so no `{ query: { enabled } }` is used (avoids the generated-hook `queryKey`-required
caveat).

- `tz = Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Read `useGetTodayReflection({ tz, draft: true })`.
- State: `selected: Set<ReflectionChip>`, `freeText: string`, `editing: boolean`.
  `reflection = data?.reflection ?? null`; `answered = isAnswered(reflection, editing)`.
- **Query loading:** render "Setting up tonight's reflection…".
- **Unanswered view:** `prompt` text; a `Chip` row for "What helped?" (`HELPED_CHIPS`) and
  one for "What got in the way?" (`HINDERED_CHIPS`), labels from `CHIP_LABELS`, toggling
  membership in `selected`; an RN `TextInput` (multiline, `maxLength={500}`, placeholder
  "Anything else? (optional)") bound to `freeText`; a `PrimaryButton` "Done" (label
  "Saving…" while pending) disabled when `answer.isPending ||
  !canSubmitReflection(selected.size, freeText)`.
- **submit():**
  ```
  answer.mutate(
    { data: buildReflectionAnswer([...selected], freeText, tz) },
    {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz, draft: true }) });
        await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz }) });
        await qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        setEditing(false);
      },
      onError: (err) => toast({ title: "Couldn't save", description: apiErrorMessage(err, "Please try again.") }),
    },
  );
  ```
- **Answered view:** the selected chips as read-only `Chip`s (`active`, no `onPress`);
  `freeText` in italic if present; `ack` prefixed with ✨ if present; a `SecondaryButton`
  "Edit tonight's answer" that sets `selected = new Set(reflection.chips)`,
  `freeText = reflection.freeText ?? ""`, `editing = true`.

### `app/index.tsx` — modify

Add an "Evening reflection" `Button` in the authed branch →
`router.push("/reflection")`, directly beside #4b's "Start Focus". Minimal; matches the
existing bare smoke-test style. No other home changes.

## Data flow

```
Read:  useGetTodayReflection({ tz, draft: true }) ─► reflection | null
         isLoading ─► "Setting up tonight's reflection…"
         isAnswered(reflection, editing) ? answered view : form

Form:  toggle chips → selected:Set   +   TextInput → freeText
         Done enabled ⇔ canSubmitReflection(selected.size, freeText)
         Done ─► buildReflectionAnswer([...selected], freeText, tz)
                   ─► answerTodayReflection({ data })
                        ├ onSuccess ─► invalidate(draft) + invalidate(non-draft) + invalidate(stats) ─► editing = false
                        └ onError   ─► toast(apiErrorMessage(err, "Please try again."))

Edit:  answered view "Edit tonight's answer"
         ─► selected = Set(reflection.chips); freeText = reflection.freeText ?? ""; editing = true ─► form
```

## Testing (TDD, per repo convention)

- **`src/reflection/derivations.test.ts`** (Vitest, node, pure):
  - `buildReflectionAnswer` — passes chips through; blank/whitespace free-text →
    `freeText: undefined`; non-blank free-text is trimmed and included; `tz` set.
  - `canSubmitReflection` — 0 chips + blank text → `false`; ≥1 chip + blank → `true`;
    0 chips + whitespace-only → `false`; 0 chips + real text → `true`.
  - `isAnswered` — `reflection === null` → `false`; `answeredAt` null → `false`;
    `answeredAt` set & `editing` false → `true`; `answeredAt` set & `editing` true → `false`.
- **`src/lib/reflection-chips.test.ts`** — the copied test (no group overlap; every chip
  has a truthy label) runs green from its new location.
- **No RN render tests** — none exist in the repo and none are added. `app/reflection.tsx`,
  the `Chip` addition, and the home button are verified by
  `pnpm --filter focusquest-mobile typecheck` and the on-device G5 gate.
- **Suites stay green** — mobile `pnpm --filter focusquest-mobile test` grows by the two
  files above. Focused run:
  `pnpm --filter focusquest-mobile exec vitest run src/reflection/derivations.test.ts`.

## Files

New:

- `artifacts/focusquest-mobile/src/lib/reflection-chips.ts` (copied from web)
- `artifacts/focusquest-mobile/src/lib/reflection-chips.test.ts` (copied from web)
- `artifacts/focusquest-mobile/src/lib/api-error.ts` (copied from web)
- `artifacts/focusquest-mobile/src/reflection/derivations.ts`
- `artifacts/focusquest-mobile/src/reflection/derivations.test.ts`

Modified:

- `artifacts/focusquest-mobile/app/reflection.tsx` — rewrite to full parity (keep #4 guard + header).
- `artifacts/focusquest-mobile/app/index.tsx` — add "Evening reflection" → `/reflection`.
- `artifacts/focusquest-mobile/src/components/ui.tsx` — add `Chip` toggle.

Untouched: `src/auth/*`, `src/push/*`, `src/routing/*`, `src/toast/*` (ToastProvider is
already mounted in `app/_layout.tsx` by #4b), `src/focus/*`, `app.config.ts`, the server
(`artifacts/api-server`), all reflection endpoints (they already ship). No web changes
(the copy leaves `artifacts/focusquest/src/lib/*` in place).

## Non-goals (this spec)

- Any server change — reflection endpoints already exist.
- Shared-lib extraction of the pure bits (copied per decision 1).
- New UI or icon dependencies.
- Any change to #4b's Focus screen or #4's routing spine / `_layout.tsx` provider tree.
- Surfacing `xpAwarded` on answer (web doesn't; parity keeps the inline `ack`).

## Constraints (carried from #4 / #4b — verified, same repo)

- **NO git worktrees** (OneDrive locks). Branch-guard `git branch --show-current ==
  feat/ios-reflection-parity` before EVERY commit.
- Commit **explicit paths only** (`git add -- <path>`); never `git add -A`/`.`; never stage
  the 13 phantom `lib/api-zod/src/generated/types/` files; verify `git show --stat HEAD`
  after each commit.
- Vitest is node-env, **pure-function tests only**; no RN render-testing library exists and
  none is added. TDD the pure derivations; verify the RN screen via typecheck + the
  on-device runbook gate.
- **Generated-hook caveat**: `{ query: { enabled } }` on a generated `useGet*` fails
  typecheck (TS2741, `queryKey` required). Not needed here — the single read is ungated and
  reached only post-auth (same as #4/#4b). Confirmed `useAnswerTodayReflection` takes
  `{ data: ReflectionAnswerRequest }`.
- Extensionless local imports. Never print/commit the root `.env`.

## Execution model (matches the #4 / #4b runs)

Branch `feat/ios-reflection-parity` cut from `origin/main` (has #4b). Subagent-driven
development: implementers + per-task reviewers on sonnet, final whole-branch review on
opus. Append a **new** section to `.superpowers/sdd/progress.md` (do not overwrite
#4 / #4b). Append a **G5** on-device section to
`docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md` (Chad's manual gate).

## Device-gated verification (G5 — Chad's side, needs the iPhone)

After merge, a dev-client rebuild + on-device check:

1. **Home → Evening reflection** launches the native Reflection screen.
2. **Loading** shows "Setting up tonight's reflection…", then the prompt appears.
3. **Unanswered**: both chip groups render with correct labels; tapping toggles selection;
   Done is disabled with nothing selected and no text, and enables once ≥1 chip **or** some
   text is present.
4. **Submit**: with a couple of chips (+ optional text) tap Done → the screen flips to the
   answered view showing those chips, the italic free-text, and the ✨ ack; the dashboard
   evening card no longer prompts (both cache keys invalidated).
5. **Edit**: "Edit tonight's answer" re-opens the form pre-populated with the prior chips
   and text; re-submitting updates the answer (same-day re-answer).
6. **Save error** (e.g. offline): Done surfaces a "Couldn't save" toast; the form stays
   editable.
7. **Deep link still works**: an evening-reflection `/reflection` push tap lands on the
   (now full) Reflection screen (no regression to #4's routing).

Record pass/fail per path. A runbook G5 section is authored during implementation.
