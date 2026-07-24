# Monthly & Yearly Recurring Quests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recurring quest template repeat monthly or yearly — anchored to a day of the month or an nth weekday — with per-template lead time and streaks that count occurrences instead of calendar days.

**Architecture:** All calendar math moves into one new pure module, `artifacts/api-server/src/lib/recurrence.ts`, which never touches the DB or the clock. `recurring_tasks` grows six flat typed columns (plus `habit_streaks.last_period_key`), and the spawner is rewritten from "is today one of these weekdays?" to "which occurrences fall in `[today, today + leadDays]` **in this user's timezone**?". The existing `unique(user_id, recurring_task_id, due_date)` index keeps doing all deduplication, so re-evaluating the same window every tick stays a no-op.

**Tech Stack:** TypeScript, Express 5, Drizzle ORM + drizzle-kit (Neon Postgres), Vitest, React + TanStack Query with orval-generated clients, OpenAPI 3 as the contract source of truth.

**Spec:** `docs/superpowers/specs/2026-07-24-monthly-yearly-recurring-quests-design.md`

## Global Constraints

- **pnpm only.** Every command is `pnpm --filter <pkg> run <script>`. `npm`/`yarn` are blocked by the root `preinstall` hook.
- **Never run `drizzle-kit push`.** The script was removed deliberately. Schema changes are `generate` (writes SQL) then `migrate` (applies it).
- **Migration number is `0007`.** `0006_quest_campaigns.sql` is the current head and is already live on Neon.
- **One shared Neon database serves every branch.** Applying `0007` affects other branches' running code. All six `recurring_tasks` columns are additive with defaults and `habit_streaks.last_period_key` is nullable, so old code keeps working — but do not apply until Task 5.
- **`.env` gotcha:** the db scripts need `DATABASE_URL` exported into the environment; `set -a && . ./.env && set +a` before `migrate`.
- **Files are LF.** `.gitattributes` pins this repo-wide (commit `faffd5e`); do not let an editor rewrite line endings.
- **Editing `lib/api-spec/openapi.yaml` requires regenerating clients:** `pnpm --filter @workspace/api-spec run codegen`. Never hand-edit anything under `src/generated/`.
- **Weekly behavior must not change.** Existing templates carry `frequency = 'weekly'`, `lead_days = 0`, and the new columns NULL; every task below preserves that path bit-for-bit.
- **Anti-shame copy law.** Validation messages and UI text explain what is missing; they never scold, and they never imply the user failed.
- `week_of_month` is `1 | 2 | 3 | 4 | -1`, where `-1` means "last". There is no 5.

---

### Task 1: Recurrence engine — types, weekly, and day-of-month monthly

**Files:**
- Create: `artifacts/api-server/src/lib/recurrence.ts`
- Test: `artifacts/api-server/src/lib/recurrence.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Frequency = "weekly" | "monthly" | "yearly"`, `type MonthlyMode = "day_of_month" | "nth_weekday"`, `interface RecurrenceRule`, `function occursOn(rule: RecurrenceRule, dateKey: string): boolean`, `function addDays(dateKey: string, days: number): string`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/recurrence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { occursOn, addDays, type RecurrenceRule } from "./recurrence";

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    frequency: "weekly",
    daysOfWeek: [1, 2, 3, 4, 5],
    monthlyMode: null,
    dayOfMonth: null,
    weekOfMonth: null,
    monthOfYear: null,
    startDate: "2020-01-01",
    endDate: null,
    ...overrides,
  };
}

describe("addDays", () => {
  it("steps forward across a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("steps backward with a negative count", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("occursOn — weekly", () => {
  it("matches a listed weekday", () => {
    // 2026-07-24 is a Friday (day 5).
    expect(occursOn(rule(), "2026-07-24")).toBe(true);
  });

  it("rejects an unlisted weekday", () => {
    // 2026-07-25 is a Saturday (day 6), not in [1..5].
    expect(occursOn(rule(), "2026-07-25")).toBe(false);
  });
});

describe("occursOn — monthly day_of_month", () => {
  const monthly = rule({
    frequency: "monthly",
    monthlyMode: "day_of_month",
    dayOfMonth: 15,
    daysOfWeek: [],
  });

  it("matches the chosen day in any month", () => {
    expect(occursOn(monthly, "2026-07-15")).toBe(true);
    expect(occursOn(monthly, "2026-08-15")).toBe(true);
  });

  it("rejects every other day", () => {
    expect(occursOn(monthly, "2026-07-14")).toBe(false);
    expect(occursOn(monthly, "2026-07-16")).toBe(false);
  });

  it("clamps the 31st to the last day of a short month", () => {
    const d31 = rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 31, daysOfWeek: [] });
    // 2026 is not a leap year: February clamps to the 28th.
    expect(occursOn(d31, "2026-02-28")).toBe(true);
    expect(occursOn(d31, "2026-02-27")).toBe(false);
    // April has 30 days.
    expect(occursOn(d31, "2026-04-30")).toBe(true);
    // A month that actually has a 31st is unaffected.
    expect(occursOn(d31, "2026-07-31")).toBe(true);
    expect(occursOn(d31, "2026-07-30")).toBe(false);
  });

  it("clamps the 30th to Feb 29 in a leap year", () => {
    const d30 = rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 30, daysOfWeek: [] });
    expect(occursOn(d30, "2028-02-29")).toBe(true);
    expect(occursOn(d30, "2028-02-28")).toBe(false);
  });
});

describe("occursOn — start and end gating", () => {
  it("rejects dates before startDate", () => {
    expect(occursOn(rule({ startDate: "2026-08-01" }), "2026-07-24")).toBe(false);
  });

  it("rejects dates after endDate", () => {
    expect(occursOn(rule({ endDate: "2026-07-01" }), "2026-07-24")).toBe(false);
  });

  it("includes both boundary dates", () => {
    // 2026-07-24 Friday, 2026-07-20 Monday — both are listed weekdays.
    expect(occursOn(rule({ startDate: "2026-07-24" }), "2026-07-24")).toBe(true);
    expect(occursOn(rule({ endDate: "2026-07-20" }), "2026-07-20")).toBe(true);
  });
});

describe("occursOn — malformed rules never throw", () => {
  it("returns false when a monthly rule has no mode", () => {
    expect(occursOn(rule({ frequency: "monthly", monthlyMode: null }), "2026-07-15")).toBe(false);
  });

  it("returns false when day_of_month has no day", () => {
    const bad = rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: null });
    expect(occursOn(bad, "2026-07-15")).toBe(false);
  });

  it("returns false for an out-of-range day", () => {
    const bad = rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 0 });
    expect(occursOn(bad, "2026-07-01")).toBe(false);
  });

  it("returns false for a weekly rule with no days", () => {
    expect(occursOn(rule({ daysOfWeek: [] }), "2026-07-24")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence.test.ts
```

Expected: FAIL — `Failed to resolve import "./recurrence"`.

- [ ] **Step 3: Write the minimal implementation**

Create `artifacts/api-server/src/lib/recurrence.ts`:

```ts
/**
 * Pure recurrence math for recurring-quest templates.
 *
 * No DB, no clock, no I/O — a rule plus a `YYYY-MM-DD` date key in, an answer
 * out. Every calendar edge case (short months, leap years, "last Saturday")
 * lives here so the spawner has exactly one predicate to consult.
 *
 * All date arithmetic runs on UTC anchors of the date key, the same trick
 * `buildDayDates` uses in date-buckets.ts: the keys are already local calendar
 * dates for their owner, so a DST transition must not be able to shift one.
 *
 * Malformed rules (nulls where the mode requires values) yield "no occurrence"
 * rather than throwing. One bad template must never break a shared tick for
 * every other user.
 */

export type Frequency = "weekly" | "monthly" | "yearly";
export type MonthlyMode = "day_of_month" | "nth_weekday";

export interface RecurrenceRule {
  frequency: Frequency;
  /** Weekly: the set of weekdays. nth_weekday: the single weekday of the rule. */
  daysOfWeek: number[];
  monthlyMode: MonthlyMode | null;
  dayOfMonth: number | null;
  /** 1–4, or -1 meaning "last". Never 5 — most months don't have a 5th. */
  weekOfMonth: number | null;
  monthOfYear: number | null;
  startDate: string;
  endDate: string | null;
}

const DAY_MS = 86_400_000;

function toUtc(dateKey: string): Date {
  return new Date(dateKey + "T00:00:00Z");
}

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Shift a `YYYY-MM-DD` key by whole days. */
export function addDays(dateKey: string, days: number): string {
  return toKey(new Date(toUtc(dateKey).getTime() + days * DAY_MS));
}

/** Number of days in `month` (1-based) of `year`. Day 0 of the next month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function inRange(rule: RecurrenceRule, dateKey: string): boolean {
  if (dateKey < rule.startDate) return false;
  if (rule.endDate && dateKey > rule.endDate) return false;
  return true;
}

/** The day of the month this rule targets in the given month, or null. */
function targetDay(rule: RecurrenceRule, year: number, month: number): number | null {
  const dim = daysInMonth(year, month);

  if (rule.monthlyMode === "day_of_month") {
    const wanted = rule.dayOfMonth;
    if (wanted == null || wanted < 1 || wanted > 31) return null;
    // Clamp rather than skip: a quest that silently vanishes in February
    // reads as the user's fault (spec D5).
    return Math.min(wanted, dim);
  }

  return null;
}

export function occursOn(rule: RecurrenceRule, dateKey: string): boolean {
  if (!inRange(rule, dateKey)) return false;

  const d = toUtc(dateKey);
  if (Number.isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  if (rule.frequency === "weekly") {
    if (rule.daysOfWeek.length === 0) return false;
    return rule.daysOfWeek.includes(d.getUTCDay());
  }

  if (rule.monthlyMode == null) return false;

  const target = targetDay(rule, year, month);
  if (target == null) return false;
  return day === target;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence.test.ts
```

Expected: PASS — all tests green. (`yearly` and `nth_weekday` are not exercised yet; Task 2 adds them.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/recurrence.ts artifacts/api-server/src/lib/recurrence.test.ts
git commit -m "feat(recurrence): pure engine with weekly and day-of-month rules"
```

---

### Task 2: Recurrence engine — nth-weekday and yearly

**Files:**
- Modify: `artifacts/api-server/src/lib/recurrence.ts`
- Test: `artifacts/api-server/src/lib/recurrence.test.ts`

**Interfaces:**
- Consumes: `occursOn`, `RecurrenceRule` from Task 1.
- Produces: no new exports — `occursOn` gains `nth_weekday` and `yearly` support.

- [ ] **Step 1: Write the failing test**

Append to `artifacts/api-server/src/lib/recurrence.test.ts`:

```ts
describe("occursOn — monthly nth_weekday", () => {
  // daysOfWeek carries the single weekday for this mode.
  const firstMonday = rule({
    frequency: "monthly",
    monthlyMode: "nth_weekday",
    weekOfMonth: 1,
    daysOfWeek: [1],
  });

  it("matches the first Monday", () => {
    // July 2026 starts on a Wednesday; the first Monday is the 6th.
    expect(occursOn(firstMonday, "2026-07-06")).toBe(true);
    expect(occursOn(firstMonday, "2026-07-13")).toBe(false);
  });

  it("matches when the month starts on the target weekday", () => {
    // June 2026 starts on a Monday, so the first Monday is the 1st.
    expect(occursOn(firstMonday, "2026-06-01")).toBe(true);
  });

  it("matches the third Friday", () => {
    const thirdFriday = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 3, daysOfWeek: [5],
    });
    // July 2026 Fridays: 3, 10, 17, 24, 31 — the third is the 17th.
    expect(occursOn(thirdFriday, "2026-07-17")).toBe(true);
    expect(occursOn(thirdFriday, "2026-07-24")).toBe(false);
  });

  it("resolves 'last' in a month with five of that weekday", () => {
    const lastFriday = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, daysOfWeek: [5],
    });
    // July 2026 has five Fridays; the last is the 31st.
    expect(occursOn(lastFriday, "2026-07-31")).toBe(true);
    expect(occursOn(lastFriday, "2026-07-24")).toBe(false);
  });

  it("resolves 'last' in a month with four of that weekday", () => {
    const lastSaturday = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, daysOfWeek: [6],
    });
    // February 2026 Saturdays: 7, 14, 21, 28 — the last is the 28th.
    expect(occursOn(lastSaturday, "2026-02-28")).toBe(true);
    expect(occursOn(lastSaturday, "2026-02-21")).toBe(false);
  });

  it("returns false when nth_weekday has no weekday", () => {
    const bad = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 1, daysOfWeek: [],
    });
    expect(occursOn(bad, "2026-07-06")).toBe(false);
  });

  it("returns false for an unsupported week ordinal", () => {
    const bad = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 5, daysOfWeek: [1],
    });
    expect(occursOn(bad, "2026-07-27")).toBe(false);
  });
});

describe("occursOn — yearly", () => {
  it("matches month plus day, and only that month", () => {
    const march3 = rule({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: 3, dayOfMonth: 3, daysOfWeek: [],
    });
    expect(occursOn(march3, "2026-03-03")).toBe(true);
    expect(occursOn(march3, "2027-03-03")).toBe(true);
    expect(occursOn(march3, "2026-04-03")).toBe(false);
    expect(occursOn(march3, "2026-03-04")).toBe(false);
  });

  it("clamps Feb 29 to Feb 28 in a common year", () => {
    const leapDay = rule({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: 2, dayOfMonth: 29, daysOfWeek: [],
    });
    expect(occursOn(leapDay, "2026-02-28")).toBe(true);
    expect(occursOn(leapDay, "2028-02-29")).toBe(true);
    // In a leap year it must NOT also fire on the 28th.
    expect(occursOn(leapDay, "2028-02-28")).toBe(false);
  });

  it("supports nth_weekday scoped to a month", () => {
    const firstMondayOfMarch = rule({
      frequency: "yearly", monthlyMode: "nth_weekday", monthOfYear: 3, weekOfMonth: 1, daysOfWeek: [1],
    });
    // March 2026 starts on a Sunday; the first Monday is the 2nd.
    expect(occursOn(firstMondayOfMarch, "2026-03-02")).toBe(true);
    expect(occursOn(firstMondayOfMarch, "2026-03-09")).toBe(false);
    expect(occursOn(firstMondayOfMarch, "2026-04-06")).toBe(false);
  });

  it("returns false when yearly has no month", () => {
    const bad = rule({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: null, dayOfMonth: 3, daysOfWeek: [],
    });
    expect(occursOn(bad, "2026-03-03")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence.test.ts
```

Expected: FAIL — the nth-weekday and yearly assertions fail (`occursOn` returns `false` because `targetDay` handles only `day_of_month`, and nothing checks `monthOfYear`).

- [ ] **Step 3: Write the implementation**

In `artifacts/api-server/src/lib/recurrence.ts`, replace the whole `targetDay` function with:

```ts
/** The day of the month this rule targets in the given month, or null. */
function targetDay(rule: RecurrenceRule, year: number, month: number): number | null {
  const dim = daysInMonth(year, month);

  if (rule.monthlyMode === "day_of_month") {
    const wanted = rule.dayOfMonth;
    if (wanted == null || wanted < 1 || wanted > 31) return null;
    // Clamp rather than skip: a quest that silently vanishes in February
    // reads as the user's fault (spec D5).
    return Math.min(wanted, dim);
  }

  if (rule.monthlyMode === "nth_weekday") {
    const weekday = rule.daysOfWeek[0];
    const n = rule.weekOfMonth;
    if (weekday == null || weekday < 0 || weekday > 6) return null;
    if (n == null || (n !== -1 && (n < 1 || n > 4))) return null;

    if (n === -1) {
      const lastDow = new Date(Date.UTC(year, month - 1, dim)).getUTCDay();
      return dim - ((lastDow - weekday + 7) % 7);
    }

    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
    // The 4th of any weekday always fits (max 1+6+21 = 28 ≤ 28), but guard
    // anyway so a bad stored ordinal can only mean "no occurrence".
    return day <= dim ? day : null;
  }

  return null;
}
```

Then, in `occursOn`, insert the yearly month check immediately after the `if (rule.monthlyMode == null) return false;` line:

```ts
  if (rule.monthlyMode == null) return false;

  if (rule.frequency === "yearly") {
    if (rule.monthOfYear == null || rule.monthOfYear < 1 || rule.monthOfYear > 12) return false;
    if (month !== rule.monthOfYear) return false;
  }

  const target = targetDay(rule, year, month);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence.test.ts
```

Expected: PASS — every describe block green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/recurrence.ts artifacts/api-server/src/lib/recurrence.test.ts
git commit -m "feat(recurrence): nth-weekday and yearly rules"
```

---

### Task 3: Occurrence windows and cadence period keys

**Files:**
- Modify: `artifacts/api-server/src/lib/recurrence.ts`
- Test: `artifacts/api-server/src/lib/recurrence.test.ts`

**Interfaces:**
- Consumes: `occursOn`, `addDays`, `RecurrenceRule`, `Frequency` from Tasks 1–2.
- Produces: `function occurrencesInWindow(rule: RecurrenceRule, from: string, to: string): string[]`, `function cadencePeriodKey(frequency: Frequency, dateKey: string): string`, `function previousPeriodKey(frequency: Frequency, periodKey: string): string`.

`cadencePeriodKey` and `previousPeriodKey` live here rather than in `habit-streaks.ts` so that all cadence math sits in one tested pure module. Task 7 consumes them.

- [ ] **Step 1: Write the failing test**

Append to `artifacts/api-server/src/lib/recurrence.test.ts` (extend the existing import line at the top of the file to include the three new names):

```ts
import {
  occursOn, addDays, occurrencesInWindow, cadencePeriodKey, previousPeriodKey,
  type RecurrenceRule,
} from "./recurrence";
```

```ts
describe("occurrencesInWindow", () => {
  it("returns a single date for a zero-width window that matches", () => {
    const monthly = rule({
      frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 15, daysOfWeek: [],
    });
    expect(occurrencesInWindow(monthly, "2026-07-15", "2026-07-15")).toEqual(["2026-07-15"]);
  });

  it("returns an empty array for a zero-width window that misses", () => {
    const monthly = rule({
      frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 15, daysOfWeek: [],
    });
    expect(occurrencesInWindow(monthly, "2026-07-14", "2026-07-14")).toEqual([]);
  });

  it("includes an occurrence sitting exactly on each boundary", () => {
    const weekly = rule({ daysOfWeek: [1, 5] }); // Mondays and Fridays
    // 2026-07-20 Mon … 2026-07-24 Fri
    expect(occurrencesInWindow(weekly, "2026-07-20", "2026-07-24")).toEqual([
      "2026-07-20", "2026-07-24",
    ]);
  });

  it("returns dates oldest first", () => {
    const daily = rule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    expect(occurrencesInWindow(daily, "2026-07-22", "2026-07-24")).toEqual([
      "2026-07-22", "2026-07-23", "2026-07-24",
    ]);
  });

  it("returns nothing when `to` precedes `from`", () => {
    const daily = rule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    expect(occurrencesInWindow(daily, "2026-07-24", "2026-07-22")).toEqual([]);
  });

  it("respects endDate landing inside the window", () => {
    const daily = rule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], endDate: "2026-07-23" });
    expect(occurrencesInWindow(daily, "2026-07-22", "2026-07-25")).toEqual([
      "2026-07-22", "2026-07-23",
    ]);
  });

  it("caps a runaway window instead of looping forever", () => {
    const daily = rule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    const dates = occurrencesInWindow(daily, "2026-01-01", "2099-01-01");
    expect(dates.length).toBeLessThanOrEqual(400);
  });
});

describe("cadencePeriodKey", () => {
  it("uses the date itself for weekly", () => {
    expect(cadencePeriodKey("weekly", "2026-07-24")).toBe("2026-07-24");
  });

  it("uses year-month for monthly", () => {
    expect(cadencePeriodKey("monthly", "2026-07-24")).toBe("2026-07");
  });

  it("uses the year for yearly", () => {
    expect(cadencePeriodKey("yearly", "2026-07-24")).toBe("2026");
  });
});

describe("previousPeriodKey", () => {
  it("steps back one month", () => {
    expect(previousPeriodKey("monthly", "2026-07")).toBe("2026-06");
  });

  it("steps back across a year boundary", () => {
    expect(previousPeriodKey("monthly", "2026-01")).toBe("2025-12");
  });

  it("steps back one year", () => {
    expect(previousPeriodKey("yearly", "2026")).toBe("2025");
  });

  it("steps back one day for weekly", () => {
    expect(previousPeriodKey("weekly", "2026-03-01")).toBe("2026-02-28");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence.test.ts
```

Expected: FAIL — `occurrencesInWindow is not a function` (and the same for the two period-key helpers).

- [ ] **Step 3: Write the implementation**

Append to `artifacts/api-server/src/lib/recurrence.ts`:

```ts
/**
 * Hard ceiling on window iteration. `lead_days` is validated to 0–60 at the
 * API boundary, so a legitimate window is at most 61 days; this only bounds
 * the damage from a corrupt row.
 */
const MAX_WINDOW_DAYS = 400;

/** Every occurrence in `[from, to]` inclusive, oldest first. */
export function occurrencesInWindow(rule: RecurrenceRule, from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  for (let i = 0; i < MAX_WINDOW_DAYS && cursor <= to; i++) {
    if (occursOn(rule, cursor)) dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/**
 * The cadence period a date belongs to. Streaks count consecutive periods, so
 * "completed the monthly quest" means "landed in this month", not "landed on
 * this day" — which is what lets a couple of days late still count.
 */
export function cadencePeriodKey(frequency: Frequency, dateKey: string): string {
  if (frequency === "monthly") return dateKey.slice(0, 7);
  if (frequency === "yearly") return dateKey.slice(0, 4);
  return dateKey;
}

/** The period immediately preceding `periodKey` at the same cadence. */
export function previousPeriodKey(frequency: Frequency, periodKey: string): string {
  if (frequency === "monthly") {
    const year = Number(periodKey.slice(0, 4));
    const month = Number(periodKey.slice(5, 7));
    const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    return `${prev.y}-${String(prev.m).padStart(2, "0")}`;
  }
  if (frequency === "yearly") return String(Number(periodKey) - 1);
  return addDays(periodKey, -1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/recurrence.ts artifacts/api-server/src/lib/recurrence.test.ts
git commit -m "feat(recurrence): occurrence windows and cadence period keys"
```

---

### Task 4: Human-readable schedule labels

**Files:**
- Modify: `artifacts/api-server/src/lib/recurrence.ts`
- Test: `artifacts/api-server/src/lib/recurrence.test.ts`

**Interfaces:**
- Consumes: `RecurrenceRule` from Task 1.
- Produces: `function describeRule(rule: RecurrenceRule): string`.

This is the single source of the phrasing. Task 9 serves it as `scheduleLabel`; Task 11 renders it. The client never re-derives it, so the two can't drift.

- [ ] **Step 1: Write the failing test**

Add `describeRule` to the import line, then append:

```ts
describe("describeRule", () => {
  it("names the weekly presets", () => {
    expect(describeRule(rule({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }))).toBe("Every day");
    expect(describeRule(rule({ daysOfWeek: [1, 2, 3, 4, 5] }))).toBe("Weekdays");
    expect(describeRule(rule({ daysOfWeek: [0, 6] }))).toBe("Weekends");
  });

  it("lists arbitrary weekdays in order", () => {
    expect(describeRule(rule({ daysOfWeek: [3, 1, 5] }))).toBe("Mon, Wed, Fri");
  });

  it("describes a day-of-month monthly rule", () => {
    const r = rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 1, daysOfWeek: [] });
    expect(describeRule(r)).toBe("The 1st of every month");
  });

  it("uses correct ordinal suffixes", () => {
    const at = (day: number) =>
      describeRule(rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: day, daysOfWeek: [] }));
    expect(at(2)).toBe("The 2nd of every month");
    expect(at(3)).toBe("The 3rd of every month");
    expect(at(11)).toBe("The 11th of every month");
    expect(at(21)).toBe("The 21st of every month");
    expect(at(31)).toBe("The 31st of every month");
  });

  it("describes an nth-weekday monthly rule", () => {
    const r = rule({ frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 3, daysOfWeek: [5] });
    expect(describeRule(r)).toBe("The 3rd Friday of every month");
  });

  it("describes a last-weekday monthly rule", () => {
    const r = rule({ frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, daysOfWeek: [6] });
    expect(describeRule(r)).toBe("The last Saturday of every month");
  });

  it("describes yearly rules", () => {
    const byDay = rule({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: 3, dayOfMonth: 3, daysOfWeek: [],
    });
    expect(describeRule(byDay)).toBe("Every March 3");

    const byWeekday = rule({
      frequency: "yearly", monthlyMode: "nth_weekday", monthOfYear: 3, weekOfMonth: 1, daysOfWeek: [1],
    });
    expect(describeRule(byWeekday)).toBe("The 1st Monday of every March");
  });

  it("falls back to a neutral phrase for an incomplete rule", () => {
    expect(describeRule(rule({ frequency: "monthly", monthlyMode: null }))).toBe("No schedule set");
    expect(describeRule(rule({ daysOfWeek: [] }))).toBe("No schedule set");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence.test.ts
```

Expected: FAIL — `describeRule is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `artifacts/api-server/src/lib/recurrence.ts`:

```ts
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function describeWeekly(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const key = sorted.join(",");
  if (key === "0,1,2,3,4,5,6") return "Every day";
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(", ");
}

/**
 * The one place the schedule is put into words. Served to the client as
 * `scheduleLabel` so server and client can never phrase the same rule
 * differently.
 */
export function describeRule(rule: RecurrenceRule): string {
  const NONE = "No schedule set";

  if (rule.frequency === "weekly") {
    return rule.daysOfWeek.length === 0 ? NONE : describeWeekly(rule.daysOfWeek);
  }

  const yearly = rule.frequency === "yearly";
  if (yearly && (rule.monthOfYear == null || rule.monthOfYear < 1 || rule.monthOfYear > 12)) return NONE;
  const monthName = yearly ? MONTH_LONG[rule.monthOfYear! - 1] : null;

  if (rule.monthlyMode === "day_of_month") {
    const day = rule.dayOfMonth;
    if (day == null || day < 1 || day > 31) return NONE;
    return yearly ? `Every ${monthName} ${day}` : `The ${ordinal(day)} of every month`;
  }

  if (rule.monthlyMode === "nth_weekday") {
    const weekday = rule.daysOfWeek[0];
    const n = rule.weekOfMonth;
    if (weekday == null || weekday < 0 || weekday > 6) return NONE;
    if (n == null || (n !== -1 && (n < 1 || n > 4))) return NONE;
    const which = n === -1 ? "last" : ordinal(n);
    const dayName = WEEKDAY_LONG[weekday];
    return yearly
      ? `The ${which} ${dayName} of every ${monthName}`
      : `The ${which} ${dayName} of every month`;
  }

  return NONE;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/recurrence.ts artifacts/api-server/src/lib/recurrence.test.ts
git commit -m "feat(recurrence): server-owned schedule labels"
```

---

### Task 5: Schema columns and migration 0007

**Files:**
- Modify: `lib/db/src/schema/recurring-tasks.ts`
- Modify: `lib/db/src/schema/habit-streaks.ts`
- Create: `lib/db/drizzle/0007_monthly_yearly_recurrence.sql` (generated, then renamed)

**Interfaces:**
- Consumes: nothing.
- Produces: `recurringTasksTable` columns `frequency`, `monthlyMode`, `dayOfMonth`, `weekOfMonth`, `monthOfYear`, `leadDays`; `habitStreaksTable.lastPeriodKey`.

There is no unit test here — the deliverable is verified by a successful `generate` producing the expected SQL, then a successful `migrate` against Neon.

- [ ] **Step 1: Add the recurring-tasks columns**

Replace the table definition in `lib/db/src/schema/recurring-tasks.ts`:

```ts
export const recurringTasksTable = pgTable("recurring_tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  category: text("category").notNull().default("default"),
  // Weekly: the set of weekdays. nth_weekday mode: the single weekday of the
  // rule — reusing this NOT NULL column instead of adding a redundant one.
  daysOfWeek: text("days_of_week").notNull().default("1,2,3,4,5"),
  timeOfDay: text("time_of_day").notNull().default("08:00"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  // 'weekly' | 'monthly' | 'yearly'. Existing rows default to weekly, which
  // with the columns below NULL reproduces the pre-cadence behavior exactly.
  frequency: text("frequency").notNull().default("weekly"),
  // 'day_of_month' | 'nth_weekday'. Required when frequency is not weekly.
  monthlyMode: text("monthly_mode"),
  dayOfMonth: integer("day_of_month"),
  // 1–4, or -1 meaning "last". Never 5 — most months don't have a 5th.
  weekOfMonth: integer("week_of_month"),
  monthOfYear: integer("month_of_year"),
  // How many days before the occurrence the quest appears in the Quest Log.
  // The spawned quest still carries the true occurrence date as its due date.
  leadDays: integer("lead_days").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Add the habit-streaks column**

In `lib/db/src/schema/habit-streaks.ts`, add one column after `lastCompletedDate`:

```ts
  lastCompletedDate: text("last_completed_date"),
  // The cadence period the last completion belonged to ('2026-07' monthly,
  // '2026' yearly). NULL for weekly templates, which keep comparing calendar
  // days via lastCompletedDate.
  lastPeriodKey: text("last_period_key"),
```

- [ ] **Step 3: Generate the migration**

```bash
pnpm --filter @workspace/db run generate
```

Expected: drizzle-kit writes a new `lib/db/drizzle/0007_*.sql` containing seven `ALTER TABLE ... ADD COLUMN` statements and updates `lib/db/drizzle/meta/`. Rename the SQL file to `0007_monthly_yearly_recurrence.sql` if drizzle picked a random name, and update the matching `tag` in `lib/db/drizzle/meta/_journal.json`.

- [ ] **Step 4: Verify the generated SQL**

```bash
cat lib/db/drizzle/0007_monthly_yearly_recurrence.sql
```

Expected — seven additive statements, no drops, no `NOT NULL` without a default:

```sql
ALTER TABLE "recurring_tasks" ADD COLUMN "frequency" text DEFAULT 'weekly' NOT NULL;
ALTER TABLE "recurring_tasks" ADD COLUMN "monthly_mode" text;
ALTER TABLE "recurring_tasks" ADD COLUMN "day_of_month" integer;
ALTER TABLE "recurring_tasks" ADD COLUMN "week_of_month" integer;
ALTER TABLE "recurring_tasks" ADD COLUMN "month_of_year" integer;
ALTER TABLE "recurring_tasks" ADD COLUMN "lead_days" integer DEFAULT 0 NOT NULL;
ALTER TABLE "habit_streaks" ADD COLUMN "last_period_key" text;
```

If any statement drops or rewrites a column, stop — the schema edit was wrong.

- [ ] **Step 5: Apply the migration to Neon**

```bash
set -a && . ./.env && set +a && pnpm --filter @workspace/db run migrate
```

Expected: migration `0007` applied, no errors. This is safe for other branches: every column is additive with a default or nullable, so code that doesn't know about them is unaffected.

- [ ] **Step 6: Typecheck**

```bash
pnpm run typecheck:libs
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/recurring-tasks.ts lib/db/src/schema/habit-streaks.ts lib/db/drizzle/
git commit -m "feat(db): cadence columns on recurring_tasks, period key on habit_streaks"
```

---

### Task 6: Window-based, timezone-aware spawner

**Files:**
- Modify: `artifacts/api-server/src/routes/recurring-tasks.ts:223-259` (`spawnRecurringTasksForToday`)
- Create: `artifacts/api-server/src/lib/spawn-window.ts`
- Test: `artifacts/api-server/src/lib/spawn-window.test.ts`

**Interfaces:**
- Consumes: `occurrencesInWindow`, `addDays`, `RecurrenceRule` (Tasks 1–3); `resolveTimeZone`, `localDateKey` from `./date-buckets`.
- Produces: `function spawnWindow(now: Date, timezone: string | null, leadDays: number): { from: string; to: string }`, `function ruleFromTemplate(t: RecurringTaskRow): RecurrenceRule`.

The DB-touching spawner loop stays in the route file, but the two decisions worth testing — what window a user gets, and how a DB row becomes a rule — are extracted into a pure module so they can be tested without a database.

**On spawner idempotence:** this repo has no database test harness — every existing suite under `src/lib/*.test.ts` is a pure unit test. Duplicate prevention is therefore enforced structurally, by the pre-existing `unique(user_id, recurring_task_id, due_date)` index plus `onConflictDoNothing`, not by an automated test. It is checked by hand in the verification checklist at the end of this plan. Do not add a DB-backed test harness as part of this work.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/spawn-window.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spawnWindow, ruleFromTemplate } from "./spawn-window";

describe("spawnWindow", () => {
  it("is a single day when leadDays is 0", () => {
    const w = spawnWindow(new Date("2026-07-24T12:00:00Z"), "UTC", 0);
    expect(w).toEqual({ from: "2026-07-24", to: "2026-07-24" });
  });

  it("extends forward by leadDays", () => {
    const w = spawnWindow(new Date("2026-07-24T12:00:00Z"), "UTC", 3);
    expect(w).toEqual({ from: "2026-07-24", to: "2026-07-27" });
  });

  it("uses the user's local calendar day, not UTC", () => {
    // 01:00 UTC Jul 12 is still Jul 11 (21:00) in New York.
    const instant = new Date("2026-07-12T01:00:00Z");
    expect(spawnWindow(instant, "America/New_York", 0).from).toBe("2026-07-11");
    expect(spawnWindow(instant, "UTC", 0).from).toBe("2026-07-12");
  });

  it("rolls forward for timezones ahead of UTC", () => {
    // 23:00 UTC Jul 11 is already Jul 12 in Tokyo.
    const instant = new Date("2026-07-11T23:00:00Z");
    expect(spawnWindow(instant, "Asia/Tokyo", 0).from).toBe("2026-07-12");
  });

  it("falls back to UTC for a null or invalid timezone", () => {
    const instant = new Date("2026-07-12T01:00:00Z");
    expect(spawnWindow(instant, null, 0).from).toBe("2026-07-12");
    expect(spawnWindow(instant, "Not/AZone", 0).from).toBe("2026-07-12");
  });

  it("treats a negative or absurd leadDays as zero-width", () => {
    const instant = new Date("2026-07-24T12:00:00Z");
    expect(spawnWindow(instant, "UTC", -5)).toEqual({ from: "2026-07-24", to: "2026-07-24" });
    expect(spawnWindow(instant, "UTC", 9999).to).toBe("2026-09-22"); // clamped to 60
  });

  it("counts whole days across a DST spring-forward", () => {
    // US DST begins 2026-03-08. A window spanning it must still be 7 calendar
    // days, not 7 days minus an hour — date keys are stepped on UTC anchors.
    const w = spawnWindow(new Date("2026-03-05T18:00:00Z"), "America/New_York", 7);
    expect(w).toEqual({ from: "2026-03-05", to: "2026-03-12" });
  });

  it("counts whole days across a DST fall-back", () => {
    // US DST ends 2026-11-01.
    const w = spawnWindow(new Date("2026-10-29T18:00:00Z"), "America/New_York", 5);
    expect(w).toEqual({ from: "2026-10-29", to: "2026-11-03" });
  });
});

describe("ruleFromTemplate", () => {
  const row = {
    daysOfWeek: "1,3,5",
    frequency: "weekly",
    monthlyMode: null,
    dayOfMonth: null,
    weekOfMonth: null,
    monthOfYear: null,
    startDate: "2026-01-01",
    endDate: null,
  };

  it("parses the weekday CSV", () => {
    expect(ruleFromTemplate(row).daysOfWeek).toEqual([1, 3, 5]);
  });

  it("drops junk and out-of-range weekdays", () => {
    expect(ruleFromTemplate({ ...row, daysOfWeek: "1, ,9,x,3" }).daysOfWeek).toEqual([1, 3]);
  });

  it("carries the cadence columns through unchanged", () => {
    const monthly = ruleFromTemplate({
      ...row,
      frequency: "monthly",
      monthlyMode: "nth_weekday",
      weekOfMonth: -1,
      daysOfWeek: "6",
    });
    expect(monthly.frequency).toBe("monthly");
    expect(monthly.monthlyMode).toBe("nth_weekday");
    expect(monthly.weekOfMonth).toBe(-1);
    expect(monthly.daysOfWeek).toEqual([6]);
  });

  it("defaults an unknown frequency to weekly", () => {
    expect(ruleFromTemplate({ ...row, frequency: "fortnightly" }).frequency).toBe("weekly");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/spawn-window.test.ts
```

Expected: FAIL — `Failed to resolve import "./spawn-window"`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/spawn-window.ts`:

```ts
import { addDays, type Frequency, type MonthlyMode, type RecurrenceRule } from "./recurrence";
import { resolveTimeZone, localDateKey } from "./date-buckets";

/** Upper bound on lead time, mirroring the API validation in routes. */
export const MAX_LEAD_DAYS = 60;

/** The columns of a recurring_tasks row that describe its schedule. */
export interface RecurringTaskRow {
  daysOfWeek: string;
  frequency: string;
  monthlyMode: string | null;
  dayOfMonth: number | null;
  weekOfMonth: number | null;
  monthOfYear: number | null;
  startDate: string;
  endDate: string | null;
}

/**
 * The date range the spawner should evaluate for one template, in the owner's
 * own calendar. `leadDays: 0` gives a single day — which is exactly the
 * pre-cadence behavior, now local rather than UTC.
 */
export function spawnWindow(
  now: Date,
  timezone: string | null,
  leadDays: number,
): { from: string; to: string } {
  const from = localDateKey(now, resolveTimeZone(timezone));
  const lead = Math.min(Math.max(Number.isFinite(leadDays) ? leadDays : 0, 0), MAX_LEAD_DAYS);
  return { from, to: addDays(from, lead) };
}

const FREQUENCIES = new Set<Frequency>(["weekly", "monthly", "yearly"]);
const MODES = new Set<MonthlyMode>(["day_of_month", "nth_weekday"]);

function parseDays(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 0 && n <= 6);
}

/** Turn a stored template row into a rule the pure engine can evaluate. */
export function ruleFromTemplate(t: RecurringTaskRow): RecurrenceRule {
  const frequency = FREQUENCIES.has(t.frequency as Frequency)
    ? (t.frequency as Frequency)
    : "weekly";
  const monthlyMode = t.monthlyMode && MODES.has(t.monthlyMode as MonthlyMode)
    ? (t.monthlyMode as MonthlyMode)
    : null;

  return {
    frequency,
    daysOfWeek: parseDays(t.daysOfWeek),
    monthlyMode,
    dayOfMonth: t.dayOfMonth,
    weekOfMonth: t.weekOfMonth,
    monthOfYear: t.monthOfYear,
    startDate: t.startDate,
    endDate: t.endDate,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/spawn-window.test.ts
```

Expected: PASS.

- [ ] **Step 5: Rewrite the spawner**

In `artifacts/api-server/src/routes/recurring-tasks.ts`, extend the imports at the top:

```ts
import { eq, and } from "drizzle-orm";
import { db, recurringTasksTable, tasksTable, habitStreaksTable, usersTable } from "@workspace/db";
import { assignPoints, CATEGORY_LABELS, VALID_CATEGORIES } from "../lib/auto-points";
import { getHabitStreak, EMPTY_STREAK } from "../lib/habit-streaks";
import { occurrencesInWindow } from "../lib/recurrence";
import { spawnWindow, ruleFromTemplate } from "../lib/spawn-window";
```

Then replace the entire `spawnRecurringTasksForToday` function (currently lines 222–259) with:

```ts
/**
 * Called by the scheduler — creates upcoming quests from active recurring
 * templates for all users.
 *
 * Each template is evaluated over `[today, today + leadDays]` **in its owner's
 * timezone**, and every occurrence in that window is inserted carrying the true
 * occurrence date as its due date. A quest can therefore appear days early
 * without pretending to be due early: nudges key off `due_date <= today`, so an
 * early quest waits quietly until its day.
 *
 * Weekly templates have leadDays 0, collapsing the window to a single day —
 * the pre-cadence behavior, now in the user's own calendar.
 *
 * The unique constraint on (user_id, recurring_task_id, due_date) is the
 * authoritative guard against duplicates across concurrent scheduler instances.
 * onConflictDoNothing turns a constraint violation into a silent no-op, which
 * is also what makes re-evaluating the same window every minute free.
 */
export async function spawnRecurringTasksForToday(): Promise<number> {
  const now = new Date();

  const rows = await db
    .select({ tmpl: recurringTasksTable, timezone: usersTable.timezone })
    .from(recurringTasksTable)
    .innerJoin(usersTable, eq(recurringTasksTable.userId, usersTable.id))
    .where(eq(recurringTasksTable.isActive, true));

  let created = 0;
  for (const { tmpl, timezone } of rows) {
    const { from, to } = spawnWindow(now, timezone, tmpl.leadDays);
    const dates = occurrencesInWindow(ruleFromTemplate(tmpl), from, to);
    if (dates.length === 0) continue;

    const ap = assignPoints(tmpl.title, tmpl.priority);
    for (const dueDate of dates) {
      const [inserted] = await db.insert(tasksTable).values({
        userId: tmpl.userId,
        recurringTaskId: tmpl.id,
        title: tmpl.title,
        description: tmpl.description,
        points: ap.points,
        dueDate,
        priority: tmpl.priority,
        category: tmpl.category,
      }).onConflictDoNothing().returning({ id: tasksTable.id });
      if (inserted) created++;
    }
  }

  return created;
}
```

The module-level `parseDays` helper at the top of the route file is still used by `formatRecurring`; leave it in place.

- [ ] **Step 6: Run the full server suite and typecheck**

```bash
pnpm --filter @workspace/api-server test && pnpm --filter @workspace/api-server run typecheck
```

Expected: all tests PASS, typecheck clean. If `usersTable.timezone` is reported as unknown, confirm the export name in `lib/db/src/schema/users.ts` and fix the import.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/spawn-window.ts artifacts/api-server/src/lib/spawn-window.test.ts artifacts/api-server/src/routes/recurring-tasks.ts
git commit -m "feat(recurrence): window-based spawner with per-user local dates"
```

---

### Task 7: Cadence-aware habit streaks

**Files:**
- Modify: `artifacts/api-server/src/lib/habit-streaks.ts`
- Create: `artifacts/api-server/src/lib/streak-cadence.ts`
- Test: `artifacts/api-server/src/lib/streak-cadence.test.ts`

**Interfaces:**
- Consumes: `cadencePeriodKey`, `previousPeriodKey`, `Frequency` (Task 3).
- Produces: `function nextStreakState(input: StreakAdvanceInput): StreakAdvanceResult` — the pure decision; and an updated `advanceHabitStreak(userId, recurringTaskId, completionDate, userLevel, cadence)` where `cadence: { frequency: Frequency; occurrenceDate: string }`. `HabitStreakPreviousState` gains `prevLastPeriodKey: string | null`.

`advanceHabitStreak` is DB-bound and hard to unit test, so the *decision* — already counted? consecutive? — is extracted into a pure function and tested exhaustively there.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/streak-cadence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextStreakState } from "./streak-cadence";

const existing = {
  currentStreak: 4,
  longestStreak: 9,
  lastCompletedDate: "2026-06-15",
  lastPeriodKey: "2026-06",
};

describe("nextStreakState — weekly (unchanged behavior)", () => {
  it("advances when the previous completion was yesterday", () => {
    const r = nextStreakState({
      frequency: "weekly",
      completionDate: "2026-07-24",
      occurrenceDate: "2026-07-24",
      existing: { currentStreak: 3, longestStreak: 5, lastCompletedDate: "2026-07-23", lastPeriodKey: null },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 4, longestStreak: 5 });
  });

  it("resets when a day was skipped", () => {
    const r = nextStreakState({
      frequency: "weekly",
      completionDate: "2026-07-24",
      occurrenceDate: "2026-07-24",
      existing: { currentStreak: 3, longestStreak: 5, lastCompletedDate: "2026-07-21", lastPeriodKey: null },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, longestStreak: 5 });
  });

  it("reports already-counted for a repeat on the same day", () => {
    const r = nextStreakState({
      frequency: "weekly",
      completionDate: "2026-07-24",
      occurrenceDate: "2026-07-24",
      existing: { currentStreak: 3, longestStreak: 5, lastCompletedDate: "2026-07-24", lastPeriodKey: null },
    });
    expect(r.status).toBe("already_counted");
  });

  it("leaves the period key null", () => {
    const r = nextStreakState({
      frequency: "weekly",
      completionDate: "2026-07-24",
      occurrenceDate: "2026-07-24",
      existing: null,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, periodKey: null });
  });
});

describe("nextStreakState — monthly", () => {
  it("advances across consecutive months", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-07-16",
      occurrenceDate: "2026-07-15",
      existing,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 5, longestStreak: 9, periodKey: "2026-07" });
  });

  it("raises the longest streak when the new streak exceeds it", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-07-15",
      occurrenceDate: "2026-07-15",
      existing: { ...existing, currentStreak: 9, longestStreak: 9 },
    });
    expect(r).toMatchObject({ currentStreak: 10, longestStreak: 10 });
  });

  it("resets to 1 when a month was skipped", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-08-15",
      occurrenceDate: "2026-08-15",
      existing,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, periodKey: "2026-08" });
  });

  it("counts a late completion in the occurrence's period, not the completion's", () => {
    // Due Jul 31, actually finished Aug 2 — still the July beat.
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-08-02",
      occurrenceDate: "2026-07-31",
      existing,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 5, periodKey: "2026-07" });
  });

  it("reports already-counted for a second completion in the same month", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-06-20",
      occurrenceDate: "2026-06-15",
      existing,
    });
    expect(r.status).toBe("already_counted");
  });

  it("starts at 1 with no existing row", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-07-15",
      occurrenceDate: "2026-07-15",
      existing: null,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, longestStreak: 1, periodKey: "2026-07" });
  });

  it("treats a missing period key on an existing row as a reset, not a crash", () => {
    // A weekly template switched to monthly: no period key was ever stored.
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-07-15",
      occurrenceDate: "2026-07-15",
      existing: { currentStreak: 4, longestStreak: 9, lastCompletedDate: "2026-06-15", lastPeriodKey: null },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, periodKey: "2026-07" });
  });
});

describe("nextStreakState — yearly", () => {
  it("advances across consecutive years", () => {
    const r = nextStreakState({
      frequency: "yearly",
      completionDate: "2027-03-03",
      occurrenceDate: "2027-03-03",
      existing: { currentStreak: 2, longestStreak: 2, lastCompletedDate: "2026-03-03", lastPeriodKey: "2026" },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 3, periodKey: "2027" });
  });

  it("resets when a year was skipped", () => {
    const r = nextStreakState({
      frequency: "yearly",
      completionDate: "2028-03-03",
      occurrenceDate: "2028-03-03",
      existing: { currentStreak: 2, longestStreak: 2, lastCompletedDate: "2026-03-03", lastPeriodKey: "2026" },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, periodKey: "2028" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/streak-cadence.test.ts
```

Expected: FAIL — `Failed to resolve import "./streak-cadence"`.

- [ ] **Step 3: Write the pure decision module**

Create `artifacts/api-server/src/lib/streak-cadence.ts`:

```ts
import { cadencePeriodKey, previousPeriodKey, addDays, type Frequency } from "./recurrence";

export interface ExistingStreak {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: string | null;
  lastPeriodKey: string | null;
}

export interface StreakAdvanceInput {
  frequency: Frequency;
  /** The day the user pressed complete, in their local calendar. */
  completionDate: string;
  /** The scheduled occurrence this completion satisfies (the quest's due date). */
  occurrenceDate: string;
  existing: ExistingStreak | null;
}

export type StreakAdvanceResult =
  | { status: "already_counted" }
  | {
      status: "advanced";
      currentStreak: number;
      longestStreak: number;
      /** NULL for weekly — that path keeps comparing calendar days. */
      periodKey: string | null;
    };

/**
 * Decide what a completion does to a streak.
 *
 * Weekly keeps the original calendar-day rule untouched. Monthly and yearly
 * count *periods*, bucketed on the occurrence date rather than the completion
 * date — so a quest due the 31st and finished on the 2nd still lands in the
 * right beat, and being a little late costs nothing.
 */
export function nextStreakState(input: StreakAdvanceInput): StreakAdvanceResult {
  const { frequency, completionDate, occurrenceDate, existing } = input;
  const weekly = frequency === "weekly";
  const periodKey = weekly ? null : cadencePeriodKey(frequency, occurrenceDate);

  if (!existing) {
    return { status: "advanced", currentStreak: 1, longestStreak: 1, periodKey };
  }

  const alreadyCounted = weekly
    ? existing.lastCompletedDate === completionDate
    : existing.lastPeriodKey === periodKey;
  if (alreadyCounted) return { status: "already_counted" };

  const consecutive = weekly
    ? existing.lastCompletedDate === addDays(completionDate, -1)
    : existing.lastPeriodKey != null &&
      existing.lastPeriodKey === previousPeriodKey(frequency, periodKey!);

  const currentStreak = consecutive ? existing.currentStreak + 1 : 1;
  return {
    status: "advanced",
    currentStreak,
    longestStreak: Math.max(existing.longestStreak, currentStreak),
    periodKey,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/streak-cadence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire it into `advanceHabitStreak`**

In `artifacts/api-server/src/lib/habit-streaks.ts`, add the imports:

```ts
import { nextStreakState } from "./streak-cadence";
import type { Frequency } from "./recurrence";
```

Add `prevLastPeriodKey` to the snapshot interface:

```ts
export interface HabitStreakPreviousState {
  /** null means the row did not exist before (new insert); reverse by deleting it */
  prevCurrentStreak: number | null;
  prevLongestStreak: number | null;
  prevTotalCompletions: number | null;
  prevLastCompletedDate: string | null;
  /** Added with monthly/yearly cadences. Snapshots written before that ship
   *  lack the key entirely — JSON.parse yields undefined, which must be read
   *  as null so old completions stay reversible. */
  prevLastPeriodKey?: string | null;
  wasNew: boolean;
  badgesGrantedIds: number[];
}
```

Replace the signature and the whole `if (existing) { ... } else { ... }` block of `advanceHabitStreak` with:

```ts
export async function advanceHabitStreak(
  userId: number,
  recurringTaskId: number,
  completionDate: string,
  userLevel: number,
  cadence: { frequency: Frequency; occurrenceDate: string },
): Promise<{
  streak: typeof habitStreaksTable.$inferSelect;
  newBadges: typeof badgesTable.$inferSelect[];
  gearReward: GearRewardInfo | null;
  previousState: HabitStreakPreviousState;
}> {
  const existing = await getHabitStreak(userId, recurringTaskId);

  const decision = nextStreakState({
    frequency: cadence.frequency,
    completionDate,
    occurrenceDate: cadence.occurrenceDate,
    existing: existing
      ? {
          currentStreak: existing.currentStreak,
          longestStreak: existing.longestStreak,
          lastCompletedDate: existing.lastCompletedDate,
          lastPeriodKey: existing.lastPeriodKey,
        }
      : null,
  });

  let streak: typeof habitStreaksTable.$inferSelect;
  let previousState: HabitStreakPreviousState;

  if (existing) {
    previousState = {
      prevCurrentStreak: existing.currentStreak,
      prevLongestStreak: existing.longestStreak,
      prevTotalCompletions: existing.totalCompletions,
      prevLastCompletedDate: existing.lastCompletedDate ?? null,
      prevLastPeriodKey: existing.lastPeriodKey ?? null,
      wasNew: false,
      badgesGrantedIds: [],
    };

    // Already counted for this period — return unchanged, no badges or gear.
    if (decision.status === "already_counted") {
      return { streak: existing, newBadges: [], gearReward: null, previousState };
    }

    const [updated] = await db
      .update(habitStreaksTable)
      .set({
        currentStreak: decision.currentStreak,
        longestStreak: decision.longestStreak,
        totalCompletions: existing.totalCompletions + 1,
        lastCompletedDate: completionDate,
        lastPeriodKey: decision.periodKey,
      })
      .where(eq(habitStreaksTable.id, existing.id))
      .returning();
    streak = updated;
  } else {
    previousState = {
      prevCurrentStreak: null,
      prevLongestStreak: null,
      prevTotalCompletions: null,
      prevLastCompletedDate: null,
      prevLastPeriodKey: null,
      wasNew: true,
      badgesGrantedIds: [],
    };

    const periodKey = decision.status === "advanced" ? decision.periodKey : null;

    // The unique constraint on (user_id, recurring_task_id) ensures that even if two
    // concurrent first-time completions race here, only one insert succeeds.
    const [created] = await db
      .insert(habitStreaksTable)
      .values({
        userId,
        recurringTaskId,
        currentStreak: 1,
        longestStreak: 1,
        totalCompletions: 1,
        lastCompletedDate: completionDate,
        lastPeriodKey: periodKey,
      })
      .onConflictDoNothing()
      .returning();

    if (!created) {
      // Another concurrent request won the insert race; fetch the row it created.
      const [raced] = await db
        .select()
        .from(habitStreaksTable)
        .where(
          and(
            eq(habitStreaksTable.userId, userId),
            eq(habitStreaksTable.recurringTaskId, recurringTaskId),
          ),
        );
      if (!raced) {
        return {
          streak: {
            id: 0, userId, recurringTaskId,
            currentStreak: 1, longestStreak: 1, totalCompletions: 1,
            lastCompletedDate: completionDate, lastPeriodKey: periodKey,
            createdAt: new Date(),
          },
          newBadges: [],
          gearReward: null,
          previousState,
        };
      }
      streak = raced;
    } else {
      streak = created;
    }
  }
```

Immediately below that, gate the badge award on weekly cadence:

```ts
  // habit_streak badge thresholds are days (3, 7, 14, 30). Granting a
  // "7-day streak" badge for seven YEARS of a yearly quest is a mislabel,
  // not a reward — so only the daily-cadence path awards them. Gear keys off
  // totalCompletions, which is cadence-neutral, and stays enabled for all.
  let newBadges: typeof badgesTable.$inferSelect[] = [];
  if (cadence.frequency === "weekly") {
    const result = await checkAndAwardHabitBadges(userId, streak.currentStreak);
    newBadges = result.awarded;
    previousState.badgesGrantedIds = result.badgeIds;
  }
```

Delete the old `const { awarded: newBadges, badgeIds } = await checkAndAwardHabitBadges(...)` line and the `previousState.badgesGrantedIds = badgeIds;` line it fed. The `getPreviousDay` helper at the bottom of the file is now unused — delete it.

Finally, restore `lastPeriodKey` in `reverseHabitStreak`'s update block:

```ts
      await db
        .update(habitStreaksTable)
        .set({
          currentStreak: previousState.prevCurrentStreak,
          longestStreak: previousState.prevLongestStreak!,
          totalCompletions: previousState.prevTotalCompletions!,
          lastCompletedDate: previousState.prevLastCompletedDate,
          // Absent in snapshots written before cadences shipped — `?? null`
          // is what keeps those old completions reversible.
          lastPeriodKey: previousState.prevLastPeriodKey ?? null,
        })
        .where(eq(habitStreaksTable.id, existing.id));
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: one error in `routes/tasks.ts` — `advanceHabitStreak` now needs a 5th argument. Task 8 fixes it. Do not patch it here.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/streak-cadence.ts artifacts/api-server/src/lib/streak-cadence.test.ts artifacts/api-server/src/lib/habit-streaks.ts
git commit -m "feat(streaks): count occurrences by cadence period"
```

---

### Task 8: Pass cadence through task completion

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts:777-783`

**Interfaces:**
- Consumes: `advanceHabitStreak(userId, recurringTaskId, completionDate, userLevel, cadence)` (Task 7); `recurringTasksTable.frequency` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Read the current call site**

```bash
sed -n '770,790p' artifacts/api-server/src/routes/tasks.ts
```

Expected: the `if (task.recurringTaskId) { ... }` block that calls `advanceHabitStreak` with four arguments.

- [ ] **Step 2: Replace the block**

Replace lines 777–783 with:

```ts
  if (task.recurringTaskId) {
    const completionDate = today;
    // Cadence decides how the streak counts. Bucket on the quest's own due
    // date, not the day it was ticked off, so a monthly quest finished a
    // couple of days late still lands in the right period. due_date is
    // nullable (anchored tasks), so fall back to the completion date.
    const [template] = await db
      .select({ frequency: recurringTasksTable.frequency })
      .from(recurringTasksTable)
      .where(eq(recurringTasksTable.id, task.recurringTaskId));
    const frequency = (template?.frequency ?? "weekly") as Frequency;

    const result = await advanceHabitStreak(
      userId,
      task.recurringTaskId,
      completionDate,
      newLevel.level,
      { frequency, occurrenceDate: task.dueDate ?? completionDate },
    );
    habitBadges = result.newBadges;
    habitStreakPreviousState = result.previousState;
    habitGearReward = result.gearReward;
  }
```

- [ ] **Step 3: Add the imports**

At the top of `artifacts/api-server/src/routes/tasks.ts`, add `recurringTasksTable` to the existing `@workspace/db` import list, and add:

```ts
import type { Frequency } from "../lib/recurrence";
```

- [ ] **Step 4: Typecheck and run the full suite**

```bash
pnpm --filter @workspace/api-server run typecheck && pnpm --filter @workspace/api-server test
```

Expected: typecheck clean, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(streaks): pass template cadence through completion"
```

---

### Task 9: API contract — schema, validation, and response fields

**Files:**
- Modify: `lib/api-spec/openapi.yaml:3695-3796`
- Modify: `artifacts/api-server/src/routes/recurring-tasks.ts` (`formatRecurring`, POST, PATCH)
- Create: `artifacts/api-server/src/lib/recurrence-validation.ts`
- Test: `artifacts/api-server/src/lib/recurrence-validation.test.ts`

**Interfaces:**
- Consumes: `Frequency`, `MonthlyMode`, `describeRule` (Tasks 1–4); `MAX_LEAD_DAYS` (Task 6).
- Produces: `function validateRecurrenceInput(input: RecurrenceInput): string | null` — returns an error message, or `null` when the rule is coherent. Response fields `scheduleLabel: string` and `streakUnit: "day" | "month" | "year"`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/recurrence-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateRecurrenceInput, streakUnitFor } from "./recurrence-validation";

describe("validateRecurrenceInput — weekly", () => {
  it("accepts a weekly rule with days", () => {
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1, 3] })).toBeNull();
  });

  it("rejects a weekly rule with no days", () => {
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [] }))
      .toBe("Pick at least one day of the week.");
  });

  it("rejects an out-of-range weekday", () => {
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [7] }))
      .toBe("Days of the week must be 0 (Sunday) through 6 (Saturday).");
  });
});

describe("validateRecurrenceInput — monthly", () => {
  it("accepts a day-of-month rule", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 15,
    })).toBeNull();
  });

  it("accepts an nth-weekday rule, including last", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 2, daysOfWeek: [4],
    })).toBeNull();
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, daysOfWeek: [6],
    })).toBeNull();
  });

  it("requires a mode", () => {
    expect(validateRecurrenceInput({ frequency: "monthly" }))
      .toBe("Pick how the month is anchored: a day of the month, or a weekday.");
  });

  it("requires a valid day of month", () => {
    const msg = "Day of the month must be between 1 and 31.";
    expect(validateRecurrenceInput({ frequency: "monthly", monthlyMode: "day_of_month" })).toBe(msg);
    expect(validateRecurrenceInput({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 0 })).toBe(msg);
    expect(validateRecurrenceInput({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 32 })).toBe(msg);
  });

  it("requires a weekday for nth_weekday", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 1, daysOfWeek: [],
    })).toBe("Pick a weekday for this monthly schedule.");
  });

  it("requires a supported week ordinal", () => {
    const msg = "Pick the 1st, 2nd, 3rd, 4th, or last week of the month.";
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 5, daysOfWeek: [1],
    })).toBe(msg);
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", daysOfWeek: [1],
    })).toBe(msg);
  });
});

describe("validateRecurrenceInput — yearly", () => {
  it("accepts a full yearly rule", () => {
    expect(validateRecurrenceInput({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: 3, dayOfMonth: 3,
    })).toBeNull();
  });

  it("requires a month", () => {
    const msg = "Pick a month for this yearly schedule.";
    expect(validateRecurrenceInput({
      frequency: "yearly", monthlyMode: "day_of_month", dayOfMonth: 3,
    })).toBe(msg);
    expect(validateRecurrenceInput({
      frequency: "yearly", monthlyMode: "day_of_month", dayOfMonth: 3, monthOfYear: 13,
    })).toBe(msg);
  });
});

describe("validateRecurrenceInput — lead days", () => {
  it("accepts the boundaries", () => {
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1], leadDays: 0 })).toBeNull();
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1], leadDays: 60 })).toBeNull();
  });

  it("rejects out-of-range values", () => {
    const msg = "Lead time must be between 0 and 60 days.";
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1], leadDays: -1 })).toBe(msg);
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1], leadDays: 61 })).toBe(msg);
  });
});

describe("validateRecurrenceInput — unknown frequency", () => {
  it("rejects a frequency outside the three cadences", () => {
    expect(validateRecurrenceInput({ frequency: "fortnightly", daysOfWeek: [1] }))
      .toBe("Frequency must be weekly, monthly, or yearly.");
  });
});

describe("streakUnitFor", () => {
  it("maps each cadence to its streak unit", () => {
    expect(streakUnitFor("weekly")).toBe("day");
    expect(streakUnitFor("monthly")).toBe("month");
    expect(streakUnitFor("yearly")).toBe("year");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence-validation.test.ts
```

Expected: FAIL — `Failed to resolve import "./recurrence-validation"`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/recurrence-validation.ts`:

```ts
import type { Frequency } from "./recurrence";
import { MAX_LEAD_DAYS } from "./spawn-window";

export interface RecurrenceInput {
  frequency?: string;
  daysOfWeek?: number[];
  monthlyMode?: string;
  dayOfMonth?: number;
  weekOfMonth?: number;
  monthOfYear?: number;
  leadDays?: number;
}

export type StreakUnit = "day" | "month" | "year";

export function streakUnitFor(frequency: Frequency): StreakUnit {
  if (frequency === "monthly") return "month";
  if (frequency === "yearly") return "year";
  return "day";
}

/**
 * Check that a submitted rule is coherent. Returns the message to send with a
 * 400, or null when the rule is fine.
 *
 * Messages name what is missing and how to supply it. They never imply the
 * user did something wrong — a form that scolds is a form people avoid.
 */
export function validateRecurrenceInput(input: RecurrenceInput): string | null {
  const frequency = input.frequency ?? "weekly";
  if (frequency !== "weekly" && frequency !== "monthly" && frequency !== "yearly") {
    return "Frequency must be weekly, monthly, or yearly.";
  }

  const lead = input.leadDays;
  if (lead != null && (!Number.isInteger(lead) || lead < 0 || lead > MAX_LEAD_DAYS)) {
    return `Lead time must be between 0 and ${MAX_LEAD_DAYS} days.`;
  }

  const days = input.daysOfWeek ?? [];
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return "Days of the week must be 0 (Sunday) through 6 (Saturday).";
  }

  if (frequency === "weekly") {
    if (days.length === 0) return "Pick at least one day of the week.";
    return null;
  }

  if (frequency === "yearly") {
    const m = input.monthOfYear;
    if (m == null || !Number.isInteger(m) || m < 1 || m > 12) {
      return "Pick a month for this yearly schedule.";
    }
  }

  const mode = input.monthlyMode;
  if (mode !== "day_of_month" && mode !== "nth_weekday") {
    return "Pick how the month is anchored: a day of the month, or a weekday.";
  }

  if (mode === "day_of_month") {
    const d = input.dayOfMonth;
    if (d == null || !Number.isInteger(d) || d < 1 || d > 31) {
      return "Day of the month must be between 1 and 31.";
    }
    return null;
  }

  const n = input.weekOfMonth;
  if (n == null || (n !== -1 && (!Number.isInteger(n) || n < 1 || n > 4))) {
    return "Pick the 1st, 2nd, 3rd, 4th, or last week of the month.";
  }
  if (days.length === 0) return "Pick a weekday for this monthly schedule.";
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/recurrence-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update the OpenAPI schemas**

In `lib/api-spec/openapi.yaml`, add these properties to `RecurringTask` (after `lastCompletedDate`, before `createdAt`), and add `frequency`, `leadDays`, `scheduleLabel`, `streakUnit` to its `required` list:

```yaml
        frequency:
          type: string
          enum: [weekly, monthly, yearly]
        monthlyMode:
          type: ["string", "null"]
          enum: [day_of_month, nth_weekday, null]
        dayOfMonth:
          type: ["integer", "null"]
        weekOfMonth:
          type: ["integer", "null"]
          description: "1-4, or -1 meaning the last such weekday of the month"
        monthOfYear:
          type: ["integer", "null"]
        leadDays:
          type: integer
          description: "Days before the occurrence that the quest appears in the Quest Log"
        scheduleLabel:
          type: string
          description: "Human phrasing of the schedule, e.g. 'The 3rd Friday of every month'"
        streakUnit:
          type: string
          enum: [day, month, year]
```

Change `RecurringTaskInput`'s `required` from `[title, daysOfWeek, timeOfDay, startDate]` to `[title, timeOfDay, startDate]` (weekly rules still need days, but that is enforced by `validateRecurrenceInput`, which knows the frequency), drop `minItems: 1` from its `daysOfWeek`, and add to its properties:

```yaml
        frequency:
          type: string
          enum: [weekly, monthly, yearly]
          default: weekly
        monthlyMode:
          type: string
          enum: [day_of_month, nth_weekday]
        dayOfMonth:
          type: integer
          minimum: 1
          maximum: 31
        weekOfMonth:
          type: integer
          description: "1-4, or -1 meaning the last such weekday of the month"
        monthOfYear:
          type: integer
          minimum: 1
          maximum: 12
        leadDays:
          type: integer
          minimum: 0
          maximum: 60
          default: 0
```

Add the same six properties to `RecurringTaskUpdate` (all optional, no `default` keys).

- [ ] **Step 6: Regenerate the clients**

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected: files under `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` are rewritten and `typecheck:libs` passes.

- [ ] **Step 7: Wire the route handlers**

In `artifacts/api-server/src/routes/recurring-tasks.ts`, add the imports:

```ts
import { describeRule, type Frequency } from "../lib/recurrence";
import { ruleFromTemplate } from "../lib/spawn-window";
import { validateRecurrenceInput, streakUnitFor } from "../lib/recurrence-validation";
```

Replace `formatRecurring`'s return block so it carries the new fields:

```ts
async function formatRecurring(r: typeof recurringTasksTable.$inferSelect) {
  const days = parseDays(r.daysOfWeek);
  const ap = assignPoints(r.title, r.priority);
  const streak = await getHabitStreak(r.userId, r.id);
  const rule = ruleFromTemplate(r);
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    description: r.description,
    priority: r.priority,
    category: r.category,
    categoryLabel: CATEGORY_LABELS[r.category] ?? CATEGORY_LABELS.default,
    daysOfWeek: days,
    timeOfDay: r.timeOfDay,
    startDate: r.startDate,
    endDate: r.endDate,
    isActive: r.isActive,
    frequency: r.frequency,
    monthlyMode: r.monthlyMode,
    dayOfMonth: r.dayOfMonth,
    weekOfMonth: r.weekOfMonth,
    monthOfYear: r.monthOfYear,
    leadDays: r.leadDays,
    // Server owns the phrasing so client and server can't describe the same
    // rule differently.
    scheduleLabel: describeRule(rule),
    streakUnit: streakUnitFor(rule.frequency),
    estimatedPoints: ap.points,
    currentStreak: streak?.currentStreak ?? EMPTY_STREAK.currentStreak,
    longestStreak: streak?.longestStreak ?? EMPTY_STREAK.longestStreak,
    totalCompletions: streak?.totalCompletions ?? EMPTY_STREAK.totalCompletions,
    lastCompletedDate: streak?.lastCompletedDate ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
```

Replace the POST handler's destructure, guard, and insert with:

```ts
  const {
    title,
    description,
    priority = "medium",
    daysOfWeek,
    timeOfDay = "08:00",
    startDate,
    endDate,
    category,
    frequency = "weekly",
    monthlyMode,
    dayOfMonth,
    weekOfMonth,
    monthOfYear,
    leadDays = 0,
  } = req.body as {
    title?: string;
    description?: string;
    priority?: string;
    daysOfWeek?: number[];
    timeOfDay?: string;
    startDate?: string;
    endDate?: string;
    category?: string;
    frequency?: string;
    monthlyMode?: string;
    dayOfMonth?: number;
    weekOfMonth?: number;
    monthOfYear?: number;
    leadDays?: number;
  };

  if (!title || !startDate) {
    res.status(400).json({ error: "title and startDate are required" });
    return;
  }

  const ruleError = validateRecurrenceInput({
    frequency, daysOfWeek, monthlyMode, dayOfMonth, weekOfMonth, monthOfYear, leadDays,
  });
  if (ruleError) { res.status(400).json({ error: ruleError }); return; }

  const autoPoint = assignPoints(title, priority);
  const resolvedCategory = category && VALID_CATEGORIES.has(category) ? category : autoPoint.category;

  const [task] = await db
    .insert(recurringTasksTable)
    .values({
      userId,
      title,
      description,
      priority,
      category: resolvedCategory,
      daysOfWeek: (daysOfWeek ?? []).join(","),
      timeOfDay,
      startDate,
      endDate: endDate ?? null,
      isActive: true,
      frequency,
      monthlyMode: monthlyMode ?? null,
      dayOfMonth: dayOfMonth ?? null,
      weekOfMonth: weekOfMonth ?? null,
      monthOfYear: monthOfYear ?? null,
      leadDays,
    })
    .returning();

  res.status(201).json(await formatRecurring(task));
```

In the PATCH handler, add the six fields to the destructure and its type, then validate the *merged* rule before writing — a partial update must not be able to leave a row incoherent:

```ts
  const [existing] = await db
    .select()
    .from(recurringTasksTable)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const merged = {
    frequency: frequency ?? existing.frequency,
    daysOfWeek: daysOfWeek ?? parseDays(existing.daysOfWeek),
    monthlyMode: monthlyMode ?? existing.monthlyMode ?? undefined,
    dayOfMonth: dayOfMonth ?? existing.dayOfMonth ?? undefined,
    weekOfMonth: weekOfMonth ?? existing.weekOfMonth ?? undefined,
    monthOfYear: monthOfYear ?? existing.monthOfYear ?? undefined,
    leadDays: leadDays ?? existing.leadDays,
  };
  const ruleError = validateRecurrenceInput(merged);
  if (ruleError) { res.status(400).json({ error: ruleError }); return; }
```

and add to the `updates` object, alongside the existing conditional assignments:

```ts
  if (frequency != null) updates.frequency = frequency;
  if ("monthlyMode" in req.body) updates.monthlyMode = monthlyMode ?? null;
  if ("dayOfMonth" in req.body) updates.dayOfMonth = dayOfMonth ?? null;
  if ("weekOfMonth" in req.body) updates.weekOfMonth = weekOfMonth ?? null;
  if ("monthOfYear" in req.body) updates.monthOfYear = monthOfYear ?? null;
  if (leadDays != null) updates.leadDays = leadDays;
```

- [ ] **Step 8: Typecheck and run the full suite**

```bash
pnpm --filter @workspace/api-server run typecheck && pnpm --filter @workspace/api-server test && pnpm run typecheck:libs
```

Expected: all clean, all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react artifacts/api-server/src/lib/recurrence-validation.ts artifacts/api-server/src/lib/recurrence-validation.test.ts artifacts/api-server/src/routes/recurring-tasks.ts
git commit -m "feat(api): cadence fields, rule validation, and schedule labels"
```

---

### Task 10: Schedule editor in the create/edit form

**Files:**
- Modify: `artifacts/focusquest/src/pages/recurring.tsx` (`TaskFormState`, `getDefaultForm`, `RecurringTaskForm`, `handleCreate`, `handleSave`)
- Create: `artifacts/focusquest/src/lib/recurrence-form.ts`
- Test: `artifacts/focusquest/src/lib/recurrence-form.test.ts`

**Interfaces:**
- Consumes: the regenerated `RecurringTask` type and mutation hooks from `@workspace/api-client-react` (Task 9).
- Produces: `function defaultLeadDays(frequency: Frequency): number`, `function toRecurrencePayload(form: TaskFormState): RecurrencePayload`, and the extended `TaskFormState`.

The payload mapping is pure and easy to get subtly wrong (sending `dayOfMonth` on a weekly rule, or `daysOfWeek` on a day-of-month rule), so it is extracted and tested rather than inlined into two mutation calls.

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest/src/lib/recurrence-form.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { defaultLeadDays, toRecurrencePayload, type RecurrenceFormFields } from "./recurrence-form";

function form(overrides: Partial<RecurrenceFormFields> = {}): RecurrenceFormFields {
  return {
    frequency: "weekly",
    daysOfWeek: [1, 3, 5],
    monthlyMode: "day_of_month",
    dayOfMonth: 1,
    weekOfMonth: 1,
    monthOfYear: 1,
    leadDays: 0,
    ...overrides,
  };
}

describe("defaultLeadDays", () => {
  it("suggests a lead time scaled to the cadence", () => {
    expect(defaultLeadDays("weekly")).toBe(0);
    expect(defaultLeadDays("monthly")).toBe(3);
    expect(defaultLeadDays("yearly")).toBe(14);
  });
});

describe("toRecurrencePayload", () => {
  it("sends only weekday fields for a weekly rule", () => {
    expect(toRecurrencePayload(form())).toEqual({
      frequency: "weekly",
      daysOfWeek: [1, 3, 5],
      monthlyMode: null,
      dayOfMonth: null,
      weekOfMonth: null,
      monthOfYear: null,
      leadDays: 0,
    });
  });

  it("sends the day and no weekdays for a day-of-month rule", () => {
    const payload = toRecurrencePayload(form({
      frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 15, leadDays: 3,
    }));
    expect(payload).toEqual({
      frequency: "monthly",
      daysOfWeek: [],
      monthlyMode: "day_of_month",
      dayOfMonth: 15,
      weekOfMonth: null,
      monthOfYear: null,
      leadDays: 3,
    });
  });

  it("sends a single weekday and the ordinal for an nth-weekday rule", () => {
    const payload = toRecurrencePayload(form({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, daysOfWeek: [6, 2],
    }));
    expect(payload.daysOfWeek).toEqual([6]);
    expect(payload.weekOfMonth).toBe(-1);
    expect(payload.dayOfMonth).toBeNull();
  });

  it("includes the month for a yearly rule", () => {
    const payload = toRecurrencePayload(form({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: 3, dayOfMonth: 3, leadDays: 14,
    }));
    expect(payload).toMatchObject({ frequency: "yearly", monthOfYear: 3, dayOfMonth: 3, leadDays: 14 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter focusquest exec vitest run src/lib/recurrence-form.test.ts
```

Expected: FAIL — `Failed to resolve import "./recurrence-form"`.

If the filter name is rejected, read the `name` field: `node -e "console.log(require('./artifacts/focusquest/package.json').name)"` and use that.

- [ ] **Step 3: Write the implementation**

Create `artifacts/focusquest/src/lib/recurrence-form.ts`:

```ts
export type Frequency = "weekly" | "monthly" | "yearly";
export type MonthlyMode = "day_of_month" | "nth_weekday";

export interface RecurrenceFormFields {
  frequency: Frequency;
  daysOfWeek: number[];
  monthlyMode: MonthlyMode;
  dayOfMonth: number;
  weekOfMonth: number;
  monthOfYear: number;
  leadDays: number;
}

export interface RecurrencePayload {
  frequency: Frequency;
  daysOfWeek: number[];
  monthlyMode: MonthlyMode | null;
  dayOfMonth: number | null;
  weekOfMonth: number | null;
  monthOfYear: number | null;
  leadDays: number;
}

/**
 * A starting suggestion, not a rule: a yearly quest with no runway is nearly
 * useless, but the user owns the field and can set anything 0–60.
 */
export function defaultLeadDays(frequency: Frequency): number {
  if (frequency === "monthly") return 3;
  if (frequency === "yearly") return 14;
  return 0;
}

/**
 * Send only the fields the chosen rule actually uses. The form keeps every
 * control populated so switching cadence back and forth doesn't lose the
 * user's earlier answers — this is where the unused ones get dropped.
 */
export function toRecurrencePayload(form: RecurrenceFormFields): RecurrencePayload {
  if (form.frequency === "weekly") {
    return {
      frequency: "weekly",
      daysOfWeek: form.daysOfWeek,
      monthlyMode: null,
      dayOfMonth: null,
      weekOfMonth: null,
      monthOfYear: null,
      leadDays: form.leadDays,
    };
  }

  const byWeekday = form.monthlyMode === "nth_weekday";
  return {
    frequency: form.frequency,
    // nth_weekday carries exactly one weekday.
    daysOfWeek: byWeekday ? form.daysOfWeek.slice(0, 1) : [],
    monthlyMode: form.monthlyMode,
    dayOfMonth: byWeekday ? null : form.dayOfMonth,
    weekOfMonth: byWeekday ? form.weekOfMonth : null,
    monthOfYear: form.frequency === "yearly" ? form.monthOfYear : null,
    leadDays: form.leadDays,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter focusquest exec vitest run src/lib/recurrence-form.test.ts
```

Expected: PASS.

- [ ] **Step 5: Extend the form state**

In `artifacts/focusquest/src/pages/recurring.tsx`, add the import and the constants below the existing `DAYS` array:

```ts
import {
  defaultLeadDays, toRecurrencePayload,
  type Frequency, type MonthlyMode,
} from "@/lib/recurrence-form";

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const WEEK_ORDINALS: { value: number; label: string }[] = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: -1, label: "Last" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
```

Extend `TaskFormState` and `getDefaultForm`:

```ts
interface TaskFormState {
  title: string;
  description: string;
  priority: string;
  category: string;
  daysOfWeek: number[];
  timeOfDay: string;
  startDate: Date;
  hasEndDate: boolean;
  endDate: Date | undefined;
  frequency: Frequency;
  monthlyMode: MonthlyMode;
  dayOfMonth: number;
  weekOfMonth: number;
  monthOfYear: number;
  leadDays: number;
}

function getDefaultForm(): TaskFormState {
  return {
    title: "",
    description: "",
    priority: "medium",
    category: "",
    daysOfWeek: [1, 2, 3, 4, 5],
    timeOfDay: "08:00",
    startDate: new Date(),
    hasEndDate: false,
    endDate: undefined,
    frequency: "weekly",
    monthlyMode: "day_of_month",
    dayOfMonth: 1,
    weekOfMonth: 1,
    monthOfYear: new Date().getMonth() + 1,
    leadDays: 0,
  };
}
```

- [ ] **Step 6: Replace the "Repeat on" block in `RecurringTaskForm`**

Update `valid` so monthly/yearly rules aren't blocked by the weekly-only day check, and add a frequency handler that re-suggests lead time:

```ts
  const needsWeekday = form.frequency === "weekly" || form.monthlyMode === "nth_weekday";
  const valid = Boolean(form.title.trim()) && (!needsWeekday || form.daysOfWeek.length > 0);

  const setFrequency = (frequency: Frequency) =>
    setForm((f) => ({ ...f, frequency, leadDays: defaultLeadDays(frequency) }));
```

Replace the entire `<div>` containing the "Repeat on" label and `<DaySelector>` (currently lines 242–248) with:

```tsx
      <div>
        <label className="text-sm font-medium text-foreground mb-2 block">Repeats</label>
        <div className="flex gap-1.5 mb-4">
          {FREQUENCIES.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFrequency(f.value)}
              className={`
                flex-1 py-2 rounded-lg text-xs font-bold transition-all duration-200 border
                ${form.frequency === f.value
                  ? "bg-primary text-background border-primary shadow-[0_0_8px_rgba(0,255,255,0.4)]"
                  : "bg-muted/30 text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"}
              `}
            >
              {f.label}
            </button>
          ))}
        </div>

        {form.frequency === "weekly" ? (
          <>
            <DaySelector value={form.daysOfWeek} onChange={(d) => set("daysOfWeek", d)} />
            {form.daysOfWeek.length === 0 && (
              <p className="text-xs text-red-400 mt-1">Select at least one day.</p>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {form.frequency === "yearly" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Month</label>
                <Select
                  value={String(form.monthOfYear)}
                  onValueChange={(v) => set("monthOfYear", Number(v))}
                >
                  <SelectTrigger className="border-primary/20 w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex gap-1.5">
              {([
                { value: "day_of_month", label: "On a date" },
                { value: "nth_weekday", label: "On a weekday" },
              ] as { value: MonthlyMode; label: string }[]).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => set("monthlyMode", m.value)}
                  className={`
                    flex-1 py-2 rounded-lg text-xs font-bold transition-all duration-200 border
                    ${form.monthlyMode === m.value
                      ? "bg-primary text-background border-primary"
                      : "bg-muted/30 text-muted-foreground border-border hover:border-primary/40"}
                  `}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {form.monthlyMode === "day_of_month" ? (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Day of the month</label>
                <Select
                  value={String(form.dayOfMonth)}
                  onValueChange={(v) => set("dayOfMonth", Number(v))}
                >
                  <SelectTrigger className="border-primary/20 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Months without this day use their last day instead.
                </p>
              </div>
            ) : (
              <div className="flex gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Which</label>
                  <Select
                    value={String(form.weekOfMonth)}
                    onValueChange={(v) => set("weekOfMonth", Number(v))}
                  >
                    <SelectTrigger className="border-primary/20 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WEEK_ORDINALS.map((o) => (
                        <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Weekday</label>
                  <Select
                    value={String(form.daysOfWeek[0] ?? 1)}
                    onValueChange={(v) => set("daysOfWeek", [Number(v)])}
                  >
                    <SelectTrigger className="border-primary/20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d) => (
                        <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-foreground mb-1 block">Show it this early</label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={60}
            value={form.leadDays}
            onChange={(e) => set("leadDays", Math.min(60, Math.max(0, Number(e.target.value) || 0)))}
            className="border-primary/20 focus:border-primary w-24"
          />
          <span className="text-sm text-muted-foreground">days before it's due</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          The quest appears in your Quest Log early, still dated for the day it's due.
        </p>
      </div>
```

- [ ] **Step 7: Send the new fields on create and edit**

In `handleCreate` (component `Recurring`), spread the payload into the mutation body:

```ts
    createMutation.mutate({
      data: {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority as "low" | "medium" | "high",
        timeOfDay: form.timeOfDay,
        startDate: format(form.startDate, "yyyy-MM-dd"),
        endDate: form.hasEndDate && form.endDate ? format(form.endDate, "yyyy-MM-dd") : undefined,
        ...toRecurrencePayload(form),
        ...(form.category ? { category: form.category as any } : {}),
      } as Parameters<typeof createMutation.mutate>[0]["data"],
    }, {
```

In `handleSave` (component `RecurringTaskCard`), do the same:

```ts
      data: {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority as "low" | "medium" | "high",
        timeOfDay: form.timeOfDay,
        startDate: format(form.startDate, "yyyy-MM-dd"),
        endDate: form.hasEndDate && form.endDate ? format(form.endDate, "yyyy-MM-dd") : null,
        ...toRecurrencePayload(form),
        ...(form.category ? { category: form.category as any } : {}),
      } as Parameters<typeof updateMutation.mutate>[0]["data"],
```

And in the same component, populate the edit form's `initial` from the task:

```ts
    const initial: TaskFormState = {
      title: task.title,
      description: task.description ?? "",
      priority: task.priority,
      category: task.category ?? "default",
      daysOfWeek: task.daysOfWeek,
      timeOfDay: task.timeOfDay,
      startDate: parseISO(task.startDate),
      hasEndDate: !!task.endDate,
      endDate: task.endDate ? parseISO(task.endDate) : undefined,
      frequency: (task.frequency ?? "weekly") as Frequency,
      monthlyMode: (task.monthlyMode ?? "day_of_month") as MonthlyMode,
      dayOfMonth: task.dayOfMonth ?? 1,
      weekOfMonth: task.weekOfMonth ?? 1,
      monthOfYear: task.monthOfYear ?? new Date().getMonth() + 1,
      leadDays: task.leadDays ?? 0,
    };
```

- [ ] **Step 8: Typecheck and test**

```bash
pnpm --filter focusquest run typecheck && pnpm --filter focusquest test
```

Expected: clean typecheck, all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add artifacts/focusquest/src/lib/recurrence-form.ts artifacts/focusquest/src/lib/recurrence-form.test.ts artifacts/focusquest/src/pages/recurring.tsx
git commit -m "feat(ui): monthly and yearly schedule editor"
```

---

### Task 11: Card display — schedule label and cadence streaks

**Files:**
- Modify: `artifacts/focusquest/src/pages/recurring.tsx` (`StreakBadge`, `RecurringTaskCard`, remove `formatDays`)

**Interfaces:**
- Consumes: `scheduleLabel` and `streakUnit` from the API response (Task 9).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Teach `StreakBadge` the cadence unit**

Replace the `StreakBadge` component:

```tsx
function streakPhrase(streak: number, unit: string): string {
  if (unit === "month") return `${streak} ${streak === 1 ? "month" : "months"} in a row`;
  if (unit === "year") return `${streak} ${streak === 1 ? "year" : "years"} in a row`;
  return `${streak} day streak`;
}

function StreakBadge({
  streak, longest, total, unit,
}: { streak: number; longest: number; total: number; unit: string }) {
  if (total === 0) return null;
  const bestLabel = unit === "day" ? `Best: ${longest}` : `Best: ${streakPhrase(longest, unit)}`;
  return (
    <div className="flex items-center gap-3 text-xs flex-wrap">
      <span className={`flex items-center gap-1 font-bold ${getStreakColor(streak)}`}>
        <Flame className={`w-3.5 h-3.5 ${streak > 0 ? "drop-shadow-[0_0_4px_rgba(251,146,60,0.7)]" : ""}`} />
        {streakPhrase(streak, unit)}
      </span>
      {longest > 0 && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Trophy className="w-3 h-3" />
          {bestLabel}
        </span>
      )}
      <span className="flex items-center gap-1 text-muted-foreground">
        <CheckCircle2 className="w-3 h-3" />
        {total} total
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Render the server's schedule label**

In `RecurringTaskCard`, replace the `formatDays` call in the summary row:

```tsx
            <span className="flex items-center gap-1">
              <Repeat className="w-3 h-3" />
              {task.scheduleLabel}
            </span>
```

Pass the unit into the badge (both places it is rendered — the summary row and the expanded stats panel):

```tsx
              <StreakBadge
                streak={task.currentStreak}
                longest={task.longestStreak}
                total={task.totalCompletions}
                unit={task.streakUnit}
              />
```

In the expanded details grid, replace the "Days selected" cell with a schedule cell that works for every cadence, and surface lead time when set:

```tsx
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Schedule</span>
              <p className="text-foreground mt-0.5">{task.scheduleLabel}</p>
            </div>
            {task.leadDays > 0 && (
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Appears early</span>
                <p className="text-foreground mt-0.5">
                  {task.leadDays} {task.leadDays === 1 ? "day" : "days"} before it's due
                </p>
              </div>
            )}
```

In the three-up stats panel below it, relabel the streak tiles by unit:

```tsx
                { label: "Current streak", value: task.currentStreak, icon: <Flame className={`w-4 h-4 ${getStreakColor(task.currentStreak)}`} />, suffix: task.streakUnit === "day" ? "days" : `${task.streakUnit}s` },
                { label: "Longest streak", value: task.longestStreak, icon: <Trophy className="w-4 h-4 text-amber-400" />, suffix: task.streakUnit === "day" ? "days" : `${task.streakUnit}s` },
```

- [ ] **Step 3: Delete the now-unused local helper**

Remove the `formatDays` function (currently lines 132–137). `describeRule` on the server has replaced it, and leaving a second phrasing implementation in the codebase is exactly the drift the server-owned label exists to prevent.

- [ ] **Step 4: Typecheck and test**

```bash
pnpm --filter focusquest run typecheck && pnpm --filter focusquest test
```

Expected: clean typecheck (a `formatDays is declared but never read` error means step 3 was skipped), all tests PASS.

- [ ] **Step 5: Verify in the browser**

Start the dev server via the preview tooling (never `pnpm dev` in a shell), then:
1. Open `/recurring` and click **New Template**.
2. Switch **Repeats** to Monthly → "On a weekday" → Last / Saturday. Confirm the lead-time field pre-filled to 3.
3. Save, and confirm the card reads "The last Saturday of every month".
4. Edit it, switch to Yearly, pick March, save, and confirm it reads "The 1st Saturday of every March" (or the day-of-month phrasing if you switched modes).
5. Check the browser console for errors.

- [ ] **Step 6: Full-repo verification**

```bash
pnpm run typecheck && pnpm --filter @workspace/api-server test && pnpm --filter focusquest test
```

Expected: everything clean and green. Record the actual test counts — do not claim success without reading the output.

- [ ] **Step 7: Commit**

```bash
git add artifacts/focusquest/src/pages/recurring.tsx
git commit -m "feat(ui): cadence-aware schedule labels and streak phrasing"
```

---

## Verification checklist

Before opening a PR:

- [ ] `pnpm run typecheck` clean across the whole workspace
- [ ] `pnpm --filter @workspace/api-server test` green, with new suites for `recurrence`, `spawn-window`, `streak-cadence`, `recurrence-validation`
- [ ] `pnpm --filter focusquest test` green
- [ ] Migration `0007` applied to Neon and `lib/db/drizzle/meta/_journal.json` committed
- [ ] An existing weekly template still spawns exactly one quest per scheduled day, and its streak still reads "N day streak"
- [ ] A monthly template with lead time spawns exactly one quest, dated the occurrence day, and re-running the tick creates no duplicate
- [ ] No file under any `src/generated/` directory was hand-edited
