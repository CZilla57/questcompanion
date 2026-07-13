# Anchored Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Anchored" quests — one-off tasks with no due date that stay visible in every date view until done and, after a one-day grace period, withhold the daily "all done" bonus while open.

**Architecture:** A new `is_anchored` boolean plus a nullable `due_date` on the `tasks` table. The novel, bug-prone decision logic (grace-period bonus gating, "counts as today" completion) lives in a pure, unit-tested `lib/anchored-tasks.ts`; the Express routes call it. The Quest Log list query becomes a union of "dated today" and "incomplete anchored", and the task card + New/Edit dialogs gain an anchor affordance.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres/Neon), Zod, React 19 + TanStack Query, orval (OpenAPI codegen), Vitest, pnpm workspaces.

## Global Constraints

- **API changes:** edit `lib/api-spec/openapi.yaml`, then regenerate with `pnpm --filter @workspace/api-spec codegen`. Never hand-edit files under `*/src/generated`.
- **DB schema:** edit `lib/db/src/schema/*`, then `pnpm --filter @workspace/db push`. GOTCHA: `drizzle.config.ts` does not load `.env` — export `DATABASE_URL` first: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"`. There are NO migration files.
- **Tests:** Vitest per package — `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/focusquest test`. Filter one file with `... test -- <name>`.
- **Typecheck gate:** `pnpm typecheck` (root) must pass at the end of every task.
- **Naming:** user-facing name is **"Anchored"**; icon is lucide `Anchor`. Do not reuse "pin"/`Pin` (owned by Today's Focus).
- **Convention (app-maintained):** `is_anchored = true` ⟺ `due_date IS NULL`. Anchoring nulls the due date; un-anchoring sets it to today.
- **Commit** at the end of every task. Verify current branch is `feat/anchored-tasks` before each commit (this working tree is shared across sessions).

---

### Task 1: Database schema — nullable due date + `is_anchored`

**Files:**
- Modify: `lib/db/src/schema/tasks.ts:35` (drop `.notNull()` on `dueDate`) and `:36` (add `isAnchored` after `dueTime`)

**Interfaces:**
- Produces: `tasksTable.isAnchored` (boolean column, on `$inferSelect` as `isAnchored: boolean`); `tasksTable.dueDate` becomes `string | null` on `$inferSelect`.

- [ ] **Step 1: Make `dueDate` nullable**

In `lib/db/src/schema/tasks.ts`, change:

```ts
  dueDate: text("due_date").notNull(),
```
to:
```ts
  dueDate: text("due_date"),
```

- [ ] **Step 2: Add the `is_anchored` column**

Immediately after the `dueTime: text("due_time"),` line, add:

```ts
  isAnchored: boolean("is_anchored").notNull().default(false),
```

(`boolean` is already imported at the top of the file.)

- [ ] **Step 3: Push the schema to Neon**

Run from the repo root:

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```

Expected: `[✓] Changes applied` (adds `is_anchored`, drops the `due_date` NOT NULL constraint — both non-destructive, no interactive prompt).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (`formatTask` now returns `dueDate: string | null`; `res.json` is untyped so nothing breaks yet.)

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/tasks.ts
git commit -m "feat(db): nullable due_date + is_anchored on tasks"
```

---

### Task 2: Pure logic module — `lib/anchored-tasks.ts` (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/anchored-tasks.ts`
- Test: `artifacts/api-server/src/lib/anchored-tasks.test.ts`

**Interfaces:**
- Produces:
  - `utcDateString(d: Date): string`
  - `anchoredTaskGatesBonus(task: { isAnchored: boolean; createdAt: Date }, today: string): boolean`
  - `isBonusGatingTask(task: { dueDate: string | null; isAnchored: boolean; createdAt: Date }, today: string): boolean`
  - `countsAsTodayCompletion(task: { dueDate: string | null; isAnchored: boolean; completedAt: Date | null }, today: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/anchored-tasks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  utcDateString,
  anchoredTaskGatesBonus,
  isBonusGatingTask,
  countsAsTodayCompletion,
} from "./anchored-tasks";

const today = "2026-07-12";
const old = new Date("2026-07-01T00:00:00Z");

describe("utcDateString", () => {
  it("returns the YYYY-MM-DD portion in UTC", () => {
    expect(utcDateString(new Date("2026-07-12T23:30:00Z"))).toBe("2026-07-12");
  });
});

describe("anchoredTaskGatesBonus", () => {
  it("does not gate a non-anchored task", () => {
    expect(anchoredTaskGatesBonus({ isAnchored: false, createdAt: old }, today)).toBe(false);
  });
  it("does not gate an anchored task created today (grace)", () => {
    expect(anchoredTaskGatesBonus({ isAnchored: true, createdAt: new Date("2026-07-12T09:00:00Z") }, today)).toBe(false);
  });
  it("gates an anchored task created before today", () => {
    expect(anchoredTaskGatesBonus({ isAnchored: true, createdAt: new Date("2026-07-11T09:00:00Z") }, today)).toBe(true);
  });
});

describe("isBonusGatingTask", () => {
  it("includes a task due today", () => {
    expect(isBonusGatingTask({ dueDate: today, isAnchored: false, createdAt: old }, today)).toBe(true);
  });
  it("excludes a task due another day", () => {
    expect(isBonusGatingTask({ dueDate: "2026-07-15", isAnchored: false, createdAt: old }, today)).toBe(false);
  });
  it("includes a past-grace anchored task", () => {
    expect(isBonusGatingTask({ dueDate: null, isAnchored: true, createdAt: old }, today)).toBe(true);
  });
  it("excludes an anchored task created today", () => {
    expect(isBonusGatingTask({ dueDate: null, isAnchored: true, createdAt: new Date("2026-07-12T01:00:00Z") }, today)).toBe(false);
  });
});

describe("countsAsTodayCompletion", () => {
  it("counts a task due today", () => {
    expect(countsAsTodayCompletion({ dueDate: today, isAnchored: false, completedAt: null }, today)).toBe(true);
  });
  it("counts an anchored task completed today", () => {
    expect(countsAsTodayCompletion({ dueDate: null, isAnchored: true, completedAt: new Date("2026-07-12T20:00:00Z") }, today)).toBe(true);
  });
  it("does not count an anchored task completed another day", () => {
    expect(countsAsTodayCompletion({ dueDate: null, isAnchored: true, completedAt: new Date("2026-07-11T20:00:00Z") }, today)).toBe(false);
  });
  it("does not count an anchored task with no completion time", () => {
    expect(countsAsTodayCompletion({ dueDate: null, isAnchored: true, completedAt: null }, today)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- anchored-tasks`
Expected: FAIL — cannot resolve `./anchored-tasks`.

- [ ] **Step 3: Implement the module**

Create `artifacts/api-server/src/lib/anchored-tasks.ts`:

```ts
/** The UTC calendar-date portion (YYYY-MM-DD) of a timestamp. */
export function utcDateString(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

/**
 * Whether an anchored task should withhold the daily "all done" bonus today.
 * Anchored tasks gate starting the day AFTER they are created (a one-day grace),
 * so a task created today never blocks the bonus.
 */
export function anchoredTaskGatesBonus(
  task: { isAnchored: boolean; createdAt: Date },
  today: string,
): boolean {
  return task.isAnchored && utcDateString(task.createdAt) < today;
}

/**
 * Whether a task belongs to today's daily-bonus gating set: due today, or an
 * anchored task past its one-day grace period.
 */
export function isBonusGatingTask(
  task: { dueDate: string | null; isAnchored: boolean; createdAt: Date },
  today: string,
): boolean {
  return task.dueDate === today || anchoredTaskGatesBonus(task, today);
}

/**
 * Whether a completed task counts as "activity today" for streak-restore
 * accounting: a task due today, or an anchored task completed today.
 */
export function countsAsTodayCompletion(
  task: { dueDate: string | null; isAnchored: boolean; completedAt: Date | null },
  today: string,
): boolean {
  if (task.dueDate === today) return true;
  return task.isAnchored && task.completedAt != null && utcDateString(task.completedAt) === today;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- anchored-tasks`
Expected: PASS (14 assertions across 4 suites).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/anchored-tasks.ts artifacts/api-server/src/lib/anchored-tasks.test.ts
git commit -m "feat(api): pure anchored-task gating helpers with tests"
```

---

### Task 3: Backend CRUD surface — list injection, create, anchor toggle

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` — import (`:2`), `formatTask` (`:36-63`), `GET /tasks` (`:199-234`), `POST /tasks` (`:236-275`), `PATCH /tasks/:id` (`:344-421`)

**Interfaces:**
- Consumes: `tasksTable.isAnchored`, `tasksTable.dueDate` (nullable) from Task 1.
- Produces: `GET /tasks?date=X` returns dated-X tasks unioned with incomplete anchored tasks; `POST /tasks` accepts `isAnchored`; `PATCH /tasks/:id` accepts `isAnchored`.

- [ ] **Step 1: Import `or` from drizzle-orm**

Change line 2 of `artifacts/api-server/src/routes/tasks.ts`:

```ts
import { eq, and, desc, count, inArray } from "drizzle-orm";
```
to:
```ts
import { eq, and, or, desc, count, inArray } from "drizzle-orm";
```

- [ ] **Step 2: Surface `isAnchored` in `formatTask`**

In `formatTask`, immediately after the `focusDate: task.focusDate ?? null,` line, add:

```ts
    isAnchored: task.isAnchored,
```

- [ ] **Step 3: Rewrite the `GET /tasks` query to union dated + anchored**

In the `GET /tasks` handler, replace this block:

```ts
  const { date, completed, category } = req.query;

  const conditions = [eq(tasksTable.userId, userId)];
  if (date && typeof date === "string") {
    conditions.push(eq(tasksTable.dueDate, date));
  }
  if (completed !== undefined && completed !== null) {
    conditions.push(eq(tasksTable.completed, completed === "true"));
  }
  if (category && typeof category === "string" && VALID_CATEGORIES.has(category)) {
    conditions.push(eq(tasksTable.category, category));
  }

  const tasks = await db.select().from(tasksTable)
    .where(and(...conditions))
    .orderBy(desc(tasksTable.createdAt));
```

with:

```ts
  const { date, completed, category } = req.query;

  const userCond = eq(tasksTable.userId, userId);
  const completedCond =
    completed !== undefined && completed !== null
      ? eq(tasksTable.completed, completed === "true")
      : undefined;
  const categoryCond =
    category && typeof category === "string" && VALID_CATEGORIES.has(category)
      ? eq(tasksTable.category, category)
      : undefined;

  let where;
  if (date && typeof date === "string") {
    // Bucket A: tasks dated this day (respecting the status + category filters).
    const datedBucket = and(eq(tasksTable.dueDate, date), completedCond, categoryCond);
    // Bucket B: incomplete anchored tasks, injected regardless of date (respecting
    // the category filter). Skipped when the caller asked for completed-only, since
    // a completed anchored task has left the daily flow.
    const includeAnchored = completedCond === undefined || completed === "false";
    const anchoredBucket = includeAnchored
      ? and(eq(tasksTable.isAnchored, true), eq(tasksTable.completed, false), categoryCond)
      : undefined;
    where = and(userCond, anchoredBucket ? or(datedBucket, anchoredBucket) : datedBucket);
  } else {
    where = and(userCond, completedCond, categoryCond);
  }

  const tasks = await db.select().from(tasksTable)
    .where(where)
    .orderBy(desc(tasksTable.isAnchored), desc(tasksTable.createdAt));
```

(Drizzle's `and`/`or` ignore `undefined` arguments, so the optional filters compose cleanly.)

- [ ] **Step 4: Accept `isAnchored` in `POST /tasks` and relax due-date validation**

In the `POST /tasks` handler, replace this block:

```ts
  const { title, description, dueDate, dueTime, priority = "medium", estimatedMinutes, category } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    category?: string;
  };

  if (!title || !dueDate) {
    res.status(400).json({ error: "title and dueDate are required" });
    return;
  }
  if (dueTime !== undefined && dueTime !== null && !isValidDueTime(dueTime)) {
    res.status(400).json({ error: "dueTime must be HH:mm (24-hour)" });
    return;
  }

  const autoPoint = assignPoints(title, priority);
  const resolvedCategory = category && VALID_CATEGORIES.has(category) ? category : autoPoint.category;

  const [task] = await db.insert(tasksTable).values({
    userId,
    title,
    description,
    points: autoPoint.points,
    dueDate,
    dueTime: dueTime ?? null,
    priority,
    category: resolvedCategory,
    estimatedMinutes: estimatedMinutes ?? null,
  }).returning();
```

with:

```ts
  const { title, description, dueDate, dueTime, priority = "medium", estimatedMinutes, category, isAnchored } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    category?: string;
    isAnchored?: boolean;
  };

  const anchored = isAnchored === true;

  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!anchored && !dueDate) {
    res.status(400).json({ error: "dueDate is required for non-anchored quests" });
    return;
  }
  if (dueTime !== undefined && dueTime !== null && !isValidDueTime(dueTime)) {
    res.status(400).json({ error: "dueTime must be HH:mm (24-hour)" });
    return;
  }

  const autoPoint = assignPoints(title, priority);
  const resolvedCategory = category && VALID_CATEGORIES.has(category) ? category : autoPoint.category;

  // Anchored quests have no deadline: force a null date/time regardless of input.
  const [task] = await db.insert(tasksTable).values({
    userId,
    title,
    description,
    points: autoPoint.points,
    dueDate: anchored ? null : dueDate,
    dueTime: anchored ? null : (dueTime ?? null),
    priority,
    category: resolvedCategory,
    estimatedMinutes: estimatedMinutes ?? null,
    isAnchored: anchored,
  }).returning();
```

- [ ] **Step 5: Handle the `isAnchored` toggle in `PATCH /tasks/:id`**

In the `PATCH /tasks/:id` handler, add `isAnchored` to the destructured body type. Change:

```ts
  const { title, description, dueDate, dueTime, priority, estimatedMinutes, actualMinutes, category } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    actualMinutes?: number;
    category?: string;
  };
```
to:
```ts
  const { title, description, dueDate, dueTime, priority, estimatedMinutes, actualMinutes, category, isAnchored } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    actualMinutes?: number;
    category?: string;
    isAnchored?: boolean;
  };
```

Then, in the incomplete-task branch, immediately after the existing line:

```ts
  if (category != null && VALID_CATEGORIES.has(category)) updates.category = category;
```

add:

```ts
  if (isAnchored !== undefined) {
    if (isAnchored) {
      // Anchoring drops the deadline entirely.
      updates.isAnchored = true;
      updates.dueDate = null;
      updates.dueTime = null;
    } else {
      updates.isAnchored = false;
      // Un-anchoring re-enters the dated flow; default to today unless the same
      // request supplied an explicit date (handled above, which wins).
      if (dueDate == null) updates.dueDate = new Date().toISOString().split("T")[0]!;
    }
  }
```

- [ ] **Step 6: Verify pure tests still pass and typecheck**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (all existing suites + anchored-tasks).

Run: `pnpm typecheck`
Expected: PASS.

(No route-test harness exists for `tasks.ts`; runtime behavior is verified end-to-end in Task 8.)

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): anchored task create, list injection, and toggle"
```

---

### Task 4: Backend completion accounting — bonus gate, uncomplete, recommend

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` — import the helpers, `GET /tasks/recommend` overdue guard (`:152`), `POST /tasks/:id/complete` bonus check (`:505-509`), `POST /tasks/:id/uncomplete` streak check (`:857-864`)

**Interfaces:**
- Consumes: `isBonusGatingTask`, `countsAsTodayCompletion` from Task 2; `or` import + `tasksTable.isAnchored` from Task 3.

- [ ] **Step 1: Import the pure helpers**

After the existing import of `parse-cooldown` near the top of `artifacts/api-server/src/routes/tasks.ts`, add:

```ts
import { isBonusGatingTask, countsAsTodayCompletion } from "../lib/anchored-tasks";
```

- [ ] **Step 2: Guard the recommend overdue bonus against a null due date**

In `GET /tasks/recommend`, change:

```ts
    // Overdue bonus
    if (task.dueDate < today) {
      score += 20;
      reasons.push("overdue");
    }
```
to:
```ts
    // Overdue bonus (anchored tasks have no deadline and are never overdue).
    if (task.dueDate && task.dueDate < today) {
      score += 20;
      reasons.push("overdue");
    }
```

- [ ] **Step 3: Fold anchored tasks into the daily-bonus gate**

In the `POST /tasks/:id/complete` transaction, replace:

```ts
    // Daily bonus check: read today's tasks inside the transaction for consistency.
    const todayTasks = await tx.select().from(tasksTable)
      .where(and(eq(tasksTable.userId, userId), eq(tasksTable.dueDate, today)));
    const allDone = todayTasks.every((t) => t.id === id || t.completed);
    let bonusAwarded = false;
    if (allDone && todayTasks.length > 0) {
```

with:

```ts
    // Daily bonus check: the gating set is tasks due today plus anchored tasks past
    // their one-day grace (created before today). Fetch the superset in-transaction,
    // then filter with the pure predicate so grace logic stays unit-tested.
    const candidateTasks = await tx.select().from(tasksTable)
      .where(and(
        eq(tasksTable.userId, userId),
        or(eq(tasksTable.dueDate, today), eq(tasksTable.isAnchored, true)),
      ));
    const gatingTasks = candidateTasks.filter((t) => isBonusGatingTask(t, today));
    const allDone = gatingTasks.every((t) => t.id === id || t.completed);
    let bonusAwarded = false;
    if (allDone && gatingTasks.length > 0) {
```

- [ ] **Step 4: Count anchored completions in the uncomplete streak-restore check**

In the `POST /tasks/:id/uncomplete` transaction, replace:

```ts
    const otherCompletedToday = await tx.select({ id: tasksTable.id })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.userId, userId),
        eq(tasksTable.completed, true),
        eq(tasksTable.dueDate, today),
      ));
    const hasOtherCompletedToday = otherCompletedToday.some((t) => t.id !== id);
```

with:

```ts
    // Streak restore only if this task was the sole contributor to today's activity.
    // A "today contribution" is a task due today OR an anchored task completed today.
    const completedTodayCandidates = await tx.select()
      .from(tasksTable)
      .where(and(
        eq(tasksTable.userId, userId),
        eq(tasksTable.completed, true),
        or(eq(tasksTable.dueDate, today), eq(tasksTable.isAnchored, true)),
      ));
    const hasOtherCompletedToday = completedTodayCandidates.some(
      (t) => t.id !== id && countsAsTodayCompletion(t, today),
    );
```

- [ ] **Step 5: Verify tests and typecheck**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): anchored tasks gate daily bonus with grace + streak accounting"
```

---

### Task 5: API contract + codegen + frontend compile fixes

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (`Task` `:1423-1472`, `TaskInput` `:1531-1563`, `TaskUpdate` `:1565-1598`)
- Regenerate: `lib/api-zod/*`, `lib/api-client-react/*` (via codegen — do not hand-edit)
- Modify: `artifacts/focusquest/src/components/task-item.tsx` (date display `:254-261`, reschedule `selected` `:419`, reschedule visibility `:369`)
- Modify: `artifacts/focusquest/src/pages/tasks.tsx` (`handleOpenEdit` `:334`)

**Interfaces:**
- Produces: generated `Task` type with `isAnchored?: boolean` and `dueDate: string | null`; `TaskInput`/`TaskUpdate` accept `isAnchored`.

- [ ] **Step 1: Make `Task.dueDate` nullable and add `Task.isAnchored`**

In `lib/api-spec/openapi.yaml`, in the `Task` schema, change:

```yaml
        dueDate:
          type: string
```
to:
```yaml
        dueDate:
          type: ["string", "null"]
```

Then, immediately after the `focusDate` property block in `Task`, add:

```yaml
        isAnchored:
          type: boolean
          description: A no-deadline quest that stays visible until completed
```

- [ ] **Step 2: Relax `TaskInput` and add `isAnchored` to both bodies**

In `TaskInput`, change the required list:

```yaml
      required: [title, dueDate]
```
to:
```yaml
      required: [title]
```

Add to `TaskInput.properties` (after `dueTime`):

```yaml
        isAnchored:
          type: boolean
          default: false
          description: Create a no-deadline anchored quest (dueDate is ignored)
```

Add to `TaskUpdate.properties` (after `dueTime`):

```yaml
        isAnchored:
          type: boolean
          description: Toggle anchored (no-deadline) state; anchoring clears the due date
```

- [ ] **Step 3: Regenerate the client + zod**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: regenerates `lib/api-zod` and `lib/api-client-react`; `Task.dueDate` becomes `string | null`, `Task.isAnchored?: boolean`, `TaskInput.isAnchored?`, `TaskUpdate.isAnchored?`.

- [ ] **Step 4: Confirm typecheck now fails only at the known consumer sites**

Run: `pnpm typecheck`
Expected: FAIL at `task-item.tsx` (`parseDueDate(task.dueDate)` — `string | null`) and `tasks.tsx:334`. These are fixed in the next steps.

- [ ] **Step 5: Make the task card date display anchored-aware**

In `artifacts/focusquest/src/components/task-item.tsx`, add `Anchor` to the lucide import (add it to the existing `lucide-react` import list). Then replace:

```tsx
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>
              {format(parseDueDate(task.dueDate), 'MMM d, yyyy')}
              {task.dueTime ? ` · ${formatTime12h(task.dueTime)}` : ""}
            </span>
          </div>
```

with:

```tsx
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {task.dueDate && !task.isAnchored ? <Clock className="w-3 h-3" /> : <Anchor className="w-3 h-3" />}
            <span>
              {task.dueDate && !task.isAnchored
                ? `${format(parseDueDate(task.dueDate), 'MMM d, yyyy')}${task.dueTime ? ` · ${formatTime12h(task.dueTime)}` : ""}`
                : "No deadline"}
            </span>
          </div>
```

- [ ] **Step 6: Hide the reschedule control for anchored tasks and guard its calendar**

In the same file, change the reschedule wrapper condition:

```tsx
        {!task.completed && (
          <Popover open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
```
to:
```tsx
        {!task.completed && !task.isAnchored && (
          <Popover open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
```

And change the reschedule `Calendar` selected prop:

```tsx
                  selected={parseDueDate(task.dueDate)}
```
to:
```tsx
                  selected={task.dueDate ? parseDueDate(task.dueDate) : undefined}
```

- [ ] **Step 7: Guard `handleOpenEdit` in the Quest Log page**

In `artifacts/focusquest/src/pages/tasks.tsx`, change:

```tsx
    setEditDueDate(parseDueDate(task.dueDate));
```
to:
```tsx
    setEditDueDate(task.dueDate ? parseDueDate(task.dueDate) : undefined);
```

- [ ] **Step 8: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react artifacts/focusquest/src/components/task-item.tsx artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(api,ui): expose isAnchored + nullable dueDate; anchored-aware task card"
```

---

### Task 6: Task card anchor toggle

**Files:**
- Modify: `artifacts/focusquest/src/components/task-item.tsx` (handler after `handleReschedule` `:215`, toggle button in actions cluster near `:356`)

**Interfaces:**
- Consumes: `useUpdateTask` (already imported), `todayDueDate` from `@/lib/reschedule`, `Anchor` icon (imported in Task 5).

- [ ] **Step 1: Import the local-today helper**

In `artifacts/focusquest/src/components/task-item.tsx`, add `todayDueDate` to the existing import from `@/lib/reschedule`:

```tsx
import { parseDueDate, toDueDateString, todayDueDate, tomorrowDueDate, nextWeekDueDate } from "@/lib/reschedule";
```

(`todayDueDate` may already be present — confirm it is in the list.)

- [ ] **Step 2: Add the toggle handler**

Immediately after the `handleReschedule` function, add:

```tsx
  const handleToggleAnchor = () => {
    if (updateMutation.isPending) return;
    const nextAnchored = !task.isAnchored;
    updateMutation.mutate({
      id: task.id,
      // Un-anchoring restores a date; send local today so it lands on the user's day.
      data: nextAnchored ? { isAnchored: true } : { isAnchored: false, dueDate: todayDueDate() },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        toast({
          title: nextAnchored ? "Quest anchored — no deadline" : "Anchor removed",
          className: nextAnchored ? "border-primary" : "",
        });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? err?.message ?? "Could not update anchor";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };
```

- [ ] **Step 3: Add the anchor toggle button to the actions cluster**

In the actions cluster, immediately before the existing Focus-pin `Button` (`aria-label={isPinned ? "Unpin from Today's Focus" ...}`), add:

```tsx
        {!task.completed && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={task.isAnchored ? "Remove anchor" : "Anchor (no deadline)"}
            title={task.isAnchored ? "Remove anchor" : "Anchor — no deadline, keep until done"}
            className={`h-9 w-9 cursor-pointer ${task.isAnchored ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
            onClick={handleToggleAnchor}
            disabled={updateMutation.isPending}
          >
            <Anchor className="w-4 h-4" />
          </Button>
        )}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Preview the toggle**

Start the dev server (via the project's dev command) and open the Quest Log. On an incomplete dated quest, click the anchor button → toast "Quest anchored — no deadline", the card shows the anchor icon + "No deadline", and the reschedule button disappears. Click again → "Anchor removed", a date returns.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/components/task-item.tsx
git commit -m "feat(ui): anchor toggle on the quest card"
```

---

### Task 7: New/Edit dialog anchor checkboxes

**Files:**
- Modify: `artifacts/focusquest/src/pages/tasks.tsx` — import `Checkbox`, create state + `handleCreateTask` (`:268-294`) + create form, edit state + `handleOpenEdit` (`:327-335`) + `handleSaveEdit` (`:337-364`) + edit form, `handleCloseCreate` (`:296-305`)

**Interfaces:**
- Consumes: `Checkbox` from `@/components/ui/checkbox`; `useCreateTask`/`useUpdateTask` accepting `isAnchored` (Task 5).

- [ ] **Step 1: Import the Checkbox**

In `artifacts/focusquest/src/pages/tasks.tsx`, add:

```tsx
import { Checkbox } from "@/components/ui/checkbox";
```

- [ ] **Step 2: Add anchored state for both dialogs**

After `const [newTaskCategory, setNewTaskCategory] = useState("");` add:

```tsx
  const [newTaskAnchored, setNewTaskAnchored] = useState(false);
```

After `const [editDueDate, setEditDueDate] = useState<Date | undefined>(undefined);` add:

```tsx
  const [editAnchored, setEditAnchored] = useState(false);
```

- [ ] **Step 3: Send `isAnchored` from create (and relax the date guard)**

Replace the top of `handleCreateTask`:

```tsx
    e.preventDefault();
    if (!newTaskTitle.trim() || !date) return;

    const estimatedMinutes = newTaskEstimate ? parseInt(newTaskEstimate, 10) : undefined;

    createMutation.mutate({
      data: {
        title: newTaskTitle,
        description: newTaskDesc,
        priority: newTaskPriority as any,
        dueDate: format(date, 'yyyy-MM-dd'),
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
        ...(newTaskCategory ? { category: newTaskCategory as any } : {}),
      }
    }, {
```

with:

```tsx
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    if (!newTaskAnchored && !date) return;

    const estimatedMinutes = newTaskEstimate ? parseInt(newTaskEstimate, 10) : undefined;

    createMutation.mutate({
      data: {
        title: newTaskTitle,
        description: newTaskDesc,
        priority: newTaskPriority as any,
        ...(newTaskAnchored
          ? { isAnchored: true }
          : { dueDate: format(date!, 'yyyy-MM-dd') }),
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
        ...(newTaskCategory ? { category: newTaskCategory as any } : {}),
      }
    }, {
```

- [ ] **Step 4: Reset anchored state on create-dialog close**

In `handleCloseCreate`, after `setNewTaskCategory("");` add:

```tsx
    setNewTaskAnchored(false);
```

- [ ] **Step 5: Add the anchor checkbox to the New Quest form**

In the create `form`, immediately after the closing `</div>` of the "Details (Optional)" Textarea block, add:

```tsx
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={newTaskAnchored}
                onCheckedChange={(v) => setNewTaskAnchored(v === true)}
              />
              <span className="text-sm text-foreground">Anchor — no deadline, keep until done</span>
            </label>
```

- [ ] **Step 6: Initialize `editAnchored` when opening the edit dialog**

In `handleOpenEdit`, after `setEditDueDate(...)`, add:

```tsx
    setEditAnchored(task.isAnchored ?? false);
```

- [ ] **Step 7: Send `isAnchored` from edit**

Replace the `updateMutation.mutate` data in `handleSaveEdit`:

```tsx
      data: {
        title: editTitle,
        description: editDesc,
        priority: editPriority as any,
        ...(editDueDate ? { dueDate: toDueDateString(editDueDate) } : {}),
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
        category: editCategory as any,
      }
```

with:

```tsx
      data: {
        title: editTitle,
        description: editDesc,
        priority: editPriority as any,
        isAnchored: editAnchored,
        ...(editAnchored
          ? {}
          : (editDueDate ? { dueDate: toDueDateString(editDueDate) } : {})),
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
        category: editCategory as any,
      }
```

- [ ] **Step 8: Add the anchor checkbox to the Edit form and hide the date picker when anchored**

In the edit `form`, wrap the existing "Due date" `<div>` block so it only renders when not anchored — change its opening `<div>`:

```tsx
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Due date</label>
```
to:
```tsx
            {!editAnchored && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Due date</label>
```
and add a matching `)}` after that block's closing `</div>` (the one that closes the Due-date Popover wrapper). Then, immediately after it, add the checkbox:

```tsx
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={editAnchored}
                onCheckedChange={(v) => setEditAnchored(v === true)}
              />
              <span className="text-sm text-foreground">Anchor — no deadline, keep until done</span>
            </label>
```

- [ ] **Step 9: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Preview the dialogs**

In the New Quest dialog, check "Anchor" and submit with no date selected → quest is created with an anchor badge + "No deadline". Open Edit on a dated quest, check "Anchor" (date picker hides), save → it becomes anchored. Uncheck and save → a date returns.

- [ ] **Step 11: Commit**

```bash
git add artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(ui): anchor checkbox in New/Edit quest dialogs"
```

---

### Task 8: Full verification & wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Run all gates**

```bash
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/focusquest test
pnpm typecheck
```
Expected: all PASS.

- [ ] **Step 2: End-to-end preview walkthrough**

With the dev server running (api-server + focusquest), verify the spec's acceptance scenarios:

1. **Create anchored (dialog):** New Quest → check Anchor → submit with no date → appears with anchor icon + "No deadline".
2. **Cross-date visibility:** move the Quest Log date picker to another day → the anchored quest still appears.
3. **Card toggle:** anchor an existing dated quest → date clears, badge appears; un-anchor → today's date returns.
4. **Grace period:** with an anchored quest created *today*, complete all of today's dated quests → daily-bonus toast **fires** (today's anchored task does not gate).
5. **Bonus block:** with an anchored quest whose `created_at` is before today (e.g. created yesterday, or adjust to test), complete all today's dated quests → **no** daily-bonus toast; then complete the anchored quest → daily-bonus toast fires.
6. **Category filter:** filtering to a category hides anchored quests of other categories (expected).

Capture a screenshot of an anchored quest in the Quest Log as proof.

- [ ] **Step 3: Confirm known limitations are acceptable (no code change)**

- Completed anchored quests do not appear in the calendar heatmap or the dashboard "today" count (both key off `dueDate`); this matches the spec's deferred scope.
- Anchored quests are absent from date-based push reminders.

- [ ] **Step 4: Finalize**

Confirm the branch is `feat/anchored-tasks` and all task commits are present:

```bash
git log --oneline feat/anchored-tasks -8
```

The feature is ready for a PR (creating the PR is a separate, user-initiated step).

## Self-Review

**Spec coverage:**
- Nullable `due_date` + `is_anchored` → Task 1. ✓
- Pure gating/grace/completion logic → Task 2. ✓
- `GET /tasks` union + ordering → Task 3 (steps 3). ✓
- `POST /tasks` accept `isAnchored` + relaxed validation + forced null date → Task 3 (step 4). ✓
- `PATCH /tasks/:id` toggle (anchor nulls date, un-anchor → today) → Task 3 (step 5). ✓
- Daily-bonus grace gate → Task 4 (step 3). ✓
- Uncomplete "counts as today" fix → Task 4 (step 4). ✓
- Recommend null-safety → Task 4 (step 2). ✓
- OpenAPI (`Task.isAnchored`, nullable `dueDate`, create/update `isAnchored`) + codegen → Task 5. ✓
- Card anchor toggle + badge + "No deadline" + hide reschedule → Tasks 5 (display) + 6 (toggle). ✓
- New/Edit dialog checkboxes → Task 7. ✓
- Tests (pure) + preview verification → Tasks 2, 8. ✓
- Known limitations (heatmap, dashboard today, reminders) → Task 8 (step 3). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output.

**Type consistency:** Helper names (`utcDateString`, `anchoredTaskGatesBonus`, `isBonusGatingTask`, `countsAsTodayCompletion`) are identical across Tasks 2 and 4. `isAnchored` (camelCase field / body key) and `is_anchored` (DB column) are used consistently. `todayDueDate()` (Task 6) matches the existing `reschedule.ts` export.
