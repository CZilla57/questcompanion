# UI Polish — Questline cleanups + app-wide error messages — Design

**Date:** 2026-07-13
**Branch:** `chore/ui-polish`
**Follows:** the three shipped Questlines PRs (#29/#30/#31). This bundles the non-blocking polish items deferred by their reviews.

## Goal

Clear the deferred cosmetic/a11y/quality backlog: DRY a duplicated label, make the color swatches screen-reader-friendly, stop the detail-page quick-add from stealing focus, fix a misleading success toast, and — app-wide — surface real server error messages that are currently swallowed.

## Scope

Five small, independent changes. No behavior changes beyond the error-message text that users see and the a11y semantics.

1. **`questlineLabel` helper** (`tasks.tsx`) — DRY.
2. **Color-swatch a11y** (`questline-edit-dialog.tsx`).
3. **Detail-page quick-add autofocus** (`quick-add-bar.tsx` + `questline-detail.tsx`).
4. **Delete-success toast styling** (`questline-detail.tsx`).
5. **App-wide error-message fix** (7 files → existing `apiErrorMessage`).

Out: the suggest-cooldown-before-model-call behavior (systemic across breakdown/parse/suggest — the reviews recommended leaving it consistent; not touched here).

## Design

### 1. `questlineLabel(ql)` — DRY the "· done" label

In `artifacts/focusquest/src/pages/tasks.tsx`, the filter `<Select>` and the edit `<Select>` both render `{ql.title}{ql.status === "completed" ? " · done" : ""}`. Extract a module-scope helper and use it in both:

```ts
function questlineLabel(ql: { title: string; status: string }): string {
  return ql.status === "completed" ? `${ql.title} · done` : ql.title;
}
```

(Local helper, not a shared lib — used in one file; DRY without premature abstraction.)

### 2. Color-swatch a11y (`questline-edit-dialog.tsx`)

The swatch row is single-select (a color or "None"). Give it radiogroup semantics:
- Container `<div>` gets `role="radiogroup"` + `aria-label="Accent color"`.
- Each swatch button and the "None" button get `role="radio"` + `aria-checked={color === c}` (and `aria-checked={color == null}` for None). Keep the existing `aria-label`s and the visual ring/selection state.

### 3. Detail-page quick-add autofocus (`quick-add-bar.tsx` + `questline-detail.tsx`)

`QuickAddBar`'s input is hardcoded `autoFocus`, which is fine on the Quest Log (its primary affordance) but intrusive on `/questlines/:id` (steals focus / pops the mobile keyboard on every visit).

- Add an optional prop: `autoFocus?: boolean` (default `true`), and change the input to `autoFocus={autoFocus}`.
- On the detail page, render `<QuickAddBar selectedDate={new Date()} questlineId={questline.id} autoFocus={false} />`.
- The existing Quest Log usage (`<QuickAddBar selectedDate={date} />`) is unchanged and keeps autofocus via the default.

### 4. Delete-success toast (`questline-detail.tsx`)

`handleDelete`'s success toast currently uses `variant: "destructive"` (red) for a *successful* deletion. Change it to a neutral confirmation consistent with other success toasts — drop the `variant` and use a plain toast: `toast({ title: "Questline deleted" })`. (The delete confirm dialog already conveyed the destructive intent; the success message should read as a calm confirmation.)

### 5. App-wide error-message fix (7 files → `apiErrorMessage`)

`ApiError` stores the parsed server body on `err.data` (and the raw `Response` on `err.response`). Ten call sites across seven files read `err?.response?.data?.error ?? "<fallback>"`, which is always `undefined` (a `Response` has no `.data`), so real server messages (e.g. "title is required", a friendly 409) never surface. The repo already has the correct helper `apiErrorMessage(err, fallback)` in `artifacts/focusquest/src/lib/api-error.ts` (reads `err.data.error`, then `Error.message`, then fallback) — used by `nudge-picker.tsx` / `partners.tsx`.

Replace each `toast({ title: err?.response?.data?.error ?? "<fallback>", ... })` with `toast({ title: apiErrorMessage(err, "<fallback>"), ... })`, importing `apiErrorMessage` from `@/lib/api-error`, in:
- `artifacts/focusquest/src/pages/questlines.tsx`
- `artifacts/focusquest/src/pages/questline-detail.tsx`
- `artifacts/focusquest/src/components/questline-edit-dialog.tsx`
- `artifacts/focusquest/src/components/task-item.tsx`
- `artifacts/focusquest/src/pages/tasks.tsx`
- `artifacts/focusquest/src/pages/dashboard.tsx`
- `artifacts/focusquest/src/pages/dopamine-menu.tsx`

Keep each existing fallback string and the surrounding toast options (variant/className) exactly as they are — only the message-resolution changes. Where an `onError` currently types the param as `(err: any)`, it can keep that or narrow to `(err: unknown)`; leave as-is to minimize churn.

## Data model

None. No backend, schema, or contract changes; no codegen; no `drizzle push`.

## Testing

- No new unit tests (no new pure logic; `apiErrorMessage` is already covered where it was introduced). If `apiErrorMessage` lacks a test, this pass does not add one — out of scope.
- Verification: `pnpm typecheck` (root). The a11y, focus, toast, and error-text changes are exercised in the (user-run) browser walkthrough — e.g. trigger a server 4xx (create a questline with an empty title via the API path, or a recurring-quest questline assignment) and confirm the real message appears; tab to the color swatches and confirm they announce as a radio group.

## Reuse map

- Error messaging → existing `apiErrorMessage` (`@/lib/api-error`), already used in nudge/partners.
- Autofocus toggle → a standard optional prop with a back-compatible default.
- Everything else → existing components/toasts; no new files.
