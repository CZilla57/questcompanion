# Ally Follow-ups — Shared Error Helper, Timezone Day-Start Fix, Inbox Pagination

## Overview

Three small, independent cleanups deferred from the ally-interactions final review
(PR #26). One branch (`chore/ally-followups`), three focused commits, one PR.

## 1. Shared API error helper

**Problem:** the API-error message extractor is duplicated — `errorMessage` in
`artifacts/focusquest/src/pages/partners.tsx` and `nudgeError` in
`artifacts/focusquest/src/components/nudge-picker.tsx`. The nudge-picker copy is
missing the `err instanceof Error && err.message` fallback branch.

**Change:**
- New `artifacts/focusquest/src/lib/api-error.ts`:
  `export function apiErrorMessage(err: unknown, fallback: string): string` —
  returns `err.data.error` if it's a string, else `err.message` if `err` is an
  `Error`, else `fallback`.
- `partners.tsx` and `nudge-picker.tsx` import and use it; both local copies are
  deleted. (nudge-picker gains the previously-missing `instanceof` branch.)
- `task-steps.tsx`'s `breakdownErrorMessage` is a **different** status-code-based
  helper and is left untouched.

## 2. Timezone day-start fix (targeted)

**Problem:** `new Date(localDateKey(now, tz) + "T00:00:00Z")` yields UTC midnight
of the local date string, which is off by the user's tz offset when compared
against real `createdAt` timestamps. This shifts "today" for the ally nudge
rate-limit and `sentToday` flags by the offset near local midnight for non-UTC
users.

**Scope decision:** targeted — fix only the 3 correctness-affecting spots in
`accountability.ts`. The other occurrences are **not** bugs:
- `users.ts` chart cutoffs re-bucket with `localDateKey(createdAt, tz)` correctly
  (the cutoff is only a multi-day window lower-bound → cosmetic edge).
- `date-buckets.ts` / `users.ts` label lines and `habit-streaks.ts` are pure
  date-string arithmetic where the UTC anchor is intentional and correct.
- `notification-scheduler.ts` is the single-user cron with no user tz.

**Change:**
- Add to `artifacts/api-server/src/lib/date-buckets.ts`:
  `export function localDayStartUtc(dateKey: string, timeZone: string): Date` —
  the UTC instant of 00:00 local time on `dateKey` in `timeZone`. Implemented via
  `Intl.DateTimeFormat(...).formatToParts` to read the zone offset at that date
  and correct the UTC-midnight guess (DST-safe).
- **TDD:** unit tests for `America/New_York` (UTC−4/−5), `Asia/Tokyo` (UTC+9),
  `UTC` (identity), and a DST-transition date.
- `accountability.ts`: replace the 3 `new Date(localDateKey(...) + "T00:00:00Z")`
  day-starts (two feeding `sentTodayFlags`, one for the rate-limit window) with
  `localDayStartUtc(today, timeZone)`.

## 3. Inbox pagination

**Problem:** `GET /accountability/nudges` caps at 50 with no pagination, so older
nudges can't be browsed. (Unread accuracy is *not* affected — `mark-all-read`
already clears all unread server-side on open.)

**Change:**
- `GET /accountability/nudges`: accept `?limit=` (clamped to [1,100], **default
  50** to preserve current behavior — matches the `focus-sessions` convention) and
  `?offset=` (integer ≥ 0, default 0). Query orders newest-first with
  `.limit(limit).offset(offset)`.
- OpenAPI: add the two optional query params to the `getNudges` operation;
  regenerate the client (`pnpm --filter @workspace/api-spec codegen`).
- Inbox tab (`partners.tsx`): a **"Load more"** button that fetches the next
  offset page and appends to an accumulated local list. The button shows only
  while the most recent page returned a full `limit` rows (i.e. more may exist).
  The accumulated list resets to the first page when the nudges query is
  invalidated (e.g. on tab open / mark-read), so it never shows stale rows.

## Verification

- `localDayStartUtc` unit tests (vitest, TDD).
- `pnpm --filter @workspace/api-server test` (existing 99 + new helper tests).
- `pnpm --filter @workspace/api-spec codegen` clean; `pnpm typecheck` (4 projects);
  `pnpm --filter @workspace/focusquest build` clean.

## Out of scope

- Migrating `users.ts`/`notification-scheduler.ts` to the new day-start helper
  (broad tz consistency) — deferred; low payoff, higher regression surface.
- A dedicated unread-count endpoint — `mark-all-read` on open makes it unnecessary.
- Cursor-based pagination — offset/limit is sufficient at this scale.
