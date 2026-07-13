# AI-Generated Questlines — Design

**Date:** 2026-07-13
**Branch:** `feat/questline-ai-generation`
**Follows:** Questlines core (PR #29) + Questline Management UI (PR #30). This is the **second and final** planned Questlines follow-up (the "Spec 2" referenced in the core spec).

## Goal

Let a user beat the blank-questline wall: type a goal ("Run a 5K") in the New Questline dialog, have the LLM draft ~3–6 concrete quests, review/trim them in an editable preview, and create the questline with the kept quests in one shot — as anchored (no-deadline) quests.

## Scope

In:
1. **AI suggestion** — a side-effect-free endpoint that turns a goal string into 3–6 suggested quest titles, reusing the existing Groq `generateJson` seam.
2. **Atomic create-with-quests** — extend `POST /questlines` to optionally accept `questTitles`, creating the questline + those quests (anchored, attached) in one transaction.
3. **Editable preview UX** — in the New Questline dialog: "Draft quests with AI" → rows (checkbox + editable title) → Create.

Out (deferred / not needed):
- Suggesting quests for an already-created questline (chose create-time entry only).
- Per-quest AI metadata (dates, priorities) — quests are anchored; priority/category come from the existing auto-points logic.
- Regenerate-history, streaming, or multi-turn refinement.

## Reuse map

- LLM client + config check → existing `generateJson`, `isAiConfigured`, `AiClientError` (`artifacts/api-server/src/lib/ai/client.ts`).
- Prompt/parser/seam shape → mirror `artifacts/api-server/src/lib/ai/task-breakdown.ts` (`buildBreakdownPrompt`/`parseBreakdown`/`breakdownTask` + `BreakdownParseError` + `GenerateJson` type).
- Per-user cooldown → `createCooldown(intervalMs)` from `artifacts/api-server/src/lib/ai/breakdown-cooldown.ts` (mirror `parse-cooldown.ts`).
- Endpoint error ladder (503 unconfigured / 429 cooldown / 502 model-or-parse) → mirror `POST /tasks/parse` and `POST /tasks/:id/breakdown`.
- Anchored one-off quest creation → the anchored path of `POST /tasks` (`isAnchored: true`, `dueDate: null`, points/category via `assignPoints`).
- Questline creation + `formatQuestline` → existing `POST /questlines` handler (`artifacts/api-server/src/routes/questlines.ts`).
- Client generation → `openapi.yaml` + orval codegen.

## Data model

**No schema/table changes.** Generated quests are ordinary `tasks` rows (anchored, `questlineId` set). No migration, no `drizzle push`.

## Backend

### 1. Pure lib — `artifacts/api-server/src/lib/ai/questline-quests.ts`

Mirrors `task-breakdown.ts`. Exports:

- Consts: `MIN_QUESTS = 3`, `MAX_QUESTS = 6`, `MAX_QUEST_LENGTH = 120`, `MAX_QUESTLINE_QUESTS = 12` (hard cap on how many quests a single create call may attach).
- `class QuestlineQuestsParseError extends Error`.
- `buildQuestlineQuestsPrompt(goal: string): string` — an ADHD-tuned prompt: given a goal, return 3–6 concrete, actionable quests (milestones/steps that move the goal forward), each a short imperative phrase, JSON only, shape `{"quests": ["...", "..."]}`. (Distinct from task-breakdown's single-task first-steps framing: here the input is a *goal* and the output is *quests toward it*.)
- `parseQuestlineQuests(raw: unknown): string[]` — validate `{ quests: string[] }`; trim, drop empties, cap each to `MAX_QUEST_LENGTH`, `slice(0, MAX_QUESTS)`; throw `QuestlineQuestsParseError` if fewer than `MIN_QUESTS` survive. (Mirrors `parseBreakdown`.)
- `suggestQuestlineQuests(goal, generate: GenerateJson): Promise<string[]>` — build → generate → parse.
- `sanitizeQuestTitles(titles: string[], max = MAX_QUESTLINE_QUESTS): string[]` — pure helper used by the create handler: trim, drop empties, cap each to `MAX_QUEST_LENGTH`, `slice(0, max)`. (Testable seam for the create path's title hygiene.)

### 2. Cooldown — `artifacts/api-server/src/lib/ai/suggest-cooldown.ts`

Mirror `parse-cooldown.ts`: `export const suggestCooldown = createCooldown(3000)` (3s per user).

### 3. Endpoint — `POST /questlines/suggest-quests`

Body `{ goal: string }`. Handler (in `routes/questlines.ts`):
- 401 if unauthenticated.
- 400 if `goal` missing/empty or `> 200` chars.
- 503 if `!isAiConfigured()`.
- 429 if `!suggestCooldown.tryAcquire(userId)`.
- Else: `parseQuestlineQuests` over `generateJson(buildQuestlineQuestsPrompt(goal))`; on `AiClientError | QuestlineQuestsParseError` → 502 with a friendly message; success → `{ quests: string[] }`.
- **Side-effect-free** — creates nothing.

### 4. Extend `POST /questlines` create with `questTitles`

Body becomes `{ title, description?, color?, questTitles?: string[] }`.
- When `questTitles` is a non-empty array: run `sanitizeQuestTitles(questTitles)`, then in a **single transaction** insert the questline, then insert one anchored quest per sanitized title (`userId`, `title`, `points`+`category` via `assignPoints(title, "medium")`, `priority: "medium"`, `dueDate: null`, `isAnchored: true`, `questlineId: <new id>`). Return `formatQuestline(row, { total: createdCount, done: 0 })`.
- When absent/empty: current behavior (questline only, `total: 0`).

## API contract (`lib/api-spec/openapi.yaml`)

- Add `questTitles` to `QuestlineInput`: `type: array`, `items: { type: string, maxLength: 120 }`, `maxItems: 12`, optional, described as "Optional quest titles to create (anchored) with the questline."
- New path `POST /questlines/suggest-quests`, `operationId: suggestQuestlineQuests`, requestBody `SuggestQuestlineQuestsInput` (`{ goal: string, minLength 1, maxLength 200 }`), 200 → `SuggestedQuestlineQuests` (`{ quests: string[] }`), plus 429/502/503 → `ErrorEnvelope`.
- Regenerate client (`pnpm --filter @workspace/api-spec codegen`) → `useSuggestQuestlineQuests`, `useCreateQuestline` body now carries optional `questTitles`.

## Frontend (`artifacts/focusquest/src/pages/questlines.tsx`)

Extend the existing "New Questline" create dialog:
- New state: `draftQuests: { text: string; included: boolean }[]` and the `useSuggestQuestlineQuests` mutation.
- **"Draft quests with AI"** button (enabled once `title` is non-empty). On click: `mutate({ data: { goal: title.trim() } })`. On success, set `draftQuests` from the returned titles (all `included: true`). On error, toast by status: 503 "AI drafting isn't set up yet.", 429 "Give it a moment and try again.", else "Couldn't draft quests — add them manually."
- **Draft rows:** for each draft, a checkbox (toggle `included`) + an `Input` (edit `text`). A subtle count/hint ("Uncheck any you don't want").
- **Create:** `useCreateQuestline` with `{ data: { title, description: description.trim() || null, ...(kept.length ? { questTitles: kept } : {}) } }` where `kept = draftQuests.filter(d => d.included && d.text.trim()).map(d => d.text.trim())`. On success, invalidate `getGetQuestlinesQueryKey()`, close, reset, and navigate to `/questlines/${created.id}` (land on the new questline showing its quests). The no-AI path is unchanged (no `questTitles`).
- AI availability is not pre-checked; the button always shows and 503 is handled gracefully (consistent with the AI task-breakdown UX).

## Testing

- Backend unit tests — `artifacts/api-server/src/lib/ai/questline-quests.test.ts` (mirror `task-breakdown.test.ts`): `parseQuestlineQuests` valid parse; missing/non-array `quests` → error; `< MIN_QUESTS` → error; per-item length cap; `slice` to `MAX_QUESTS`; `sanitizeQuestTitles` trims/drops-empties/caps count; `buildQuestlineQuestsPrompt` includes the goal text.
- Endpoints + create-with-quests: verified by `pnpm typecheck` and the pure-helper tests (no HTTP harness in this repo, per convention). `pnpm --filter @workspace/api-server test` is the regression gate.
- Frontend: `pnpm typecheck`; authenticated browser walkthrough is user-run (Auth0 gate): type a goal → Draft → uncheck one → Create → land on the detail page with the kept quests as anchored quests.

## Ops

Requires `GROQ_API_KEY` in the Render prod env (already set for AI task-breakdown / quick-add). If unset, the feature degrades gracefully to the manual create path (503 → toast).
