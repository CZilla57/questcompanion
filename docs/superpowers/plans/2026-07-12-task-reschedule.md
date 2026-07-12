# Change a Quest's Date After Entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user change the due date of an existing incomplete quest, via a date field in the Edit dialog and a quick-reschedule control on each quest row.

**Architecture:** A shared, unit-tested local-time date helper feeds two UI entry points (edit dialog + per-row popover), both calling the existing `useUpdateTask` mutation with a `dueDate`. A small backend guard turns a recurring-collision DB error into a friendly `409`. No schema/migration changes — `PATCH /tasks/:id` and the generated client already accept `dueDate`.

**Tech Stack:** React 19, TanStack Query, orval-generated `@workspace/api-client-react` (axios), date-fns v3, shadcn/radix `Popover` + react-day-picker `Calendar`, Express + drizzle-orm (node-postgres), vitest.

## Global Constraints

- **Incomplete quests only.** Reschedule UI is rendered only when `!task.completed`; the Edit dialog already opens only for incomplete quests. The backend already rejects `dueDate` edits on completed tasks with `409`.
- **Due-date string format is `yyyy-MM-dd`**, handled in **local time** exclusively through the helper (date-fns `parseISO` / `format`). **Never** use `new Date('yyyy-MM-dd')` (parses as UTC → off-by-one in negative-offset zones).
- **Backend 409 copy (verbatim):** `A quest from this habit already exists on that date.`
- **Reschedule shortcuts (verbatim labels):** `Today`, `Tomorrow`, `Next week`.
- **Reschedule success toast:** `Rescheduled to <MMM d>` with class `border-primary bg-primary/10`.
- **Branch:** all work is on `feat/task-reschedule` (already checked out).
- `focusDate` / `isDailyFocus` (the "Today's Focus" pin) is **not** touched by rescheduling.

---

## File Structure

- **Create:** `artifacts/focusquest/src/lib/reschedule.ts` — pure date helpers (parse/format/shortcuts).
- **Create:** `artifacts/focusquest/src/lib/reschedule.test.ts` — vitest unit tests for the helper.
- **Modify:** `artifacts/api-server/src/routes/tasks.ts` — wrap the incomplete-task `UPDATE` with a unique-violation → `409` guard.
- **Modify:** `artifacts/focusquest/src/pages/tasks.tsx` — add a "Due date" field to the Edit Quest dialog.
- **Modify:** `artifacts/focusquest/src/components/task-item.tsx` — add the per-row quick-reschedule popover.

---

## Task 1: Shared local-time date helper

**Files:**
- Create: `artifacts/focusquest/src/lib/reschedule.ts`
- Test: `artifacts/focusquest/src/lib/reschedule.test.ts`

**Interfaces:**
- Consumes: date-fns (`addDays`, `format`, `parseISO`, `startOfToday`).
- Produces:
  - `parseDueDate(s: string): Date` — `yyyy-MM-dd` → local-midnight `Date`.
  - `toDueDateString(d: Date): string` — `Date` → `yyyy-MM-dd`.
  - `todayDueDate(): string`, `tomorrowDueDate(): string`, `nextWeekDueDate(): string` — local-today-relative `yyyy-MM-dd` strings.

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest/src/lib/reschedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseDueDate,
  toDueDateString,
  todayDueDate,
  tomorrowDueDate,
  nextWeekDueDate,
} from "./reschedule";

const DAY_MS = 86_400_000;

describe("toDueDateString", () => {
  it("formats a local Date to yyyy-MM-dd", () => {
    // new Date(year, monthIndex, day) is local time; July = month index 6.
    expect(toDueDateString(new Date(2026, 6, 12))).toBe("2026-07-12");
  });
});

describe("parseDueDate", () => {
  it("parses yyyy-MM-dd to local midnight (no UTC off-by-one)", () => {
    const d = parseDueDate("2026-07-12");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July, 0-based
    expect(d.getDate()).toBe(12);
    expect(d.getHours()).toBe(0);
  });

  it("round-trips with toDueDateString", () => {
    expect(toDueDateString(parseDueDate("2026-12-31"))).toBe("2026-12-31");
  });
});

describe("shortcut dates", () => {
  it("tomorrow is exactly one day after today", () => {
    const today = parseDueDate(todayDueDate());
    const tomorrow = parseDueDate(tomorrowDueDate());
    expect(Math.round((tomorrow.getTime() - today.getTime()) / DAY_MS)).toBe(1);
  });

  it("next week is exactly seven days after today", () => {
    const today = parseDueDate(todayDueDate());
    const nextWeek = parseDueDate(nextWeekDueDate());
    expect(Math.round((nextWeek.getTime() - today.getTime()) / DAY_MS)).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest exec vitest run src/lib/reschedule.test.ts`
Expected: FAIL — cannot resolve `./reschedule` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `artifacts/focusquest/src/lib/reschedule.ts`:

```ts
import { addDays, format, parseISO, startOfToday } from "date-fns";

/**
 * Due dates are stored as plain `yyyy-MM-dd` strings and must be treated in the
 * user's LOCAL time. `parseISO` parses a date-only string to local midnight;
 * `format` writes local calendar days. Going through these avoids the UTC
 * off-by-one that `new Date('yyyy-MM-dd')` produces in negative-offset zones.
 */

/** Parse a `yyyy-MM-dd` due-date string to a local-midnight Date. */
export function parseDueDate(s: string): Date {
  return parseISO(s);
}

/** Format a Date to the `yyyy-MM-dd` string the API stores. */
export function toDueDateString(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Local today as a `yyyy-MM-dd` string. */
export function todayDueDate(): string {
  return toDueDateString(startOfToday());
}

/** Local tomorrow as a `yyyy-MM-dd` string. */
export function tomorrowDueDate(): string {
  return toDueDateString(addDays(startOfToday(), 1));
}

/** One week from local today as a `yyyy-MM-dd` string. */
export function nextWeekDueDate(): string {
  return toDueDateString(addDays(startOfToday(), 7));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/focusquest exec vitest run src/lib/reschedule.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/reschedule.ts artifacts/focusquest/src/lib/reschedule.test.ts
git commit -m "feat(reschedule): local-time due-date helpers with tests"
```

---

## Task 2: Backend recurring-collision guard

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` (the `PATCH /tasks/:id` incomplete-task branch, ~lines 312–327)

**Interfaces:**
- Consumes: nothing new.
- Produces: on unique-violation of `tasks_recurring_unique_idx`, responds `409 { error: "A quest from this habit already exists on that date." }` instead of a `500`.

**Context:** The `tasks` table has `unique("tasks_recurring_unique_idx").on(userId, recurringTaskId, dueDate)`. Rescheduling a habit-spawned quest (non-null `recurringTaskId`) onto a date already holding a sibling instance violates it. node-postgres surfaces this as SQLSTATE `23505`; drizzle-orm 0.45 may wrap the driver error, so check `.cause` too. There is no route-test harness for `tasks.ts`; verification is typecheck + inspection + preview.

- [ ] **Step 1: Add the unique-violation detector**

In `artifacts/api-server/src/routes/tasks.ts`, add this module-level helper directly above `function formatTask(` (near the top, after the `FOCUS_BONUS_POINTS` const):

```ts
// node-postgres reports a unique-constraint violation as SQLSTATE 23505.
// drizzle-orm may wrap the driver error, so inspect the error and its `cause`.
function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && name === constraint;
}
```

- [ ] **Step 2: Wrap the incomplete-task UPDATE in the guard**

Still in `artifacts/api-server/src/routes/tasks.ts`, find the tail of the `patch("/tasks/:id", …)` handler:

```ts
  // The WHERE clause re-checks completed=false as a safety guard against a race
  // between the read above and this write.
  const [task] = await db.update(tasksTable).set(updates)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId), eq(tasksTable.completed, false)))
    .returning();
  if (!task) { res.status(409).json({ error: "Cannot edit a completed task" }); return; }

  res.json(formatTask(task));
```

Replace it with:

```ts
  // The WHERE clause re-checks completed=false as a safety guard against a race
  // between the read above and this write.
  let task: typeof tasksTable.$inferSelect | undefined;
  try {
    [task] = await db.update(tasksTable).set(updates)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId), eq(tasksTable.completed, false)))
      .returning();
  } catch (err) {
    // Rescheduling a recurring-spawned quest onto a date that already holds a
    // sibling instance violates unique(userId, recurringTaskId, dueDate).
    if (isUniqueViolation(err, "tasks_recurring_unique_idx")) {
      res.status(409).json({ error: "A quest from this habit already exists on that date." });
      return;
    }
    throw err;
  }
  if (!task) { res.status(409).json({ error: "Cannot edit a completed task" }); return; }

  res.json(formatTask(task));
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "fix(tasks): return 409 on recurring due-date collision instead of 500"
```

---

## Task 3: Due-date field in the Edit Quest dialog

**Files:**
- Modify: `artifacts/focusquest/src/pages/tasks.tsx`

**Interfaces:**
- Consumes: `parseDueDate`, `toDueDateString` from Task 1 (`@/lib/reschedule`). `useUpdateTask` (already used on this page). `Calendar`, `Popover`, `PopoverContent`, `PopoverTrigger`, `Button`, `format`, `CalendarIcon` — all already imported in this file.
- Produces: Edit dialog sends `dueDate` (a `yyyy-MM-dd` string) in the update payload.

- [ ] **Step 1: Import the helper**

At the top of `artifacts/focusquest/src/pages/tasks.tsx`, below the existing `import { CATEGORIES, … } from "@/lib/categories";` line, add:

```ts
import { parseDueDate, toDueDateString } from "@/lib/reschedule";
```

- [ ] **Step 2: Add edit due-date state**

Find the block of edit state (starts with `const [editTask, setEditTask] = useState<Task | null>(null);`). Directly after the `const [editCategory, setEditCategory] = useState("");` line, add:

```ts
  const [editDueDate, setEditDueDate] = useState<Date | undefined>(undefined);
```

- [ ] **Step 3: Initialize it when opening the dialog**

In `handleOpenEdit`, after `setEditCategory(task.category ?? "default");`, add:

```ts
    setEditDueDate(parseDueDate(task.dueDate));
```

- [ ] **Step 4: Include dueDate in the save payload**

In `handleSaveEdit`, update the `updateMutation.mutate` `data` object to include `dueDate`. Change:

```ts
      data: {
        title: editTitle,
        description: editDesc,
        priority: editPriority as any,
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
        category: editCategory as any,
      }
```

to:

```ts
      data: {
        title: editTitle,
        description: editDesc,
        priority: editPriority as any,
        ...(editDueDate ? { dueDate: toDueDateString(editDueDate) } : {}),
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
        category: editCategory as any,
      }
```

- [ ] **Step 5: Render the "Due date" field in the edit form**

In the **Edit dialog** (the `<Dialog open={!!editTask && !editTask.completed} …>` block), the form has a Category `<div>` followed by the two-column Priority/Est-Time grid (`<div className="grid grid-cols-2 gap-3">`). Insert this new field **between** the Category `</div>` and the `<div className="grid grid-cols-2 gap-3">`:

```tsx
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Due date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={`w-full justify-start text-left font-normal border-primary/20 ${!editDueDate && "text-muted-foreground"}`}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                    {editDueDate ? format(editDueDate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 border-primary/20" align="start">
                  <Calendar mode="single" selected={editDueDate} onSelect={setEditDueDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: PASS — no type errors.

- [ ] **Step 7: Preview-verify**

Start the dev server (preview_start), open the Quest Log, open an incomplete quest's Edit dialog, confirm the **Due date** field shows the current date, pick a different day, Save. Expected: toast "Quest updated"; the quest's date badge reflects the new date (adjust the date filter if needed to see it).

- [ ] **Step 8: Commit**

```bash
git add artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(reschedule): add due-date field to the Edit Quest dialog"
```

---

## Task 4: Quick-reschedule control on each quest row

**Files:**
- Modify: `artifacts/focusquest/src/components/task-item.tsx`

**Interfaces:**
- Consumes: `toDueDateString`, `parseDueDate`, `todayDueDate`, `tomorrowDueDate`, `nextWeekDueDate` from Task 1 (`@/lib/reschedule`). `useUpdateTask` (already instantiated as `updateMutation` in this component). `queryClient`, `getGetTasksQueryKey`, `toast`, `format` (all already imported). `Button` (already imported).
- Produces: per-row popover that calls `updateMutation.mutate({ id, data: { dueDate } })` and refreshes the list.

- [ ] **Step 1: Add imports**

In `artifacts/focusquest/src/components/task-item.tsx`:

Add `CalendarClock` to the existing lucide-react import. Change:

```ts
import { Check, Clock, Edit2, Flame, Pin, PinOff, Shield, Timer, Trash2, Zap } from "lucide-react";
```

to:

```ts
import { CalendarClock, Check, Clock, Edit2, Flame, Pin, PinOff, Shield, Timer, Trash2, Zap } from "lucide-react";
```

Then add these imports below the existing `import { TaskSteps } from "./task-steps";` line:

```ts
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar } from "./ui/calendar";
import { parseDueDate, toDueDateString, todayDueDate, tomorrowDueDate, nextWeekDueDate } from "@/lib/reschedule";
```

- [ ] **Step 2: Add popover open state**

Inside the `TaskItem` component, next to the other `useState` calls (after `const [actualInput, setActualInput] = useState(...)`), add:

```ts
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
```

- [ ] **Step 3: Add the reschedule handler**

After the existing `handleSaveActualTime` function (and before `const isBusy = …`), add:

```ts
  const handleReschedule = (dueDate: string) => {
    updateMutation.mutate({ id: task.id, data: { dueDate } }, {
      onSuccess: () => {
        setRescheduleOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        toast({
          title: `Rescheduled to ${format(parseDueDate(dueDate), "MMM d")}`,
          className: "border-primary bg-primary/10",
        });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? err?.message ?? "Could not reschedule quest";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };
```

- [ ] **Step 4: Render the reschedule button in the actions cluster**

In the actions `<div className="flex items-center gap-1 md:opacity-0 …">`, find the pin block that ends with:

```tsx
        {!task.completed && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={isPinned ? "Unpin from Today's Focus" : "Pin to Today's Focus"}
            title={isPinned ? "Unpin from Today's Focus" : "Pin to Today's Focus"}
            className={`h-9 w-9 cursor-pointer ${isPinned ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
            onClick={handleToggleFocus}
            disabled={focusMutation.isPending}
          >
            {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </Button>
        )}
```

Immediately **after** that closing `)}`, insert:

```tsx
        {!task.completed && (
          <Popover open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Reschedule quest"
                title="Change date"
                className="h-9 w-9 cursor-pointer text-muted-foreground hover:text-primary"
                disabled={updateMutation.isPending}
              >
                <CalendarClock className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3 border-primary/20" align="end">
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => handleReschedule(todayDueDate())}
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => handleReschedule(tomorrowDueDate())}
                  >
                    Tomorrow
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs whitespace-nowrap"
                    onClick={() => handleReschedule(nextWeekDueDate())}
                  >
                    Next week
                  </Button>
                </div>
                <Calendar
                  mode="single"
                  selected={parseDueDate(task.dueDate)}
                  onSelect={(d) => { if (d) handleReschedule(toDueDateString(d)); }}
                  initialFocus
                />
              </div>
            </PopoverContent>
          </Popover>
        )}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: PASS — no type errors.

- [ ] **Step 6: Preview-verify**

With the dev server running: on an **incomplete** quest, click the new calendar-clock button — the popover shows **Today / Tomorrow / Next week** chips and a calendar. Click "Tomorrow": expected toast `Rescheduled to <date>`, and the quest moves off today's list. Pick an arbitrary calendar day: same behavior. Confirm a **completed** quest shows **no** reschedule button.

- [ ] **Step 7: Commit**

```bash
git add artifacts/focusquest/src/components/task-item.tsx
git commit -m "feat(reschedule): add per-quest quick-reschedule popover"
```

---

## Final verification

- [ ] Run the focusquest test suite: `pnpm --filter @workspace/focusquest test` — expected PASS (includes new `reschedule.test.ts`).
- [ ] Typecheck both packages: `pnpm --filter @workspace/focusquest typecheck` and `pnpm --filter @workspace/api-server typecheck` — expected PASS.
- [ ] Preview smoke test end-to-end: create a quest, reschedule it via the row popover and via the Edit dialog, confirm it lands on the chosen date and that completed quests expose no reschedule affordance.
