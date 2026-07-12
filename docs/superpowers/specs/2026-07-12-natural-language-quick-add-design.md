# Natural-Language Quick-Add

## Overview

Let a user capture a fully-structured quest by typing one line. A string like

```
Email Sam re: budget tomorrow 3pm #work !high
```

parses into `{ title: "Email Sam re: budget", dueDate: <tomorrow>, dueTime: "15:00",
priority: "high", category: "deep_work" }` and lands in the Quest Log with a single
Enter. The goal is *capture at the speed of thought* — no dialog, no field-by-field
tabbing.

Parsing is **hybrid**. A deterministic grammar runs live and free on every keystroke and
covers the common shapes (dates, times, `#tag`, `!priority`). An on-demand **"Smart parse
✨"** button makes a single Groq call for the rarer case where a user phrased the schedule
in a way the grammar didn't catch. The deterministic path is always the default; the LLM
never fires on its own.

This feature reuses three things that already exist: the keyword→category + XP engine
(`auto-points.ts`, surfaced via `/api/tasks/suggest-points`), the swappable LLM seam
(`ai/client.ts`, Groq), and the standard `POST /tasks` create path. It adds one new column
(`tasks.dueTime`), one pure shared package, one server endpoint, and one client component.

## Product decisions (settled)

| Decision | Choice |
|---|---|
| Parse engine | **Hybrid** — deterministic grammar (live, client-side) + on-demand LLM fallback (Groq, server-side) |
| When the LLM fires | **On-demand only.** A "Smart parse ✨" button appears when the deterministic parser found no date/time; clicking it makes one Groq call. Never automatic. |
| Time-of-day | **Add a nullable `dueTime` to `tasks`.** Parse and persist `3pm` → `"15:00"`; display it on the quest |
| Hashtags | **`#tag` → category via an alias map.** Unknown tags are stripped from the title and ignored; category then falls to keyword auto-categorization |
| UI surface | A **pinned quick-add bar** at the top of the Quest Log with a live chip preview; the existing "New Quest" dialog stays as the manual/advanced path |
| Task creation | Single-path through the existing `POST /tasks`. The `/parse` endpoint only *returns* a parse; it never creates |

## Data model

One new column on the existing `tasks` table (`lib/db/src/schema/tasks.ts`):

| column | type | notes |
|---|---|---|
| `dueTime` | `text`, nullable | `HH:mm`, 24-hour (e.g. `"15:00"`). Null = no specific time. Mirrors the `text` `timeOfDay` already used by `recurring_tasks` for format consistency |

Rationale for `text` over a Postgres `time` type: `recurring_tasks.timeOfDay` is already
`text "08:00"`, the value is only ever a wall-clock `HH:mm` with no date/zone, and keeping
it as a validated string avoids driver `time`-type serialization quirks.

Applied via `drizzle push` (see the `.env` export gotcha in the dev-commands reference).
`insertTaskSchema` gains an optional `dueTime`.

## The shared parser — `lib/quick-add` (new pure package)

A dependency-free workspace package (`lib/quick-add`, following the `lib/*` convention),
imported by **both** the React client (live preview) and the api-server (deterministic
pre-pass in `/parse`). Keeping one implementation is what stops the two hybrid paths from
diverging.

### Public surface

```ts
export interface ParsedQuickAdd {
  title: string;              // cleaned remainder after tokens stripped
  dueDate?: string;           // YYYY-MM-DD (caller's local calendar)
  dueTime?: string;           // HH:mm 24h
  priority?: "low" | "medium" | "high";
  category?: string;          // canonical slug, only when an explicit #tag matched
}

export function parseQuickAdd(
  input: string,
  opts: { now: Date },        // injected clock → deterministic, testable, timezone-correct
): ParsedQuickAdd;

export const CATEGORY_ALIASES: Record<string, string>;  // #tag word → canonical slug
```

`now` is injected rather than read from `Date.now()` so every date phrase resolves against
a known instant — this makes the parser pure and its tests timezone-stable.

### Grammar

Tokens may appear anywhere in the string. Each recognized token is removed; the trimmed,
whitespace-collapsed remainder is the `title`.

| Token | Examples | Result |
|---|---|---|
| Priority | `!high`/`!hi`/`!h`, `!med`/`!medium`/`!m`, `!low`/`!lo`/`!l` | `priority` (case-insensitive; **last wins** if repeated; default `medium` applied by the create path, not stored on the parse) |
| Category tag | `#work`, `#chore`, `#health`, `#deep_work` | `category` resolved via `CATEGORY_ALIASES` (curated synonyms + the 9 canonical slugs). **Unknown** `#tag` → token stripped, `category` left undefined |
| Time | `3pm`, `3:30pm`, `9am`, `15:00`, `noon`, `midnight` | `dueTime` as `HH:mm` |
| Date | `today`, `tonight`, `tomorrow`/`tmr`/`tmrw`, `mon`…`sun` + full names, `next fri`, `in 3 days`, `in 2 weeks`, `7/15`, `07/15/2026`, `2026-07-15`, `Jul 15`/`15 Jul` | `dueDate` as `YYYY-MM-DD` in the caller's local calendar |

Resolution rules:

- **Category precedence:** explicit known `#tag` › (later, on create) keyword
  auto-category on the title › `default`. The parser only sets `category` for an explicit
  matched `#tag`; everything else is left to the existing server-side `assignPoints`.
- **Date/time interplay:** a bare time (`3pm`) with no date → the create path defaults
  `dueDate` to today/the selected date. A bare date → `dueTime` stays undefined.
- **Invalid tokens are inert:** an impossible date (`Feb 30`, `13/40`) or a malformed time
  fails its matcher and is treated as ordinary title text rather than throwing. Weekday
  names resolve to the *next* future occurrence; `next <weekday>` skips to the following
  week.
- **Weekday resolution:** a bare weekday (`mon`) = the nearest *future* date with that
  weekday, **today excluded** (so `mon` typed on a Monday resolves to the following
  Monday). `next <weekday>` = the occurrence in the following calendar week.

`CATEGORY_ALIASES` is seeded generously so common words work without a full tags system:
e.g. `work/job/office → deep_work`, `chore/chores/home → household`, `gym/run/workout →
health`, `money/bills/budget → finance`, `study/read → learning`, `email/errand/admin →
admin`, `friends/family/call → social`, `art/draw/music → creative`, plus each canonical
slug mapping to itself.

## Server — `POST /api/tasks/parse`

New Express route in `artifacts/api-server/src/routes/tasks.ts`, then added to
`lib/api-spec/openapi.yaml` and the client regenerated so a `useParseQuickAdd` hook is
produced (mirroring `useBreakdownTask`).

Body: `{ text: string }`. Returns a `ParsedQuickAdd`. **Does not create a task** — the
client drops the result into the same preview the deterministic parser feeds, and creation
still goes through `POST /tasks` on confirm.

Flow:

1. Auth (`req.isAuthenticated()` → `401`).
2. Run the shared `parseQuickAdd(text, { now: new Date() })`.
3. If that result already has a `dueDate` **or** `dueTime`, return it directly — no Groq
   call (the deterministic path was sufficient; the client normally wouldn't even call
   `/parse` in this case, but the short-circuit keeps the endpoint honest and cheap).
4. Otherwise gate the LLM call:
   - `isAiConfigured()` false → `503 { error: "AI parse is not configured" }`.
   - Per-user cooldown reusing the breakdown-cooldown pattern (a `Map<userId, lastMs>`;
     its own `parseCooldown` instance) → `429` if too frequent.
5. Call Groq through the existing `generateJson(prompt)` seam with a new
   `buildQuickAddPrompt(text, { now })` that asks for JSON
   `{ title, dueDate, dueTime, priority, category }` and states today's local date so
   relative phrases resolve correctly.
6. **Normalize and clamp** the model output with a pure `parseQuickAddResult(raw)`:
   - `title` required non-empty string, else fall back to the deterministic title / the
     raw text.
   - `dueDate` must match `^\d{4}-\d{2}-\d{2}$` and be a real date, else dropped.
   - `dueTime` must match `^\d{2}:\d{2}$` in range, else dropped.
   - `priority` clamped to `low|medium|high`, else dropped.
   - `category` clamped to a valid slug (`VALID_CATEGORIES`), else dropped.
   - Merge over the deterministic result (deterministic wins on any field it already set).
   - Model/parse failure → `502 { error: "Couldn't smart-parse, edit manually" }`.
7. Return the merged `ParsedQuickAdd`.

The prompt+normalizer split mirrors the `task-breakdown.ts` (pure) + `client.ts` (IO)
pattern already in the AI module: `buildQuickAddPrompt` and `parseQuickAddResult` are pure
and unit-tested; the route wires them to `generateJson`.

## Create + serialize changes

`POST /tasks` and `PATCH /tasks/:id` (`routes/tasks.ts`):

- Accept optional `dueTime`. Validate `^\d{2}:\d{2}$` + `00:00`–`23:59`; reject malformed
  with `400` (create) or ignore on patch, consistent with how `category` is guarded today.
- Persist `dueTime` on insert/update.

`formatTask` gains `dueTime: task.dueTime ?? null`. `openapi.yaml` adds `dueTime` to the
Task response schema and the create/update request bodies; regenerate `api-client-react` +
`api-zod`.

Because the deterministic parser runs client-side and sends the literal `dueDate` /
`dueTime` strings it computed from the browser's local clock, the feature sidesteps the
server's known UTC "today" quirk for these values — the server stores exactly what the
client resolved.

## Frontend — `QuickAddBar`

New component `artifacts/focusquest/src/components/quick-add-bar.tsx`, rendered at the top
of the Quest Log (`pages/tasks.tsx`), above the filter row and below the page header.

- Controlled single-line `Input`. On each change, run `parseQuickAdd(value, { now: new
  Date() })` locally (synchronous, free).
- **Chip preview row** beneath the input, showing only the fields that parsed: a date chip
  (relative label — "Tomorrow", "Fri Jul 18"), a time chip (`3:00 PM`), a priority chip,
  a category chip (colored via `CATEGORY_HEX_COLORS`), and the XP.
- **Category + XP chip source:** when the parse set an explicit `#tag` category, use it
  directly. Otherwise reuse the existing debounced `/api/tasks/suggest-points?title=<cleaned
  title>&priority=<parsed priority>` call (the same mechanism `usePointPreview` already
  uses in the dialog) to preview the auto-category and XP.
- **Smart parse ✨** button appears (subtle, inline) only when the deterministic parse has
  a non-trivial title but **no `dueDate` and no `dueTime`**. Clicking calls
  `useParseQuickAdd({ text })`; the returned parse replaces the preview (fields it fills
  are marked as AI-derived with a subtle ✨). Disabled while pending.
- **Enter** (or an "Add" button) → build the `POST /tasks` payload from the current parse:
  `title` (required — empty title is a no-op / disabled), `dueDate` (parsed, else the
  page's selected date, else today), `dueTime` (if any), `priority` (else medium),
  `category` (only if explicit `#tag`). On success: success toast (reuse the existing
  "Quest added — N XP" copy), clear the input, `invalidateQueries(getGetTasksQueryKey())`.
- **Accessibility:** the input has a visible/associated label and a short "type e.g.
  *Email Sam tomorrow 3pm #work !high*" hint; chips carry `aria-label`s naming the field;
  the Smart-parse button is keyboard reachable; errors surface via the existing toast
  system (matching the a11y polish from the breakdown work).

`TaskItem` (`components/task-item.tsx`): render `dueTime` next to the existing due-date
display (e.g. `Due Jul 13 · 3:00 PM`) when present.

## Data flow

**Fast path** — `Email Sam re: budget tomorrow 3pm #work !high`:
client `parseQuickAdd` → `{title, dueDate:<tomorrow>, dueTime:"15:00", priority:"high",
category:"deep_work"}` → chips render (XP via suggest-points on the cleaned title) → Enter
→ `POST /tasks` → `201` → toast + list refresh. No network parse call.

**Fallback path** — `ping the landlord about the leak sometime next week`:
deterministic parse → title only, no date/time → **Smart parse ✨** appears → click →
`POST /api/tasks/parse` → server runs deterministic (insufficient) → Groq → normalized
`{title:"Ping the landlord about the leak", dueDate:<next monday>, priority:"medium"}` →
preview fills → user confirms → `POST /tasks`.

## Error handling

| Condition | Response | UX |
|---|---|---|
| Empty title after parse | — | Add disabled; Enter is a no-op |
| `/parse` AI unset | `503` | Toast: AI parse isn't set up |
| `/parse` cooldown | `429` | Toast: give it a moment |
| `/parse` model/parse failure | `502` | Toast: couldn't smart-parse — edit manually (deterministic preview stays) |
| Malformed `dueTime` on create | `400` | Toast: invalid time |
| Invalid date/time token (deterministic) | — | Token stays as title text; never throws |

A `/parse` failure never blocks capture — the user can always edit the line and press
Enter to create with the deterministic result.

## Testing

**`lib/quick-add` — pure vitest, exhaustive (TDD):**

- Priority: every alias, case-insensitivity, last-wins on repeats, none → undefined.
- Hashtags: known alias → slug; canonical slug → itself; unknown → stripped, category
  undefined, title cleaned.
- Dates: `today`/`tonight`/`tomorrow`+aliases; each weekday + `next <weekday>`; `in N
  days`/`in N weeks`; `M/D`, `M/D/YYYY`, `YYYY-MM-DD`, `Mon DD`/`DD Mon`. Assert exact
  `YYYY-MM-DD` against an injected `now`.
- Times: `3pm`, `3:30pm`, `9am`, `12pm`/`noon`, `12am`/`midnight`, `15:00`; hour-only vs
  hh:mm.
- Combined + order independence: tokens in any order yield the same parse; title is the
  clean remainder with collapsed whitespace.
- Invalid: `Feb 30`, `13/40`, `25:00` → treated as title text, no throw.
- Empty / tokens-only input → empty title.

**Server — pure vitest for the AI helpers, matching `task-breakdown.test.ts`:**

- `buildQuickAddPrompt` includes the raw text and today's local date and asks for the
  `{title,dueDate,dueTime,priority,category}` shape.
- `parseQuickAddResult` normalizes/clamps: bad category/priority dropped, bad date/time
  dropped, missing title falls back, deterministic fields win on merge; malformed JSON →
  throws the typed error.

Route wiring (`/parse` short-circuit vs LLM branch, 401/503/429/502), `dueTime`
persistence/validation on create+patch, and the client component are covered by typecheck
plus manual end-to-end against a real `GROQ_API_KEY` and database — same verification bar
as the breakdown feature.

## Configuration

No new env vars. The `/parse` endpoint reuses the existing `GROQ_API_KEY` / `GROQ_MODEL`
and is simply off (`503`) when the key is unset — deterministic quick-add still works fully
without any AI configured.

## Out of scope (v1)

- A real free-form **tags** system (tag table, tag chips, tag filtering). `#tag` maps to
  categories only; a proper tags feature is a separate later spec.
- **Reminders / notifications** driven by `dueTime`. v1 stores and displays the time;
  wiring it into the notification scheduler is deferred.
- **Global Cmd/Ctrl-K** capture from anywhere. Quick-add lives on the Quest Log page.
- **Recurring syntax** in quick-add (`every monday`, `daily`). Recurring quests keep their
  existing dedicated flow.
- **Automatic** LLM parsing (on-submit or while-typing). LLM is on-demand only.
- DB-backed / cross-instance rate limiting for `/parse` (in-memory per-user cooldown only).
