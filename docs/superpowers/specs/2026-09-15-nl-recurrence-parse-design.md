# Natural-language recurrence parsing (Quick-add Part C)

**Date:** 2026-09-15
**Status:** Design approved, pending implementation plan
**Surfaces:** `lib/quick-add` (shared), `artifacts/api-server` (AI parse + route), `ios/FocusQuest`. Web is a deliberate fast-follow, out of scope here.

## Problem

The natural-language quick-add builds only **one-off** quests. A line like
"stretch every morning" or "pay rent monthly on the 1st" parses to a single
dated task, not a recurring template. Parts A/B gave iOS a structured
Standard/Recurring sheet ([AddQuestSheet](../../../ios/FocusQuest/Features/Quests/AddQuestSheet.swift))
whose NL line *fills* the form; this part teaches that parse to recognize
recurrence and fill the **Recurring** side of the form.

## Decisions (settled during brainstorming)

1. **On detect → fill the recurring form.** Detecting recurrence flips the sheet
   into Recurring mode with the cadence pre-filled; the user confirms/adjusts
   before creating. Consistent with the Parts A/B rule that NL fills the form
   rather than acting on its own. Nothing the parser produces is created without
   the user tapping Add.
2. **Common cases, deterministic-first + AI fallback.** Extend the offline regex
   parser to catch frequent phrasings; the existing AI fallback covers looser
   wording. Uncaught phrasing simply doesn't flip to recurring — the user picks
   it in the form. This matches the current two-layer architecture.
3. **Shared lib + server + iOS now; web fast-follows.** The parse capability is
   built once in the shared lib + server and consumed by iOS immediately (it
   already has the Recurring form). Web's single-line bar needs a new
   bar→recurring-form handoff, designed in its own follow-up.
4. **Contract shape: a structured `recurrence` sub-object** on `ParsedQuickAdd`
   (approach A), mirroring the server's recurring model 1:1, absent for one-off
   lines.

## Current architecture (for reference)

- `lib/quick-add/src/parse.ts` — deterministic regex parser. Extracts title,
  dueDate, dueTime, priority, category. Runs offline, unit-tested, fires on
  every keystroke on web. **No recurrence awareness today.**
- Server `POST /tasks/parse` ([tasks.ts:356](../../../artifacts/api-server/src/routes/tasks.ts))
  — runs the deterministic parser; **only if no date/time was found** does it
  fall back to the AI (`buildQuickAddPrompt` → LLM → `parseQuickAddResult` in
  [quick-add-parse.ts](../../../artifacts/api-server/src/lib/ai/quick-add-parse.ts)).
- Both clients consume the shared `ParsedQuickAdd` type.
- Recurring creation is a separate path: `POST /recurring-tasks`, whose payload
  is built by web's `toRecurrencePayload` ([recurrence-form.ts](../../../artifacts/focusquest/src/lib/recurrence-form.ts))
  and mirrored by iOS's `RecurringInput.build` ([TaskModels.swift](../../../ios/FocusQuest/Models/TaskModels.swift)).
  `validateRecurrenceInput` on the server is the authoritative validator.

## Design

### 1. The contract (`lib/quick-add/src/types.ts`)

Add one optional field to `ParsedQuickAdd`:

```ts
export type Frequency = "weekly" | "monthly" | "yearly";
export type MonthlyMode = "day_of_month" | "nth_weekday";

export interface ParsedRecurrence {
  frequency: Frequency;
  daysOfWeek?: number[];   // 0=Sun..6=Sat; weekly set, or the single nth-weekday
  monthlyMode?: MonthlyMode;
  dayOfMonth?: number;     // 1..31
  weekOfMonth?: number;    // 1..4 (nth_weekday)
  monthOfYear?: number;    // 1..12 (yearly)
}

export interface ParsedQuickAdd {
  title: string;
  dueDate?: string;
  dueTime?: string;
  priority?: Priority;
  category?: string;
  recurrence?: ParsedRecurrence;   // NEW — absent for one-off lines
}
```

**Daily is weekly-all-seven.** The server model has no `daily` frequency; a daily
habit is `weekly` with all seven `daysOfWeek`. So "every day" →
`{ frequency: "weekly", daysOfWeek: [0,1,2,3,4,5,6] }` and "every weekday" →
`daysOfWeek: [1,2,3,4,5]`. This keeps the descriptor faithful to what
`/recurring-tasks` accepts — no new server concept.

`recurrence` being **optional and absent** for the one-off case means existing
consumers (web, all current tests) are byte-for-byte unaffected.

### 2. Deterministic parser (`lib/quick-add/src/parse.ts`)

Add `extractRecurrence(text, now): Field<ParsedRecurrence>`, run **first** in
`parseQuickAdd`, before `extractDate`.

**Ordering is load-bearing.** Today "every friday" would trip the weekday branch
of `extractDate` and become a one-off due-this-Friday. `extractRecurrence` must
consume its own tokens first so the date parser never sees them. After a
recurrence is found, `parseQuickAdd` does **not** set `dueDate` from
`extractDate` — a recurring quest has no single due date; it has a `startDate`,
which the form defaults to today.

Supported patterns (the "common cases" set):

| Phrase | `recurrence` |
|---|---|
| `every day`, `daily` | weekly, days [0,1,2,3,4,5,6] |
| `every weekday`, `weekdays` | weekly, days [1,2,3,4,5] |
| `every monday`, `every mon`, `every mon & wed` | weekly, those day(s) |
| `weekly`, `every week` | weekly, day = today's weekday |
| `monthly`, `every month` | monthly, day_of_month = today's date |
| `monthly on the 1st`, `every month on the 15th` | monthly, day_of_month = N |
| `first monday of the month`, `3rd friday monthly` | monthly, nth_weekday, weekOfMonth = N, that weekday |
| `yearly`, `annually`, `every year` | yearly, monthOfYear + dayOfMonth = today (or an explicitly parsed date) |

`dueTime` continues to come from the existing `extractTime` (→ the form's
`timeOfDay`). A recurrence with no explicit day/date anchors to *today's*
weekday/date, matching "starting now."

`extractRecurrence` returns the same `Field<T>` shape as the other extractors so
`parseQuickAdd` composes it uniformly. `parseQuickAdd` sets `result.recurrence`
when present.

### 3. AI fallback (server `quick-add-parse.ts`)

- `buildQuickAddPrompt`: add a `recurrence` field to the requested JSON shape,
  described in the same terms as §1, stating the daily-as-weekly-all-7 rule
  explicitly and the field ranges.
- `parseQuickAddResult`: **validate** any `recurrence` the model returns —
  whitelist `frequency` and `monthlyMode`; range-check `daysOfWeek` (0–6, unique),
  `dayOfMonth` (1–31), `weekOfMonth` (1–4), `monthOfYear` (1–12). If any part is
  malformed, **drop the whole `recurrence`** rather than trust it. Same posture
  as the existing per-field validation, which discards bad `dueDate`/`dueTime`.
- Route short-circuit at [tasks.ts:371](../../../artifacts/api-server/src/routes/tasks.ts):
  skip the AI call when the deterministic parse found a date/time **or a
  recurrence**. So "stretch every morning" resolves offline; only genuinely loose
  phrasing spends an LLM call.

### 4. iOS wiring

- `ParsedQuickAdd` (Swift struct, [TaskModels.swift](../../../ios/FocusQuest/Models/TaskModels.swift))
  gains a matching optional `recurrence: ParsedRecurrence?`, plus a
  `ParsedRecurrence: Decodable` struct with the same fields as §1. All optional so
  decoding an old/one-off response is unaffected.
- `RecurringDraft.apply(_ r: ParsedRecurrence)` — a small, pure mapper: copy each
  set field of the descriptor over the draft's defaults, leaving unset fields at
  their sensible defaults (`leadDays` stays the per-frequency default, `startDate`
  stays today, etc.). Unit-testable in isolation.
- `AddQuestSheet.fillFromText()`:

  ```swift
  if let r = parsed.recurrence {
      mode = .recurring
      draft.apply(r)
      if let t = parsed.dueTime { draft.timeOfDay = t }
  } else {
      // existing standard-fill path (title/priority/category/dueDate/dueTime)
  }
  // title/priority/category fill the same in both branches
  ```

  The sheet is already reactive, so flipping `mode` swaps to the Recurring form
  with the cadence shown — the "fill the form, user confirms" behavior.

### 5. Error handling & edge cases

- **Ambiguity → don't guess.** A line with both a concrete date and a recurrence
  word ("every friday next week") resolves as recurring; the stray date is
  dropped from the title. We don't invent an end date.
- **Malformed AI recurrence** is discarded (§3), so a bad model response degrades
  to a one-off fill, never a broken payload.
- **Server remains authoritative.** `validateRecurrenceInput` on
  `/recurring-tasks` is unchanged and is the final net. The parser only
  *pre-fills*.
- **Non-recurring lines unchanged.** `recurrence` absent → web (not yet reading
  it) and every existing test unaffected.

### 6. Testing

- **`lib/quick-add/src/parse.test.ts`** (TDD, the core): a table of phrases →
  expected `recurrence`, including ordering traps — "every friday" must NOT set
  `dueDate`, while bare "friday" still does; "every day" → weekly-all-7;
  "monthly on the 15th" → day_of_month 15; "first monday of the month" →
  nth_weekday. Most of the feature's confidence lives here.
- **Server `quick-add-parse` test**: `parseQuickAddResult` accepts a valid AI
  `recurrence` and drops each malformed variant (bad frequency, out-of-range
  day, etc.).
- **iOS**: a `RecurringDraft.apply` unit test (descriptor → draft); build-clean;
  one manual sim check of "stretch every morning at 8" flipping to a correct
  Recurring form.
- **`pnpm typecheck`** across the workspace catches any consumer the new field
  breaks.

## Scope guard (YAGNI — explicitly out)

- Biweekly / "every other week" (no server model support).
- Multi-rule lines ("mondays and the 1st").
- Natural-language end dates ("until June").
- The web bar→recurring-form handoff (the fast-follow).

## Build sequence

1. Shared lib: contract (`types.ts`) + `extractRecurrence` + parse tests (TDD).
2. Server: AI prompt + `parseQuickAddResult` validation + route short-circuit +
   tests.
3. iOS: `ParsedRecurrence` decode + `RecurringDraft.apply` + `fillFromText`
   branch + apply test; build + sim check.
4. `pnpm typecheck` + all package tests green.
