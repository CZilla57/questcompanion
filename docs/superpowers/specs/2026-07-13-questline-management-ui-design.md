# Questline Management UI (polish + edit/delete) — Design

**Date:** 2026-07-13
**Branch:** `feat/questline-management-ui`
**Follows:** the shipped Questlines core (PR #29, `docs/superpowers/specs/2026-07-13-questlines-design.md`). This is the first of two planned follow-up cycles; **AI-generated questlines** is the second, separate cycle (not covered here).

## Goal

Close the questline-management gaps the final review flagged: let users add quests to a questline from its own page, see/edit questline membership even for completed questlines, and edit/delete a questline (name, description, accent color). No new backend behavior beyond a contract tidy-up and the frontend wiring of already-generated endpoints.

## Scope

In:
1. **Detail-page quick-add** — add a quest directly on `/questlines/:id`, pre-attached to that questline.
2. **Completed-questline visibility** — the Quest Log filter and the edit-quest selector show completed questlines (labeled), so a quest in a completed questline stays visible/representable.
3. **Edit questline** — dialog (title / description / color via preset swatches) on the detail page.
4. **Delete questline** — confirm dialog on the detail page; unlinks quests (never deletes them), returns to the list.
5. **Contract fix** — a `QuestlineUpdate` schema (all optional) so `PATCH /questlines/{id}` matches its title-optional handler.

Out (deferred / separate):
- AI-generated questlines (next cycle).
- List-card ⋯ menus (edit/delete live only on the detail page for now).
- Reordering quests within a questline; questline archiving.

## Design

### 1. Detail-page quick-add (reuse `QuickAddBar`)

Extend `artifacts/focusquest/src/components/quick-add-bar.tsx` with an optional prop:

```ts
export function QuickAddBar({ selectedDate, questlineId }: { selectedDate: Date | undefined; questlineId?: number })
```

- When `questlineId` is provided, include it in the `useCreateTask` payload (`data: { ..., questlineId }`).
- On success, in addition to invalidating `getGetTasksQueryKey()`, also invalidate `getGetQuestlinesQueryKey()` and, when `questlineId != null`, `getGetQuestlineQueryKey(questlineId)`, so the questline's progress updates immediately.
- The success toast copy is unchanged.

On `artifacts/focusquest/src/pages/questline-detail.tsx`, render `<QuickAddBar selectedDate={new Date()} questlineId={questline.id} />` at the top of the quests area (above the list; replaces the bare empty-state hint — keep a short hint below the bar only when the list is empty). Created quests are one-off, dated today by default (QuickAddBar's existing behavior), which satisfies the one-off-only membership rule.

### 2. Completed-questline visibility

In `artifacts/focusquest/src/pages/tasks.tsx`:
- Change the single existing `useGetQuestlines({ status: "active" })` call to `useGetQuestlines()` (all questlines) — one query, not two.
- The **filter** control and the **edit-quest** selector list **all** questlines; completed ones render with a "· done" suffix on their label.
- The **new-quest (create)** selector lists only the active subset, derived client-side: `const activeQuestlines = (questlines ?? []).filter((q) => q.status === "active")`.
- The filter over already-fetched tasks is unchanged in mechanism; only the option lists change.

### 3. Edit questline (detail-page header)

- Add an **Edit** icon-button (pencil) to the `/questlines/:id` header.
- Opens a dialog with: **Title** (Input, required), **Description** (Textarea, optional), **Color** (swatch row).
- **Color swatches:** a fixed palette of ~7 theme-aligned accent hexes plus a "None" option. Proposed set (final hexes chosen to match the existing neon/category palette in `@/lib/categories`): cyan `#22d3ee`, violet `#a78bfa`, emerald `#34d399`, amber `#fbbf24`, rose `#fb7185`, sky `#38bdf8`, lime `#a3e635`; plus **None** (clears to null). Selecting a swatch sets `color` to that hex; "None" sets `color: null`. The selected swatch shows a ring.
- Save calls `useUpdateQuestline({ id, data: { title, description, color } })`; on success invalidate `getGetQuestlineQueryKey(id)` + `getGetQuestlinesQueryKey()`, close the dialog, toast "Questline updated".
- The header's `Scroll` icon and the list card/chip already read `questline.color` for their accent, so a set color takes effect immediately.

### 4. Delete questline (detail-page header)

- Add a **Delete** icon-button (trash) to the header.
- Opens a confirm dialog: title "Delete this questline?", body "Its {total} quests will be unlinked (kept as regular quests), and this questline will be removed." Cancel / Delete (destructive).
- Delete calls `useDeleteQuestline({ id })`; on success invalidate `getGetQuestlinesQueryKey()`, toast "Questline deleted", and navigate to `/questlines` (wouter `setLocation`/`navigate`).

### 5. Contract fix — `QuestlineUpdate`

In `lib/api-spec/openapi.yaml`:
- Add a `QuestlineUpdate` schema: object with **all-optional** `title` (minLength 1, maxLength 120), `description` (`["string","null"]`), `color` (`["string","null"]`).
- Point `PATCH /questlines/{id}`'s requestBody at `QuestlineUpdate` instead of `QuestlineInput`.
- Regenerate the client (`pnpm --filter @workspace/api-spec codegen`). `useUpdateQuestline` will then accept partial bodies, matching the existing handler (which already treats every field as optional). **No handler change needed** — this is a contract-to-implementation alignment only.

## Data model

No schema/table changes. `color` already exists on `questlines` (nullable text). No migration, no `drizzle push`.

## Testing

- Backend: no logic change → no new backend unit tests. The `PATCH` handler is unchanged; `pnpm typecheck` + the existing api-server suite are the gate for the contract regen.
- Frontend: verification is `pnpm typecheck` + the browser walkthrough (add a quest from the detail page → progress ticks; edit title/color → accent updates; delete → quests survive unlinked and you land on the list; filter shows a completed questline's quests).

## Reuse map

- Quest creation with natural-language parsing → existing `QuickAddBar` (extended, not rebuilt).
- Questline mutations → already-generated `useUpdateQuestline` / `useDeleteQuestline` (currently unwired).
- Dialogs/inputs/toasts → existing shadcn `Dialog` / `Input` / `Textarea` / `Button` + `useToast`.
- Color accent consumption → existing `questline.color` reads on the card/chip/header icon.
- Navigation → wouter `useLocation`/`navigate`, as in `partner-detail.tsx`.
