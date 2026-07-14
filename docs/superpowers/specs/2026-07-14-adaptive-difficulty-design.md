# Adaptive Difficulty — Design

**Date:** 2026-07-14
**Act:** III — Meet the Brain Where It Is
**Status:** Approved, pre-implementation
**Depends on:** Act III spine (PR #39 — brain modes, momentum engine, "I'm Stuck" rescue), AI Task Breakdown (PR #19 — the LLM seam)

## Thesis

When a quest feels too big, one tap makes it genuinely **smaller** — not re-labeled, not sliced into more steps, but re-scoped by the LLM into a smaller true slice of the work ("Clean the kitchen" → "Clear & wipe the counters"). Lowering the activation cost of starting is the whole point; adaptive difficulty is a direct lever on it.

Every quest carries a reversible **easy / medium / hard ladder**. The user can move rungs by hand, and the app *quietly* notices when a quest keeps sticking and **offers** — never forces — a smaller version. Miss-tracking stays silent and server-side; the offer is invitational, never a report card. This honors the cross-cutting **Anti-Shame Design law**.

## Decisions locked in brainstorming

1. **"Easier" means re-scope** the quest (new smaller title, lower time estimate, fewer steps), not finer slicing of the same job or a metadata-only tag.
2. **Reversible difficulty ladder, swapped in place** — one quest keeps its identity; a `difficulty` rung points at stored variants. Not pickable siblings, not ephemeral one-shot rewrites.
3. **Manual + gentle offer** — always-available easier/harder controls, plus a silent struggle score that surfaces a non-shaming offer at a soft threshold. Never auto-rewrites; never shows a count.
4. **Four struggle signals** feed one score: forward reschedules, "I'm stuck" on this quest, days past due, skipped off the daily board.
5. **Build strategy: lazy ladder, JSON on the task** (Approach A) — draft the ladder only when first needed; store as a JSON column; no new table; LLM tokens spent only when a quest actually needs help.

## Non-goals (v1)

- Auto-*applying* a shrink without asking (offer only).
- Showing any miss/struggle count to the user, anywhere.
- Propagating variants to a recurring-task *template* (per-instance only).
- Difficulty history / analytics surfaced to the user (struggle data is Act V training material, collect-only).
- A separate "preview the smaller version before accepting" step — replaced by apply-with-Undo (lower friction, still reversible).
- Regenerating variants on est/steps edits (only title/description edits invalidate the ladder).

---

## 1. Data model

Four columns added to `tasksTable` (`lib/db/src/schema/tasks.ts`), following the existing `text`-with-default convention used by `priority`/`category`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `difficulty` | `text` | `'medium'` | Current rung: `easy` \| `medium` \| `hard` |
| `difficulty_variants` | `jsonb` | `null` | The drafted ladder; `null` until first generated |
| `struggle_score` | `integer` | `0` | Silent accumulator (explicit events only); **reset to 0 on any rung change** |
| `difficulty_offer_snoozed_at` | `timestamp` | `null` | Set on offer-dismiss or shrink-accept; suppresses re-offer |

**`difficulty_variants` shape** — `medium` is a snapshot of the user's *own* task at generation time; the LLM only drafts `easy` and `hard`. This guarantees that climbing back to medium restores the user's exact wording:

```json
{
  "easy":   { "title": "Clear & wipe the counters", "estimatedMinutes": 5,  "steps": ["Clear the counters", "Wipe them down"] },
  "medium": { "title": "Clean the kitchen",          "estimatedMinutes": 15, "steps": ["Counters", "Dishes", "Floor"] },
  "hard":   { "title": "Deep-clean the kitchen",     "estimatedMinutes": 40, "steps": ["Counters", "Dishes", "Floor", "Appliances", "Fridge"] }
}
```

**Ladder invalidation:** a manual edit to the task's `title` or `description` (via `PATCH /tasks/:id`) sets `difficulty_variants = null`, so a stale ladder can never be swapped in. The next easier/harder action re-drafts fresh. Est/steps edits do not invalidate (not material to scope framing).

## 2. LLM ladder generation

New pure module `artifacts/api-server/src/lib/ai/difficulty-variants.ts`, mirroring `lib/ai/task-breakdown.ts`:

- `buildVariantsPrompt(task)` — builds the JSON-mode prompt from `{ title, description, estimatedMinutes, steps }`.
- `parseVariants(raw)` — validates & clamps, throws `VariantsParseError` on malformed output. Rules: non-empty titles; `estimatedMinutes > 0` (integer); 0–6 steps per rung; ordering `easy.est < medium.est ≤ hard.est` (clamp/repair if the model violates, else throw).
- `generateVariants(input, generate)` — orchestrator with the `generate: GenerateJson` seam injected for testability (same pattern as `breakdownTask`).

The route reuses the shared network seam and guards from AI Task Breakdown: `generateJson` (`lib/ai/client.ts`, Groq `llama-3.3-70b-versatile`, JSON mode, 15s timeout, typed `AiClientError`), `isAiConfigured()` → 503, per-user AI cooldown → 429, parse failure → 502.

**Prompt intent (ADHD-first):**
- `easy` = a smaller *true slice* of the work with a concrete tiny first action — roughly ⅓ the time and fewer steps. It is **not** "do it worse" and **not** the same task with more sub-steps; it is a legitimately smaller job that still counts.
- `hard` = the fuller, more ambitious version of the same intent.
- All titles stay in the user's short imperative voice. Tone is encouraging, never patronizing.

## 3. Swap mechanics (reversible)

`applyDifficulty(taskId, rung)` runs in a single transaction:

1. Load the task + `difficulty_variants`.
2. Copy the target rung's `{ title, estimatedMinutes, steps }` onto the live task.
3. Replace the task's `task_steps` rows with the rung's steps (delete + re-insert with fresh `position`, all `done = false`).
4. Set `difficulty = rung`, `struggle_score = 0`, `difficulty_offer_snoozed_at = now`.
5. Leave `description` untouched (context, not scope).

Because every rung is stored, **Undo and "climb back up" are just re-applies of a stored rung — no LLM call.** Setting `snoozed_at` on apply prevents an immediate re-offer from ambient signals (e.g. an unchanged past-due date) right after the user accepts.

**Accepted v1 limitation:** swapping rungs resets step `done` flags. A smaller scope is genuinely different work, so carrying "done" across rungs would be misleading. Documented, not fixed, in v1.

## 4. Struggle score & the gentle offer

### Persisted increments (hooked into existing handlers)

- **Forward reschedule** — in `PATCH /tasks/:id` (`routes/tasks.ts` ~L376, where `dueDate` updates), when the new `dueDate` is strictly later than the stored one **and** the task is incomplete → `struggle_score += 1`. Moving the date earlier, or completing, never increments.
- **Rescue on this quest** — in `POST /rescue/events` (`routes/rescue.ts`), when `taskId` is present → `struggle_score += 1`; when `blocker === 'too_big'` → `+2` (direct "this is too big" evidence). `rescue_events.taskId` already exists (`lib/db/src/schema/rescue-events.ts:10`).

### Derived ambient signals (computed at eval time; never stored)

A pure `evaluateDifficultyOffer(task, ctx)` in a new `artifacts/api-server/src/lib/difficulty.ts` (sibling to `momentum.ts`; imports its local-day/anchored helpers rather than duplicating them) adds, on top of the persisted `struggle_score`:

- **Days past due** — reusing momentum's exact rule (`dueDate && !isAnchored && dueDate < ctx.todayStr`): `+1` per day past due, capped at `+3`.
- **Skipped off the board** — `isDailyFocus && focusDate && focusDate < ctx.todayStr && !completed` → `+1` (chosen as a daily pick on a past day, still undone).

### Offer condition

The offer surfaces when **all** hold:

- `struggle_score + ambient ≥ THRESHOLD` (const, start at `3`, tunable),
- `difficulty !== 'easy'` (room to shrink — easy is the floor, so no "rock bottom" nagging),
- task is not completed,
- not snoozed (`difficulty_offer_snoozed_at` null or older than a 3-day `SNOOZE_WINDOW`),
- AI is configured (`isAiConfigured()` — otherwise the ladder can't be drafted).

**Brain-mode tie-in:** in **frozen** mode the threshold is lowered (e.g. to `2`), so a stuck brain is offered the smaller version sooner. This reads the same derived mode the momentum engine already uses (`deriveBrainState`).

### Surfacing

`evaluateDifficultyOffer` yields a derived `difficultyOfferable: boolean`, serialized alongside the current `difficulty` rung on the task read model (`routes/tasks.ts` ~L55 serializer). Both the task list and the momentum board render from this — no dedicated endpoint needed for the flag.

## 5. API surface & client

Two new endpoints (contract-first in `lib/api-spec/openapi.yaml` → orval → `lib/api-zod` + `lib/api-client-react`):

- **`POST /tasks/:id/difficulty`** `{ level: 'easy' | 'medium' | 'hard' }` — ensures the ladder exists (generates inline if `difficulty_variants` is null; that path carries the AI 503/429/502 guards), applies the rung via `applyDifficulty`, returns the updated task. This single call backs *make easier*, *make harder*, the offer's *Make it smaller*, and *Undo*.
- **`POST /tasks/:id/difficulty/snooze`** — the offer's *Not now*; sets `difficulty_offer_snoozed_at = now`.

Guards on both: ownership (404/401 via the same pattern as breakdown), and the AI guards on any path that triggers generation.

**Query-key invalidation (Act III invariant):** a rung change is a task mutation, so every success from `useApplyDifficulty` / `useSnoozeDifficulty` must invalidate **both** the tasks key **and** `getGetTasksMomentumQueryKey()`. `refetchOnWindowFocus:false` means staleness never self-heals.

**Client UX (`artifacts/focusquest/src/components/task-item.tsx`):**
- A subtle difficulty control (easier ⇄ harder) on the task item, reflecting the current `difficulty` rung.
- When `difficultyOfferable`, an inline, low-key chip: *"This one keeps sliding — want a smaller version?"* with **[Make it smaller]** (applies `easy`, then shows the result with an **Undo** affordance) and **[Not now]** (calls snooze).
- First-time generation shows the same ~1–2s spinner already used by the breakdown button.

## 6. Anti-shame guardrails

- `struggle_score` never leaves the server and is rendered as **no count anywhere**.
- Offer copy is invitational ("keeps sliding"), never accusatory ("you missed this 3×").
- Shrinking **resets** the score — a clean slate, consistent with "streaks restart clean."
- No writes to `activityTable` / ally feeds — difficulty changes are private (like brain check-ins and rescue events).
- Snooze is always respected; the app never nags.
- `easy` is a floor with no "rock bottom" messaging; no offer fires once a quest is at `easy`.

## 7. Edge cases

- **Anchored quests** (no due date): skip only the days-past-due signal; all other signals and controls apply.
- **Recurring instances**: variants and difficulty are per-instance; the recurring template is untouched in v1. Title swaps respect `unique(userId, recurringTaskId, dueDate)`.
- **AI not configured**: difficulty controls and offers are hidden; the endpoint returns 503 on a generation path.
- **Completed quests**: never offer.
- **Tiny quests** (already ~2 min): rarely reach threshold; the prompt is instructed to no-op gracefully if it can't produce a meaningfully smaller `easy`.
- **Ladder staleness after manual edit**: title/description edit nulls `difficulty_variants`; next action re-drafts.

## 8. Testing strategy (TDD, vitest)

**Pure functions (unit):**
- `parseVariants` — valid parse; clamp est/steps; ordering repair; throws `VariantsParseError` on malformed/empty.
- `evaluateDifficultyOffer` — each signal in isolation and combined; threshold boundary; snooze window; `easy`-floor suppression; anchored skips past-due; frozen-mode lowered threshold; completed suppression.
- Rung → task field mapping in `applyDifficulty` (given a variants blob).

**Routes (integration):**
- `POST /tasks/:id/difficulty`: generation guards (503 no-AI, 429 cooldown, 502 parse-fail); successful swap updates task + steps, resets `struggle_score`, sets `snoozed_at`; ownership 404/401; `medium` restores the stored snapshot.
- `POST /tasks/:id/difficulty/snooze`: sets timestamp; ownership.

**Handler increments:**
- `PATCH /tasks/:id`: forward+incomplete increments; backward or completed does not; title/description edit nulls `difficulty_variants`.
- `POST /rescue/events`: `taskId` present increments; `blocker='too_big'` adds `+2`; no `taskId` is a no-op for struggle.

**Client:**
- Chip renders only when `difficultyOfferable`; hidden when AI unconfigured.
- Apply → Undo path; both tasks and momentum query keys invalidated on success.

## 9. Implementation notes / sequencing

- **Schema push**: adds columns to the shared live Neon DB. Act III (PR #39) schema is already merged to `main`, so there's no unmerged-schema conflict to defer behind; `drizzle push` can run when implementation lands (see [[reference-shared-live-db-branches]]).
- **Ordering hint**: schema → pure `difficulty-variants.ts` + `evaluateDifficultyOffer` (TDD) → routes + openapi → client hooks → `task-item.tsx` UI → struggle hooks in PATCH/rescue handlers. The pure evaluator and the LLM module are independent and can be built in parallel.
- **Momentum route mounting** stays as-is; the offer flag rides the tasks serializer, not a new `/tasks/*` static segment, so no route-order concerns.
