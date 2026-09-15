# NL Recurrence Parsing (Quick-add Part C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the natural-language quick-add to recognize recurring phrasing ("every Monday at 9", "monthly on the 1st") and pre-fill the iOS add-quest sheet's Recurring form.

**Architecture:** A deterministic regex extractor in the shared `quick-add` lib recognizes the common recurrence phrasings and emits a structured `recurrence` descriptor on the existing `ParsedQuickAdd` contract; the server's AI fallback covers looser wording and validates any model-produced recurrence; iOS reads the descriptor in `fillFromText` and flips the sheet to its (already-built) Recurring form with the cadence pre-filled. Web is a deliberate fast-follow, not in this plan.

**Tech Stack:** TypeScript (pnpm workspace), Vitest, Swift/SwiftUI.

**Spec:** `docs/superpowers/specs/2026-09-15-nl-recurrence-parse-design.md`

## Global Constraints

- **pnpm only** — `npm`/`yarn` are blocked by a preinstall guard. Run tests via `pnpm --filter <pkg> test` or `cd` into the package + `npx vitest run`.
- **`recurrence` is optional and absent for one-off lines** — existing consumers (web, all current tests) must remain byte-for-byte unaffected.
- **Daily is weekly-all-seven** — the server model has no `daily` frequency. "every day" → `{ frequency: "weekly", daysOfWeek: [0,1,2,3,4,5,6] }`.
- **Weekday numbering: 0=Sun … 6=Sat** everywhere (JS `getDay()`, the API, and iOS all agree).
- **`monthlyMode` values are snake_case**: `"day_of_month"` / `"nth_weekday"`. `frequency` values: `"weekly"` / `"monthly"` / `"yearly"`.
- **Server stays authoritative** — `validateRecurrenceInput` on `POST /recurring-tasks` is unchanged; the parser only pre-fills.
- **iOS has no XCTest target** — verify iOS by build-clean + a manual simulator check, not an automated Swift test. Build: `cd ios && xcodebuild -project FocusQuest.xcodeproj -scheme FocusQuest -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`.
- **iOS decoder** is a plain `JSONDecoder()` (no `convertFromSnakeCase`); keep Swift property names matching the server's camelCase JSON keys exactly.

---

## File Structure

- `lib/quick-add/src/types.ts` — add `Frequency`, `MonthlyMode`, `ParsedRecurrence`; add `recurrence?` to `ParsedQuickAdd`.
- `lib/quick-add/src/index.ts` — export the new types.
- `lib/quick-add/src/parse.ts` — add `extractRecurrence`; wire it into `parseQuickAdd` before `extractDate`.
- `lib/quick-add/src/parse.test.ts` — recurrence cases + ordering traps.
- `artifacts/api-server/src/lib/ai/quick-add-parse.ts` — extend prompt; add `validateRecurrence`; call it in `parseQuickAddResult`.
- `artifacts/api-server/src/lib/ai/quick-add-parse.test.ts` — prompt + validation cases.
- `artifacts/api-server/src/routes/tasks.ts` — extend the parse-route short-circuit.
- `ios/FocusQuest/Models/TaskModels.swift` — add `ParsedRecurrence`; add `recurrence` to `ParsedQuickAdd`; add `RecurringDraft.apply`.
- `ios/FocusQuest/Features/Quests/AddQuestSheet.swift` — branch `fillFromText` on recurrence.

---

## Task 1: Shared contract + deterministic weekly recurrence

**Files:**
- Modify: `lib/quick-add/src/types.ts`
- Modify: `lib/quick-add/src/index.ts`
- Modify: `lib/quick-add/src/parse.ts`
- Test: `lib/quick-add/src/parse.test.ts`

**Interfaces:**
- Produces: `ParsedRecurrence` interface `{ frequency: "weekly"|"monthly"|"yearly"; daysOfWeek?: number[]; monthlyMode?: "day_of_month"|"nth_weekday"; dayOfMonth?: number; weekOfMonth?: number; monthOfYear?: number }`; `ParsedQuickAdd.recurrence?: ParsedRecurrence`; `parseQuickAdd(input, { now })` now sets `recurrence` and suppresses `dueDate` when a recurrence is found.

- [ ] **Step 1: Write the failing tests**

Append to `lib/quick-add/src/parse.test.ts` (the file already defines `const NOW = new Date(2026, 6, 12, 9, 0, 0);` — Sunday 2026-07-12, 09:00 local):

```ts
describe("parseQuickAdd — weekly recurrence", () => {
  it("'every day' → weekly, all seven days, no dueDate", () => {
    const r = parseQuickAdd("stretch every day", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "weekly", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    expect(r.dueDate).toBeUndefined();
    expect(r.title).toBe("stretch");
  });

  it("'every weekday' → Mon–Fri", () => {
    const r = parseQuickAdd("gym every weekday", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "weekly", daysOfWeek: [1, 2, 3, 4, 5] });
    expect(r.title).toBe("gym");
  });

  it("'every mon and wed' → those days, deduped and sorted", () => {
    const r = parseQuickAdd("standup every mon and wed", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "weekly", daysOfWeek: [1, 3] });
    expect(r.title).toBe("standup");
  });

  it("bare 'weekly' anchors to today's weekday (Sunday=0)", () => {
    const r = parseQuickAdd("review weekly", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "weekly", daysOfWeek: [0] });
    expect(r.title).toBe("review");
  });

  it("'every friday' is recurring and does NOT set dueDate", () => {
    const r = parseQuickAdd("call mom every friday", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "weekly", daysOfWeek: [5] });
    expect(r.dueDate).toBeUndefined();
    expect(r.title).toBe("call mom");
  });

  it("control: bare 'friday' is still a one-off dueDate, no recurrence", () => {
    const r = parseQuickAdd("call mom friday", { now: NOW });
    expect(r.recurrence).toBeUndefined();
    expect(r.dueDate).toBe("2026-07-17");
  });

  it("keeps dueTime alongside a recurrence", () => {
    const r = parseQuickAdd("stretch every day at 8am", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "weekly", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    expect(r.dueTime).toBe("08:00");
    expect(r.title).toBe("stretch");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd lib/quick-add && npx vitest run src/parse.test.ts -t "weekly recurrence"`
Expected: FAIL — `r.recurrence` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add the types**

In `lib/quick-add/src/types.ts`, add above `ParsedQuickAdd`:

```ts
export type Frequency = "weekly" | "monthly" | "yearly";
export type MonthlyMode = "day_of_month" | "nth_weekday";

export interface ParsedRecurrence {
  /** weekly/monthly/yearly — the server model has no "daily"; daily is weekly with all 7 days. */
  frequency: Frequency;
  /** 0=Sun..6=Sat. The weekly set, or the single weekday for an nth_weekday monthly rule. */
  daysOfWeek?: number[];
  monthlyMode?: MonthlyMode;
  dayOfMonth?: number; // 1..31
  weekOfMonth?: number; // 1..4
  monthOfYear?: number; // 1..12
}
```

Add the field to `ParsedQuickAdd`:

```ts
  /** Set only when the line describes a repeating quest; absent for one-off lines. */
  recurrence?: ParsedRecurrence;
```

In `lib/quick-add/src/index.ts`, extend the type re-export line:

```ts
export type { Priority, ParsedQuickAdd, Frequency, MonthlyMode, ParsedRecurrence } from "./types";
```

- [ ] **Step 4: Add `extractRecurrence` (weekly family) and wire it in**

In `lib/quick-add/src/parse.ts`, update the type import at the top:

```ts
import type { ParsedQuickAdd, ParsedRecurrence, Priority } from "./types";
```

Add this function just above `export function parseQuickAdd` (it reuses the existing module-level `WEEKDAYS` map):

```ts
function extractRecurrence(text: string, now: Date): Field<ParsedRecurrence> {
  let value: ParsedRecurrence | undefined;
  let rest = text;
  const set = (r: ParsedRecurrence) => { value = r; return " "; };

  // "every day" / "everyday" / "daily" → weekly, all seven
  rest = rest.replace(/\b(every\s*day|everyday|daily)\b/i,
    () => set({ frequency: "weekly", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }));

  // "every weekday" / "weekdays" → Mon–Fri
  if (value === undefined) {
    rest = rest.replace(/\b(every\s+weekday|weekdays)\b/i,
      () => set({ frequency: "weekly", daysOfWeek: [1, 2, 3, 4, 5] }));
  }

  // "every monday", "every mon and wed", "every mon, tue"
  if (value === undefined) {
    const day = "sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat";
    const re = new RegExp(`\\bevery\\s+((?:${day})(?:\\s*(?:,|and|&|\\/)\\s*(?:${day}))*)\\b`, "i");
    rest = rest.replace(re, (whole, group: string) => {
      const days = Array.from(new Set(
        group.split(/\s*(?:,|and|&|\/)\s*/i)
          .map((w) => WEEKDAYS[w.toLowerCase()])
          .filter((n): n is number => n !== undefined),
      )).sort((a, b) => a - b);
      return days.length ? set({ frequency: "weekly", daysOfWeek: days }) : whole;
    });
  }

  // bare "weekly" / "every week" → today's weekday
  if (value === undefined) {
    rest = rest.replace(/\b(weekly|every\s+week)\b/i,
      () => set({ frequency: "weekly", daysOfWeek: [now.getDay()] }));
  }

  return { value, rest };
}
```

Rewrite `parseQuickAdd` so recurrence runs before date extraction and suppresses `dueDate`:

```ts
export function parseQuickAdd(input: string, opts: { now: Date }): ParsedQuickAdd {
  const p = extractPriority(input);
  const h = extractHashtag(p.rest);
  const r = extractRecurrence(h.rest, opts.now);
  // extractDate still runs (on recurrence-stripped text) to strip any stray date
  // token from the title, e.g. "every friday next week" — but its value is
  // discarded when a recurrence was found (a recurring quest has no single dueDate).
  const d = extractDate(r.rest, opts.now);
  const t = extractTime(d.rest);

  const result: ParsedQuickAdd = { title: cleanTitle(t.rest) };
  if (r.value) result.recurrence = r.value;
  else if (d.value) result.dueDate = d.value;
  if (t.value) result.dueTime = t.value;
  if (p.value) result.priority = p.value;
  if (h.value) result.category = h.value;
  return result;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd lib/quick-add && npx vitest run src/parse.test.ts`
Expected: PASS — the new "weekly recurrence" block and all pre-existing tests (priority/hashtag/date/time) stay green.

- [ ] **Step 6: Commit**

```bash
git add lib/quick-add/src/types.ts lib/quick-add/src/index.ts lib/quick-add/src/parse.ts lib/quick-add/src/parse.test.ts
git commit -m "feat(quick-add): parse weekly recurrence into ParsedQuickAdd.recurrence"
```

---

## Task 2: Deterministic monthly + yearly recurrence

**Files:**
- Modify: `lib/quick-add/src/parse.ts` (extend `extractRecurrence`)
- Test: `lib/quick-add/src/parse.test.ts`

**Interfaces:**
- Consumes: `extractRecurrence` / `ParsedRecurrence` from Task 1.
- Produces: `extractRecurrence` additionally recognizes monthly (day-of-month and nth-weekday) and yearly phrasings.

- [ ] **Step 1: Write the failing tests**

Append to `lib/quick-add/src/parse.test.ts`:

```ts
describe("parseQuickAdd — monthly & yearly recurrence", () => {
  it("'monthly on the 1st' → day_of_month 1", () => {
    const r = parseQuickAdd("pay rent monthly on the 1st", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 1 });
    expect(r.title).toBe("pay rent");
  });

  it("bare 'monthly' anchors day_of_month to today's date (12)", () => {
    const r = parseQuickAdd("pay rent monthly", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 12 });
  });

  it("'first monday of the month' → nth_weekday, week 1, Monday", () => {
    const r = parseQuickAdd("report first monday of the month", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 1, daysOfWeek: [1] });
    expect(r.title).toBe("report");
  });

  it("'yearly' anchors month+day to today (2026-07-12 → month 7, day 12)", () => {
    const r = parseQuickAdd("taxes yearly", { now: NOW });
    expect(r.recurrence).toEqual({ frequency: "yearly", monthlyMode: "day_of_month", dayOfMonth: 12, monthOfYear: 7 });
    expect(r.title).toBe("taxes");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd lib/quick-add && npx vitest run src/parse.test.ts -t "monthly & yearly"`
Expected: FAIL — `r.recurrence` is `undefined` for these lines (the monthly/yearly branches don't exist yet).

- [ ] **Step 3: Extend `extractRecurrence`**

In `lib/quick-add/src/parse.ts`, add a module-level ordinal map near the top (beside `WEEKDAYS`):

```ts
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4,
  "1st": 1, "2nd": 2, "3rd": 3, "4th": 4,
};
```

Inside `extractRecurrence`, insert these three blocks **after** the "bare weekly" block and **before** the final `return`:

```ts
  // "first monday of the month" / "3rd friday monthly"
  if (value === undefined) {
    const day = "sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat";
    const re = new RegExp(
      `\\b(first|second|third|fourth|1st|2nd|3rd|4th)\\s+(${day})\\b(?:\\s+(?:of\\s+(?:the\\s+)?month|monthly))?`,
      "i",
    );
    rest = rest.replace(re, (whole, ord: string, name: string) => {
      const w = ORDINAL_WORDS[ord.toLowerCase()];
      const dn = WEEKDAYS[name.toLowerCase()];
      if (!w || dn === undefined) return whole;
      return set({ frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: w, daysOfWeek: [dn] });
    });
  }

  // "monthly on the 15th" / "every month on the 1st" / bare "monthly"
  if (value === undefined) {
    rest = rest.replace(
      /\b(?:monthly|every\s+month)(?:\s+on\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?)?\b/i,
      (whole, dom: string | undefined) => {
        const dayNum = dom ? parseInt(dom, 10) : now.getDate();
        if (dayNum < 1 || dayNum > 31) return whole;
        return set({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: dayNum });
      });
  }

  // "yearly" / "annually" / "every year" → today's month + day
  if (value === undefined) {
    rest = rest.replace(/\b(yearly|annually|every\s+year)\b/i,
      () => set({
        frequency: "yearly", monthlyMode: "day_of_month",
        dayOfMonth: now.getDate(), monthOfYear: now.getMonth() + 1,
      }));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd lib/quick-add && npx vitest run src/parse.test.ts`
Expected: PASS — the "monthly & yearly" block plus every earlier block stay green.

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter ./lib/quick-add typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/quick-add/src/parse.ts lib/quick-add/src/parse.test.ts
git commit -m "feat(quick-add): parse monthly and yearly recurrence phrasings"
```

---

## Task 3: Server AI fallback — prompt, validation, route short-circuit

**Files:**
- Modify: `artifacts/api-server/src/lib/ai/quick-add-parse.ts`
- Test: `artifacts/api-server/src/lib/ai/quick-add-parse.test.ts`
- Modify: `artifacts/api-server/src/routes/tasks.ts:371`

**Interfaces:**
- Consumes: `ParsedRecurrence`, `Frequency`, `MonthlyMode` from `@workspace/quick-add` (Task 1).
- Produces: `parseQuickAddResult` now returns a validated `recurrence` when the model supplies a well-formed one; `buildQuickAddPrompt` asks for it. The `/tasks/parse` route skips the LLM when the deterministic parse already found a recurrence.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/lib/ai/quick-add-parse.test.ts` (it already defines `const NOW = new Date(2026, 6, 12, 9, 0, 0);`):

```ts
describe("parseQuickAddResult — recurrence", () => {
  it("keeps a valid recurrence object", () => {
    const r = parseQuickAddResult(
      { title: "Water plants", recurrence: { frequency: "weekly", daysOfWeek: [1, 4] } },
      { text: "water plants every mon and thu" },
    );
    expect(r.recurrence).toEqual({ frequency: "weekly", daysOfWeek: [1, 4] });
  });

  it("drops recurrence with an unknown frequency", () => {
    const r = parseQuickAddResult(
      { title: "x", recurrence: { frequency: "biweekly", daysOfWeek: [1] } },
      { text: "x every other monday" },
    );
    expect(r.recurrence).toBeUndefined();
  });

  it("drops recurrence with an out-of-range dayOfMonth", () => {
    const r = parseQuickAddResult(
      { title: "x", recurrence: { frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 45 } },
      { text: "x" },
    );
    expect(r.recurrence).toBeUndefined();
  });

  it("drops recurrence with an out-of-range weekday", () => {
    const r = parseQuickAddResult(
      { title: "x", recurrence: { frequency: "weekly", daysOfWeek: [1, 9] } },
      { text: "x" },
    );
    expect(r.recurrence).toBeUndefined();
  });

  it("omits recurrence entirely when the model returns none", () => {
    const r = parseQuickAddResult({ title: "One off", dueDate: "2026-07-20" }, { text: "one off" });
    expect(r.recurrence).toBeUndefined();
  });
});

describe("buildQuickAddPrompt — recurrence", () => {
  it("asks the model for a recurrence field", () => {
    const p = buildQuickAddPrompt("stretch every morning", { now: NOW });
    expect(p).toContain("recurrence");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd artifacts/api-server && npx vitest run src/lib/ai/quick-add-parse.test.ts -t recurrence`
Expected: FAIL — `parseQuickAddResult` ignores `recurrence` (result has none), and the prompt lacks the word.

- [ ] **Step 3: Add validation + extend the prompt**

In `artifacts/api-server/src/lib/ai/quick-add-parse.ts`, extend the type import:

```ts
import type { ParsedQuickAdd, ParsedRecurrence, Frequency, MonthlyMode } from "@workspace/quick-add";
```

Add these validators near the top (below the existing `PRIORITIES` set):

```ts
const FREQUENCIES = new Set<Frequency>(["weekly", "monthly", "yearly"]);
const MONTHLY_MODES = new Set<MonthlyMode>(["day_of_month", "nth_weekday"]);

function inRangeInt(n: unknown, lo: number, hi: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
}

/** Validate a model-produced recurrence; return undefined (distrust the whole
 *  thing) if any field is malformed, matching the per-field posture elsewhere. */
function validateRecurrence(raw: unknown): ParsedRecurrence | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.frequency !== "string" || !FREQUENCIES.has(o.frequency as Frequency)) return undefined;
  const r: ParsedRecurrence = { frequency: o.frequency as Frequency };

  if (o.daysOfWeek !== undefined) {
    if (!Array.isArray(o.daysOfWeek) || !o.daysOfWeek.every((n) => inRangeInt(n, 0, 6))) return undefined;
    if (o.daysOfWeek.length) r.daysOfWeek = Array.from(new Set(o.daysOfWeek as number[])).sort((a, b) => a - b);
  }
  if (o.monthlyMode !== undefined) {
    if (typeof o.monthlyMode !== "string" || !MONTHLY_MODES.has(o.monthlyMode as MonthlyMode)) return undefined;
    r.monthlyMode = o.monthlyMode as MonthlyMode;
  }
  if (o.dayOfMonth !== undefined) {
    if (!inRangeInt(o.dayOfMonth, 1, 31)) return undefined;
    r.dayOfMonth = o.dayOfMonth;
  }
  if (o.weekOfMonth !== undefined) {
    if (!inRangeInt(o.weekOfMonth, 1, 4)) return undefined;
    r.weekOfMonth = o.weekOfMonth;
  }
  if (o.monthOfYear !== undefined) {
    if (!inRangeInt(o.monthOfYear, 1, 12)) return undefined;
    r.monthOfYear = o.monthOfYear;
  }
  return r;
}
```

In `parseQuickAddResult`, before the final `return result;`, add:

```ts
  const recurrence = validateRecurrence(o.recurrence);
  if (recurrence) result.recurrence = recurrence;
```

In `buildQuickAddPrompt`, add a recurrence line to the extract list and to the JSON shape. Change the field list to include:

```
- recurrence: only if the task repeats. An object {frequency, daysOfWeek, monthlyMode, dayOfMonth, weekOfMonth, monthOfYear}. frequency is one of weekly, monthly, yearly (there is no "daily" — a daily task is weekly with daysOfWeek [0,1,2,3,4,5,6]). daysOfWeek uses 0=Sunday..6=Saturday. For a monthly rule use monthlyMode "day_of_month" with dayOfMonth 1-31, or "nth_weekday" with weekOfMonth 1-4 and a single entry in daysOfWeek. For yearly also set monthOfYear 1-12. Omit recurrence entirely for one-off tasks.
```

and change the JSON shape line to:

```
{"title": "...", "dueDate": "...", "dueTime": "...", "priority": "...", "recurrence": {"frequency": "..."}}
```

- [ ] **Step 4: Run the parse-lib tests to verify they pass**

Run: `cd artifacts/api-server && npx vitest run src/lib/ai/quick-add-parse.test.ts`
Expected: PASS — new recurrence cases and existing cases green.

- [ ] **Step 5: Extend the route short-circuit**

In `artifacts/api-server/src/routes/tasks.ts`, find (~line 371):

```ts
  if (deterministic.dueDate || deterministic.dueTime) {
```

Change to:

```ts
  if (deterministic.dueDate || deterministic.dueTime || deterministic.recurrence) {
```

- [ ] **Step 6: Run the api-server test suite + typecheck**

Run: `pnpm --filter ./artifacts/api-server test`
Expected: PASS (full suite green).
Run: `pnpm --filter ./artifacts/api-server typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/ai/quick-add-parse.ts artifacts/api-server/src/lib/ai/quick-add-parse.test.ts artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): AI quick-add parse recognizes and validates recurrence"
```

---

## Task 4: iOS — decode recurrence and pre-fill the Recurring form

**Files:**
- Modify: `ios/FocusQuest/Models/TaskModels.swift`
- Modify: `ios/FocusQuest/Features/Quests/AddQuestSheet.swift`

**Interfaces:**
- Consumes: the server's `recurrence` object on the `/tasks/parse` response (Tasks 1–3).
- Produces: `ParsedRecurrence` Swift struct; `RecurringDraft.apply(_:)`; `fillFromText` flips to Recurring mode when a recurrence is parsed (and recurring is allowed in context).

- [ ] **Step 1: Add the `ParsedRecurrence` model + extend `ParsedQuickAdd`**

In `ios/FocusQuest/Models/TaskModels.swift`, replace the `ParsedQuickAdd` struct with:

```swift
struct ParsedQuickAdd: Codable {
    let title: String
    let dueDate: String?
    let dueTime: String?
    let priority: String?
    let category: String?
    let recurrence: ParsedRecurrence?
}

/// The recurrence descriptor from `/tasks/parse` (camelCase keys, snake_case
/// enum values) — all optional so a one-off response decodes fine. Mirrors the
/// shared `ParsedRecurrence` TS type.
struct ParsedRecurrence: Codable {
    let frequency: Frequency
    let daysOfWeek: [Int]?
    let monthlyMode: MonthlyMode?
    let dayOfMonth: Int?
    let weekOfMonth: Int?
    let monthOfYear: Int?
}
```

(`Frequency` and `MonthlyMode` already exist in this file with matching raw values `"weekly"`/`"monthly"`/`"yearly"` and `"day_of_month"`/`"nth_weekday"`.)

- [ ] **Step 2: Add `RecurringDraft.apply`**

In `ios/FocusQuest/Models/TaskModels.swift`, immediately after the `RecurringDraft` struct's closing brace, add:

```swift
extension RecurringDraft {
    /// Overlay a parsed recurrence descriptor onto the draft's defaults, leaving
    /// any field the parser didn't resolve at its default (e.g. startDate stays
    /// today). `leadDays` follows the frequency's default, matching the sheet's
    /// own frequency-change behavior.
    mutating func apply(_ r: ParsedRecurrence) {
        frequency = r.frequency
        leadDays = r.frequency.defaultLeadDays
        if let days = r.daysOfWeek, !days.isEmpty { daysOfWeek = days }
        if let mode = r.monthlyMode { monthlyMode = mode }
        if let d = r.dayOfMonth { dayOfMonth = d }
        if let w = r.weekOfMonth { weekOfMonth = w }
        if let mo = r.monthOfYear { monthOfYear = mo }
    }
}
```

- [ ] **Step 3: Branch `fillFromText` on recurrence**

In `ios/FocusQuest/Features/Quests/AddQuestSheet.swift`, replace the body of `fillFromText()` after the `let parsed = try await QuestService.parse(nlText)` line (the title/priority/category/date fills) with:

```swift
            title = parsed.title
            if let p = parsed.priority.flatMap(Priority.init(rawValue:)) { priority = p }
            if let c = parsed.category.flatMap(TaskCategory.init(rawValue:)) { category = c }

            if let r = parsed.recurrence, allowsRecurring {
                // Recurrence detected → flip to the Recurring form, pre-filled.
                mode = .recurring
                draft.apply(r)
                if let t = parsed.dueTime { draft.timeOfDay = t }
            } else {
                // One-off fill (or recurring not allowed in a questline context).
                if let d = parsed.dueDate.flatMap({ DateUtils.parse($0) }) {
                    isAnchored = false
                    dueDate = d
                }
                if let t = parsed.dueTime, let parsedTime = Self.hm.date(from: t) {
                    hasDueTime = true
                    dueTime = parsedTime
                }
            }
```

- [ ] **Step 4: Build clean**

Run:
```bash
cd ios && xcodebuild -project FocusQuest.xcodeproj -scheme FocusQuest -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```
Expected: `** BUILD SUCCEEDED **`, no warnings from the changed files.

- [ ] **Step 5: Manual simulator check**

Launch on the simulator, open the add-quest sheet, type `stretch every morning at 8` into the natural-language line, tap **Fill from text**. Expected: the sheet switches to **Recurring**, Frequency = Weekly with all seven weekday chips selected, Time of day = 08:00, title = "stretch". Then type `pay rent monthly on the 1st` in a fresh sheet and Fill: Recurring, Monthly, Day of month = 1.

- [ ] **Step 6: Commit**

```bash
git add ios/FocusQuest/Models/TaskModels.swift ios/FocusQuest/Features/Quests/AddQuestSheet.swift
git commit -m "feat(ios): quick-add fills the Recurring form when recurrence is detected"
```

---

## Task 5: Workspace-wide typecheck

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm run typecheck`
Expected: no errors — confirms the new `recurrence` field breaks no consumer (web reads `ParsedQuickAdd` but never the new optional field, so it must still compile).

- [ ] **Step 2: Run the affected package test suites**

Run: `pnpm --filter ./lib/quick-add test && pnpm --filter ./artifacts/api-server test`
Expected: all green.

- [ ] **Step 3: Commit (only if any lockstep fix was needed)**

If Steps 1–2 required no changes, skip. Otherwise:

```bash
git add -A
git commit -m "chore: workspace typecheck fixes for quick-add recurrence"
```

---

## Self-Review

**Spec coverage:**
- Contract (`recurrence` sub-object) → Task 1. ✓
- Deterministic weekly/daily/weekday → Task 1; monthly/nth-weekday/yearly → Task 2. ✓
- Ordering trap (recurrence before date; "every friday" ≠ dueDate) → Task 1 tests. ✓
- AI prompt + validation + route short-circuit → Task 3. ✓
- iOS decode + `RecurringDraft.apply` + `fillFromText` branch → Task 4. ✓
- Questline edge case (recurring disallowed) → Task 4 Step 3 guard (`allowsRecurring`). ✓
- Non-recurring lines unaffected / workspace still compiles → Task 5. ✓
- YAGNI exclusions (biweekly, multi-rule, NL end dates, web handoff) → not implemented, as specified. ✓

**Placeholder scan:** No TBD/TODO; every code step carries real code. ✓

**Type consistency:** `ParsedRecurrence` fields identical across TS (`types.ts`), server validator, and Swift struct. `frequency` values `weekly|monthly|yearly`; `monthlyMode` values `day_of_month|nth_weekday` used verbatim in all three. `RecurringDraft.apply` and `fillFromText` reference `draft`, `mode`, `allowsRecurring`, `isAnchored`, `hasDueTime`, `dueTime`, `Self.hm`, `DateUtils.parse` — all existing members of `AddQuestSheet`. ✓
