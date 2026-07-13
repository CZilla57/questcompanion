# Questlines (Projects & Goals Hierarchy) — Core — Design

**Date:** 2026-07-13
**Branch:** `feat/questlines`
**Roadmap:** Act II "Beat the Blank Page" — the *Projects & Goals hierarchy* quest. Framed as **Questlines**: one grouping tier above a Quest, chaining related quests toward a larger objective. Foundational — later acts (Act IV Quest Campaigns) build on it.

## Scope

This spec is **Questlines core (Spec 1)** of a two-spec sequence:

- **Spec 1 (this doc):** questlines table, CRUD, quest membership, derived progress, auto-detect + manual-claim reward, and the list/focus/filter UI.
- **Spec 2 (later, not covered here):** AI-generated questlines — describe a goal, the LLM drafts the questline's quests, reusing the existing Groq/LLM seam and the task-breakdown parser pattern.

### Out of scope for v1 (explicit)

- No AI generation (Spec 2).
- No un-claim / reopen: a completed questline stays completed. Adding a quest to a completed questline does **not** re-open it and does not re-pay.
- No server-side quest-log filtering — the Quest Log filters the already-loaded task list client-side.
- No coins/gear reward — coins are Act III (unshipped); v1 pays XP only.
- Recurring quests cannot join questlines (see rules below).

## Concept & terminology

- A **Questline** is a single grouping tier that holds many **Quests** (`tasks`). A quest belongs to **0 or 1** questlines.
- `category` stays orthogonal and untouched. Category is a *life area* (health, work, errands); a questline is a *specific, finite objective*. A quest can be `#health` **and** in the "Run a 5K" questline at the same time.
- Below a quest, `task_steps` (the AI-breakdown checklist) already exists and is unaffected.

## Data model

### New table: `questlines` (`lib/db/src/schema/questlines.ts`)

| field | type | notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer, NOT NULL, FK → users | owner; denormalized ownership check, matching `task_steps`/`focus_sessions` |
| `title` | text, NOT NULL | e.g. "Run a 5K" |
| `description` | text, nullable | free notes; later doubles as the AI prompt seed (Spec 2) |
| `color` | text, nullable | small cosmetic accent for the card/badge/chip |
| `status` | text, NOT NULL, default `"active"` | `active` → `completed`. `ready-to-claim` is **derived**, never stored |
| `rewardXpAwarded` | integer, nullable | snapshot written at claim so state is auditable/reversible, mirroring `tasks.pointsAwarded` |
| `completedAt` | timestamp, nullable | set at claim |
| `createdAt` | timestamp, NOT NULL, default now | |

Register in `lib/db/src/schema/index.ts`. Export `Questline` (`$inferSelect`) and an `insertQuestlineSchema` via `createInsertSchema` omitting `id`, `createdAt`, `completedAt`, `status`, `rewardXpAwarded` — consistent with the `tasks` schema's insert-schema style.

### Membership: extend `tasks`

Add `questlineId` (integer, nullable) FK → `questlines.id`, `onDelete: "set null"`.

- Nullable = "no questline."
- On questline delete, quests are **unlinked** (`questlineId → null`), never deleted.

### Migration

`drizzle-kit push` against the shared live Neon DB. Per project convention, coordinate timing if another feature's schema is live-but-unmerged (see the shared-live-DB note); otherwise push as part of this branch's work.

## Derived progress & the "ready" state (computed, never stored)

For a questline's set of member quests:

- `total` = count of member quests.
- `done` = count of member quests with `completed = true`.
- **ready-to-claim** ⟺ `status === "active"` AND `total >= 1` AND `done === total`.
- progress bar = `done / total` (0 when `total === 0`).

## Reward on claim

- **Bonus XP** = `min(total, 8) * 25` — finite, quest-count-scaled, capped so a huge questline can't explode XP.
- Coins/gear are out of scope for v1.
- Reward is granted through the **existing** gamification XP-award path (no new XP mechanics), and the amount is snapshotted into `rewardXpAwarded` for auditability.

## Rules (invariants)

1. Only one-off quests may join a questline. A quest with `recurringTaskId != null` cannot be assigned — a recurring quest never permanently completes and would keep a questline forever un-completable. Assignment attempts on a recurring quest are rejected (`422`). *(Explicit, revisitable decision.)*
2. A quest belongs to at most one questline.
3. Claim is only valid when the questline is `active`, `total >= 1`, and `done === total`.
4. Claiming is idempotent-safe: a non-`active` (already completed) or not-ready questline rejects with `409`.
5. Deleting a questline unlinks its quests; it never deletes quests.
6. Assigning a quest to an already-`completed` questline is allowed but does not re-open it (no reopen in v1).

## API surface

Backend logic lives in an isolated, unit-tested lib and thin route handlers.

### Isolated lib: `artifacts/api-server/src/lib/questlines.ts`

Pure functions (mirrors `anchored-tasks.ts`):

- `computeProgress(quests) -> { total, done }`
- `isReadyToClaim(questline, progress) -> boolean`
- `computeRewardXp(total) -> number` (`min(total, 8) * 25`)

### Endpoints (add to `lib/api-spec/openapi.yaml`, then run orval codegen to regen the react client + zod)

- `GET /questlines` — list the owner's questlines, each enriched with `{ total, done, ready }` and `status`. Single grouped count query (no N+1). Optional `?status=active|completed` filter.
- `POST /questlines` — create `{ title, description?, color? }`.
- `GET /questlines/:id` — questline meta + progress + its quests array (powers the focus view). Reuses the existing task formatter for the quests.
- `PATCH /questlines/:id` — edit `title` / `description` / `color`.
- `DELETE /questlines/:id` — delete the questline; FK `set null` unlinks its quests.
- `POST /questlines/:id/claim` — guards rule 3/4; grants XP via the existing gamification path; snapshots `rewardXpAwarded`; sets `status="completed"`, `completedAt`; emits a "completed questline" **activity** row (reuses the activity table → surfaces in allies' milestones); returns the updated questline plus the user's new XP/level so the UI can show a level-up.

### Membership rides existing task routes (no new endpoints)

- `POST /tasks` and `PATCH /tasks/:id` accept a nullable `questlineId`. Validation: reject if the quest is recurring (`recurringTaskId != null`) or the target questline isn't owned → `422`.
- `GET /tasks` includes `questlineId` on each formatted task so the Quest Log can render chips and filter client-side.

## Frontend

### New pages

- **`/questlines` (list)** — cards showing title, `done/total` progress bar, and a status badge. Ready-to-claim cards are highlighted with a **Claim** button; completed cards read as done. A "New Questline" button opens a create dialog. Add a Questlines entry to the sidebar nav in `layout.tsx`.
- **`/questlines/:id` (focus view)** — header (title, description, progress), the questline's quests rendered with the existing `TaskItem`, an "Add quest to this questline" affordance (reuses the new-quest dialog pre-set to this questline), and the Claim button when ready.

### Quest Log integration (`tasks.tsx`, `task-item.tsx`)

- A small colored questline chip on assigned quest cards (uses the questline's `color`).
- The New/Edit quest dialog gains a **Questline** selector (active questlines + "None").
- A lightweight "filter by questline" control that filters the already-fetched task list client-side.

### Claim celebration

- Reuse the existing `dopamine-overlay.tsx` for the XP payoff moment on claim.

## Testing

### Backend

- Unit tests on `questlines.ts` pure functions: progress rollup, ready detection (including `total === 0` → not ready), and reward math (including the cap at `total >= 8`).
- Route tests: claim guards (not-ready → `409`, already-completed → `409`), XP snapshot correctness and amount, recurring-exclusion on assign (`422`), and unlink-on-delete (quests survive with `questlineId = null`).
- Style mirrors the anchored-tasks tests.

### Frontend

- Follow existing component-test conventions for the new Questline selector and list; no new test harness.

## Reuse map (what this leans on, not reinvents)

- Ownership pattern & denormalized `userId` → `task_steps` / `focus_sessions`.
- Reward snapshot-for-reversal pattern → `tasks.pointsAwarded`.
- Isolated tested lib pattern → `anchored-tasks.ts`.
- XP award path → existing `gamification` lib.
- Activity/milestones surface → existing `activity` table (allies milestone view).
- Reward celebration → `dopamine-overlay.tsx`.
- Client/zod generation → `openapi.yaml` + orval codegen.
