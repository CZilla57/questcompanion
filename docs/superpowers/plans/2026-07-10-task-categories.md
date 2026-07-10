# Task Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted `category` column to tasks and recurring tasks, let users pick from 9 fixed categories (with auto-suggest from title keywords as the default), display category badges on task cards, and enable filtering tasks by category.

**Architecture:** Add `category text NOT NULL DEFAULT 'default'` to `tasks` and `recurring_tasks` tables. The server sets category from the client-provided value or falls back to the existing `assignPoints()` auto-detection. The frontend shows a category dropdown in create/edit dialogs (pre-filled by auto-suggest, overridable by the user) and a category filter in the task list. Insights reads the stored column directly instead of re-deriving.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express, OpenAPI + orval codegen, React + TanStack Query, shadcn/ui components

## Global Constraints

- Categories are a fixed set of 9 slugs: `health`, `deep_work`, `learning`, `finance`, `admin`, `household`, `social`, `creative`, `default`
- No custom user-defined categories
- `drizzle-kit push` is used for schema changes (no migration files — schema is pushed directly)
- Codegen command: `pnpm --filter @workspace/api-spec codegen`
- All category validation uses the same `VALID_CATEGORIES` set exported from `auto-points.ts`

---

### Task 1: Database schema + auto-points exports

**Files:**
- Modify: `lib/db/src/schema/tasks.ts:6-43` — add `category` column
- Modify: `lib/db/src/schema/recurring-tasks.ts:4-16` — add `category` column
- Modify: `artifacts/api-server/src/lib/auto-points.ts:225-271` — export `VALID_CATEGORIES` set and `CATEGORY_LABELS`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `tasksTable` gains `category: text("category").notNull().default("default")` column
  - `recurringTasksTable` gains `category: text("category").notNull().default("default")` column
  - `export const VALID_CATEGORIES: Set<string>` (the 9 slugs)
  - `export const CATEGORY_LABELS: Record<string, string>` (already exists, just needs the `export` keyword)

- [ ] **Step 1: Add `category` column to `tasksTable`**

In `lib/db/src/schema/tasks.ts`, add this column after the `priority` column (line 36):

```typescript
  category: text("category").notNull().default("default"),
```

- [ ] **Step 2: Add `category` column to `recurringTasksTable`**

In `lib/db/src/schema/recurring-tasks.ts`, add this column after the `priority` column (line 9):

```typescript
  category: text("category").notNull().default("default"),
```

- [ ] **Step 3: Export `VALID_CATEGORIES` and `CATEGORY_LABELS` from auto-points**

In `artifacts/api-server/src/lib/auto-points.ts`:

The `CATEGORY_LABELS` constant on line 231 is currently not exported. Change:

```typescript
const CATEGORY_LABELS: Record<string, string> = {
```

to:

```typescript
export const CATEGORY_LABELS: Record<string, string> = {
```

Then add this below `CATEGORY_LABELS` (after line 241):

```typescript
export const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));
```

- [ ] **Step 4: Push schema to database**

Run:
```bash
pnpm --filter @workspace/db push
```

Expected: Drizzle pushes the two new columns. Existing rows get `'default'` as the value.

- [ ] **Step 5: Backfill existing rows**

Run a one-time backfill script. Create and execute via `tsx`:

```bash
cd lib/db && npx tsx -e "
const { db, tasksTable, recurringTasksTable } = require('./src/index.ts');
const { assignPoints } = require('../../artifacts/api-server/src/lib/auto-points.ts');
const { eq } = require('drizzle-orm');

async function backfill() {
  const tasks = await db.select().from(tasksTable);
  for (const t of tasks) {
    const cat = assignPoints(t.title, t.priority).category;
    if (cat !== 'default') {
      await db.update(tasksTable).set({ category: cat }).where(eq(tasksTable.id, t.id));
    }
  }
  const recurring = await db.select().from(recurringTasksTable);
  for (const r of recurring) {
    const cat = assignPoints(r.title, r.priority).category;
    if (cat !== 'default') {
      await db.update(recurringTasksTable).set({ category: cat }).where(eq(recurringTasksTable.id, r.id));
    }
  }
  console.log('Backfill complete:', tasks.length, 'tasks,', recurring.length, 'recurring');
  process.exit(0);
}
backfill();
"
```

Note: If the import syntax doesn't work with `tsx -e`, write it to a temporary file `lib/db/backfill-categories.ts` instead, run it with `npx tsx lib/db/backfill-categories.ts`, then delete the file. Make sure `DATABASE_URL` is set in the environment.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/tasks.ts lib/db/src/schema/recurring-tasks.ts artifacts/api-server/src/lib/auto-points.ts
git commit -m "feat: add category column to tasks and recurring_tasks"
```

---

### Task 2: API routes — accept, store, return, and filter by category

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` — `formatTask()`, `POST /tasks`, `PATCH /tasks/:id`, `GET /tasks`
- Modify: `artifacts/api-server/src/routes/recurring-tasks.ts` — `formatRecurring()`, `POST`, `PATCH`, `spawnRecurringTasksForToday()`
- Modify: `artifacts/api-server/src/routes/users.ts:188-203` — insights category breakdown

**Interfaces:**
- Consumes: `VALID_CATEGORIES`, `CATEGORY_LABELS` from `auto-points.ts`; `category` column on `tasksTable` and `recurringTasksTable`
- Produces:
  - `formatTask()` returns `{ ...existing, category: string, categoryLabel: string }`
  - `GET /tasks` accepts `?category=<slug>` query param
  - `POST /tasks` accepts `{ ...existing, category?: string }` body
  - `PATCH /tasks/:id` accepts `{ ...existing, category?: string }` body
  - Recurring task endpoints mirror the same pattern

- [ ] **Step 1: Update `formatTask()` in `routes/tasks.ts`**

Add the import at the top of `artifacts/api-server/src/routes/tasks.ts`:

```typescript
import { CATEGORY_LABELS } from "../lib/auto-points";
```

Then update `formatTask` (lines 16-33) to include category fields:

```typescript
function formatTask(task: typeof tasksTable.$inferSelect) {
  return {
    id: task.id,
    userId: task.userId,
    title: task.title,
    description: task.description,
    points: task.points,
    completed: task.completed,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    dueDate: task.dueDate,
    priority: task.priority,
    category: task.category,
    categoryLabel: CATEGORY_LABELS[task.category] ?? CATEGORY_LABELS.default,
    createdAt: task.createdAt.toISOString(),
    estimatedMinutes: task.estimatedMinutes ?? null,
    actualMinutes: task.actualMinutes ?? null,
    isDailyFocus: task.isDailyFocus,
    focusDate: task.focusDate ?? null,
  };
}
```

- [ ] **Step 2: Update `POST /tasks` to accept category**

In `artifacts/api-server/src/routes/tasks.ts`, update the existing `assignPoints` import to also import `VALID_CATEGORIES`:

```typescript
import { assignPoints, CATEGORY_LABELS, VALID_CATEGORIES } from "../lib/auto-points";
```

(Remove the separate `CATEGORY_LABELS` import added in step 1; consolidate into one line.)

In the `POST /tasks` handler (around line 190), update the destructuring to include `category`:

```typescript
  const { title, description, dueDate, priority = "medium", estimatedMinutes, category } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    priority?: string;
    estimatedMinutes?: number;
    category?: string;
  };
```

Then update the insert to use the provided category or fall back to auto-detect. Replace the existing insert block (lines 207-219):

```typescript
  const autoPoint = assignPoints(title, priority);
  const resolvedCategory = category && VALID_CATEGORIES.has(category) ? category : autoPoint.category;

  const [task] = await db.insert(tasksTable).values({
    userId,
    title,
    description,
    points: autoPoint.points,
    dueDate,
    priority,
    category: resolvedCategory,
    estimatedMinutes: estimatedMinutes ?? null,
  }).returning();

  res.status(201).json(formatTask(task));
```

- [ ] **Step 3: Update `PATCH /tasks/:id` to accept category**

In the PATCH handler (around line 251), add `category` to the destructuring:

```typescript
  const { title, description, dueDate, priority, estimatedMinutes, actualMinutes, category } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    priority?: string;
    estimatedMinutes?: number;
    actualMinutes?: number;
    category?: string;
  };
```

In the "Incomplete task: allow full edit" block (around line 278), add:

```typescript
  if (category != null && VALID_CATEGORIES.has(category)) updates.category = category;
```

- [ ] **Step 4: Update `GET /tasks` to filter by category**

In the GET handler (around line 169), add `category` to the destructured query params:

```typescript
  const { date, completed, category } = req.query;
```

Add a condition after the existing conditions array (around line 179):

```typescript
  if (category && typeof category === "string" && VALID_CATEGORIES.has(category)) {
    conditions.push(eq(tasksTable.category, category));
  }
```

- [ ] **Step 5: Update `formatRecurring()` in `routes/recurring-tasks.ts`**

In `artifacts/api-server/src/routes/recurring-tasks.ts`, add the import:

```typescript
import { assignPoints, CATEGORY_LABELS, VALID_CATEGORIES } from "../lib/auto-points";
```

Update `formatRecurring` (lines 16-38) to read category from the stored column:

```typescript
async function formatRecurring(r: typeof recurringTasksTable.$inferSelect) {
  const days = parseDays(r.daysOfWeek);
  const ap = assignPoints(r.title, r.priority);
  const streak = await getHabitStreak(r.userId, r.id);
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
    estimatedPoints: ap.points,
    currentStreak: streak?.currentStreak ?? EMPTY_STREAK.currentStreak,
    longestStreak: streak?.longestStreak ?? EMPTY_STREAK.longestStreak,
    totalCompletions: streak?.totalCompletions ?? EMPTY_STREAK.totalCompletions,
    lastCompletedDate: streak?.lastCompletedDate ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
```

- [ ] **Step 6: Update `POST /recurring-tasks` to accept category**

In the POST handler, add `category` to the destructured body. Then when inserting, resolve category:

```typescript
  const autoPoint = assignPoints(title, priority);
  const resolvedCategory = category && VALID_CATEGORIES.has(category) ? category : autoPoint.category;
```

Add `category: resolvedCategory` to the `.values({...})` call in the insert.

- [ ] **Step 7: Update `PATCH /recurring-tasks/:id` to accept category**

Add `category` to the destructured body. In the updates object, add:

```typescript
  if (category != null && VALID_CATEGORIES.has(category)) updates.category = category;
```

- [ ] **Step 8: Update `spawnRecurringTasksForToday()` to carry category through**

In the `spawnRecurringTasksForToday` function (around line 235), add `category: tmpl.category` to the `db.insert(tasksTable).values({...})` call:

```typescript
    const [inserted] = await db.insert(tasksTable).values({
      userId: tmpl.userId,
      recurringTaskId: tmpl.id,
      title: tmpl.title,
      description: tmpl.description,
      points: ap.points,
      dueDate: todayStr,
      priority: tmpl.priority,
      category: tmpl.category,
    }).onConflictDoNothing().returning({ id: tasksTable.id });
```

- [ ] **Step 9: Update insights endpoint to read category from column**

In `artifacts/api-server/src/routes/users.ts`, the category breakdown loop (lines 191-203) currently calls `assignPoints()` to derive category. Replace:

```typescript
  for (const task of allTasks) {
    const ap = assignPoints(task.title, task.priority);
    const key = ap.category;
    if (!catMap.has(key)) {
      catMap.set(key, { category: key, label: ap.categoryLabel, completed: 0, total: 0, xpEarned: 0 });
    }
    const stat = catMap.get(key)!;
    stat.total++;
    if (task.completed) {
      stat.completed++;
      stat.xpEarned += task.pointsAwarded ?? ap.points;
    }
  }
```

with:

```typescript
  for (const task of allTasks) {
    const key = task.category;
    if (!catMap.has(key)) {
      catMap.set(key, { category: key, label: CATEGORY_LABELS[key] ?? CATEGORY_LABELS.default, completed: 0, total: 0, xpEarned: 0 });
    }
    const stat = catMap.get(key)!;
    stat.total++;
    if (task.completed) {
      stat.completed++;
      stat.xpEarned += task.pointsAwarded ?? task.points;
    }
  }
```

Add the import at the top:

```typescript
import { CATEGORY_LABELS } from "../lib/auto-points";
```

Remove `assignPoints` from the import if it was only used here (check if other code in users.ts still uses it).

- [ ] **Step 10: Verify the server compiles**

Run:
```bash
pnpm --filter api-server exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 11: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts artifacts/api-server/src/routes/recurring-tasks.ts artifacts/api-server/src/routes/users.ts
git commit -m "feat: accept, store, return, and filter tasks by category"
```

---

### Task 3: OpenAPI spec + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` — `Task`, `TaskInput`, `TaskUpdate`, `RecurringTask`, `RecurringTaskInput`, `RecurringTaskUpdate` schemas; `GET /tasks` parameters
- Regenerate: `lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/`

**Interfaces:**
- Consumes: updated API behavior from Task 2
- Produces: updated TypeScript types and React Query hooks with `category`/`categoryLabel` fields

- [ ] **Step 1: Add `category` and `categoryLabel` to `Task` schema**

In `lib/api-spec/openapi.yaml`, in the `Task` schema (around line 1115), add `category` to the `required` array:

```yaml
      required: [id, userId, title, points, completed, dueDate, priority, createdAt, category, categoryLabel]
```

Add these properties after `priority` (after line 1137):

```yaml
        category:
          type: string
          enum: [health, deep_work, learning, finance, admin, household, social, creative, default]
        categoryLabel:
          type: string
```

- [ ] **Step 2: Add `category` to `TaskInput` schema**

In the `TaskInput` schema (around line 1160), add after `estimatedMinutes`:

```yaml
        category:
          type: string
          enum: [health, deep_work, learning, finance, admin, household, social, creative, default]
          description: Optional category override. Auto-detected from title if omitted.
```

- [ ] **Step 3: Add `category` to `TaskUpdate` schema**

In the `TaskUpdate` schema (around line 1186), add after `actualMinutes`:

```yaml
        category:
          type: string
          enum: [health, deep_work, learning, finance, admin, household, social, creative, default]
```

- [ ] **Step 4: Add `category` query param to `GET /tasks`**

In the `GET /tasks` path (around line 281), add to the `parameters` array after the `completed` param:

```yaml
        - name: category
          in: query
          schema:
            type: string
            enum: [health, deep_work, learning, finance, admin, household, social, creative, default]
          description: Filter by category
```

- [ ] **Step 5: Add `category` to `RecurringTask` response schema**

In the `RecurringTask` schema (around line 1296), add `category` to the `required` array:

```yaml
      required: [id, userId, title, priority, daysOfWeek, timeOfDay, startDate, isActive, createdAt, currentStreak, longestStreak, totalCompletions, category, categoryLabel]
```

Add this property before the existing `categoryLabel` (around line 1327):

```yaml
        category:
          type: string
          enum: [health, deep_work, learning, finance, admin, household, social, creative, default]
```

(The existing `categoryLabel` property stays as-is.)

- [ ] **Step 6: Add `category` to `RecurringTaskInput` schema**

In `RecurringTaskInput` (around line 1340), add after `endDate`:

```yaml
        category:
          type: string
          enum: [health, deep_work, learning, finance, admin, household, social, creative, default]
          description: Optional category override. Auto-detected from title if omitted.
```

- [ ] **Step 7: Add `category` to `RecurringTaskUpdate` schema**

In `RecurringTaskUpdate` (around line 1365), add after `isActive`:

```yaml
        category:
          type: string
          enum: [health, deep_work, learning, finance, admin, household, social, creative, default]
```

- [ ] **Step 8: Run codegen**

```bash
pnpm --filter @workspace/api-spec codegen
```

Expected: orval regenerates `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`. The `Task` type now includes `category` and `categoryLabel`. `useGetTasks` accepts a `category` param. `useCreateTask` and `useUpdateTask` data types include optional `category`.

- [ ] **Step 9: Verify types compile**

```bash
pnpm -w run typecheck:libs
```

Expected: No errors. (This is already run as part of codegen, but verify.)

- [ ] **Step 10: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated/ lib/api-zod/src/generated/
git commit -m "feat: add category to OpenAPI spec and regenerate clients"
```

---

### Task 4: Frontend — shared constants, task card badge, create/edit/filter

**Files:**
- Create: `artifacts/focusquest/src/lib/categories.ts`
- Modify: `artifacts/focusquest/src/components/task-item.tsx:228-252` — add category badge
- Modify: `artifacts/focusquest/src/pages/tasks.tsx` — category select in create/edit dialogs, category filter, auto-suggest behavior
- Modify: `artifacts/focusquest/src/pages/insights.tsx:20-30` — import shared `CATEGORY_COLORS`

**Interfaces:**
- Consumes: updated `Task` type with `category`/`categoryLabel`, `useGetTasks` with `category` param, `useCreateTask`/`useUpdateTask` with `category` in data
- Produces: visible UI — category badges on task cards, category dropdown in create/edit, category filter in task list

- [ ] **Step 1: Create shared categories constants**

Create `artifacts/focusquest/src/lib/categories.ts`:

```typescript
export const CATEGORIES = [
  { slug: "health",    label: "Health" },
  { slug: "deep_work", label: "Deep Work" },
  { slug: "learning",  label: "Learning" },
  { slug: "finance",   label: "Finance" },
  { slug: "admin",     label: "Admin" },
  { slug: "household", label: "Household" },
  { slug: "social",    label: "Social" },
  { slug: "creative",  label: "Creative" },
  { slug: "default",   label: "General" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

export const CATEGORY_COLORS: Record<string, string> = {
  health:    "text-green-400  bg-green-400/10  border-green-400/30",
  deep_work: "text-blue-400   bg-blue-400/10   border-blue-400/30",
  learning:  "text-purple-400 bg-purple-400/10 border-purple-400/30",
  finance:   "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  admin:     "text-orange-400 bg-orange-400/10 border-orange-400/30",
  household: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  social:    "text-pink-400   bg-pink-400/10   border-pink-400/30",
  creative:  "text-fuchsia-400 bg-fuchsia-400/10 border-fuchsia-400/30",
  default:   "text-muted-foreground bg-muted/20 border-border",
};

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.label]),
);
```

- [ ] **Step 2: Add category badge to task-item.tsx**

In `artifacts/focusquest/src/components/task-item.tsx`, add the import:

```typescript
import { CATEGORY_COLORS, CATEGORY_LABEL } from "@/lib/categories";
```

In the metadata row (around line 228, inside the `<div className="flex items-center gap-3 mt-2 flex-wrap">` block), add a category badge after the priority badge (after the `</span>` on line 252):

```tsx
          {task.category && task.category !== "default" && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${CATEGORY_COLORS[task.category] ?? CATEGORY_COLORS.default}`}>
              {CATEGORY_LABEL[task.category] ?? "General"}
            </span>
          )}
```

- [ ] **Step 3: Update tasks.tsx — replace local CATEGORY_COLORS with shared import**

In `artifacts/focusquest/src/pages/tasks.tsx`, replace the local `CATEGORY_COLORS` constant (lines 30-40) with:

```typescript
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABEL } from "@/lib/categories";
```

Remove the local `CATEGORY_COLORS` object entirely. Update any references to use the imported version (the `RecommendCard` component uses `CATEGORY_COLORS` — it will now use the import).

- [ ] **Step 4: Add category state and auto-suggest behavior to create dialog**

In the state declarations (around line 205-206), add:

```typescript
  const [newTaskCategory, setNewTaskCategory] = useState("");
  const [categoryManuallySet, setCategoryManuallySet] = useState(false);
```

Update the auto-suggest effect: when `pointPreview` changes and the user hasn't manually set a category, update the dropdown. Add this effect after the `usePointPreview` hook call:

```typescript
  useEffect(() => {
    if (pointPreview && !categoryManuallySet) {
      setNewTaskCategory(pointPreview.category);
    }
  }, [pointPreview, categoryManuallySet]);
```

Add the `useEffect` import if not already present (it is — line 1).

- [ ] **Step 5: Add category dropdown to create dialog form**

In the create dialog form (inside the `<form>` around line 450), add a category `<Select>` after the XP preview block (after the closing `</div>` of the XP preview around line 493) and before the "Details" field:

```tsx
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Category</label>
              <Select
                value={newTaskCategory || "default"}
                onValueChange={(val) => {
                  setNewTaskCategory(val);
                  setCategoryManuallySet(true);
                }}
              >
                <SelectTrigger className="border-primary/20">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[c.slug]?.split(" ")[0]}`} />
                        {c.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
```

- [ ] **Step 6: Send category in create mutation**

Update the `createMutation.mutate` call (around line 269) to include category:

```typescript
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

Update `handleCloseCreate` to reset category state:

```typescript
  const handleCloseCreate = () => {
    setIsCreateOpen(false);
    setNewTaskTitle("");
    setNewTaskDesc("");
    setNewTaskPriority(TaskPriority.medium);
    setNewTaskEstimate("");
    setNewTaskCategory("");
    setCategoryManuallySet(false);
  };
```

- [ ] **Step 7: Add category to edit dialog**

Add edit category state (near line 209):

```typescript
  const [editCategory, setEditCategory] = useState("");
```

Update `handleOpenEdit` to populate it:

```typescript
  const handleOpenEdit = (task: Task) => {
    setEditTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description ?? "");
    setEditPriority((task.priority as TaskPriority) ?? TaskPriority.medium);
    setEditEstimate(task.estimatedMinutes ? String(task.estimatedMinutes) : "");
    setEditCategory(task.category ?? "default");
  };
```

In the edit dialog form, add the same category `<Select>` after the Details field (before the priority/time grid):

```tsx
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Category</label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger className="border-primary/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[c.slug]?.split(" ")[0]}`} />
                        {c.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
```

Update `handleSaveEdit` to include category:

```typescript
    updateMutation.mutate({
      id: editTask.id,
      data: {
        title: editTitle,
        description: editDesc,
        priority: editPriority as any,
        ...(estimatedMinutes && estimatedMinutes > 0 ? { estimatedMinutes } : {}),
        category: editCategory as any,
      }
    }, {
```

- [ ] **Step 8: Add category filter to task list filter bar**

Add filter state (near the existing `filter` state on line 201):

```typescript
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
```

Update the `useGetTasks` call (around line 254) to pass the category param:

```typescript
  const { data: tasks, isLoading } = useGetTasks({
    date: date ? format(date, 'yyyy-MM-dd') : undefined,
    completed: filter === "completed" ? true : filter === "pending" ? false : undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
  });
```

In the filter bar (inside the `<div className="flex flex-col sm:flex-row gap-4 ...">` around line 364), add after the status filter `<Select>`:

```tsx
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
```

- [ ] **Step 9: Update insights.tsx to use shared CATEGORY_COLORS**

In `artifacts/focusquest/src/pages/insights.tsx`, replace the local `CATEGORY_COLORS` (lines 20-30) with:

```typescript
import { CATEGORY_COLORS } from "@/lib/categories";
```

Remove the local `CATEGORY_COLORS` constant.

- [ ] **Step 10: Commit**

```bash
git add artifacts/focusquest/src/lib/categories.ts artifacts/focusquest/src/components/task-item.tsx artifacts/focusquest/src/pages/tasks.tsx artifacts/focusquest/src/pages/insights.tsx
git commit -m "feat: category UI — dropdown in create/edit, badge on cards, filter in list"
```

---

### Task 5: Frontend — recurring tasks page category support

**Files:**
- Modify: `artifacts/focusquest/src/pages/recurring.tsx` — add category to form, display badge on cards

**Interfaces:**
- Consumes: updated `RecurringTask` type with `category`, shared `CATEGORIES`/`CATEGORY_COLORS` constants, `useCreateRecurringTask`/`useUpdateRecurringTask` with `category` in data
- Produces: category dropdown in recurring task create/edit forms, category badge on recurring task cards

- [ ] **Step 1: Add imports**

In `artifacts/focusquest/src/pages/recurring.tsx`, add:

```typescript
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABEL } from "@/lib/categories";
```

- [ ] **Step 2: Add category to `TaskFormState` and default form**

Update the `TaskFormState` interface (line 137):

```typescript
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
}
```

Update `getDefaultForm()` (line 148):

```typescript
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
  };
}
```

- [ ] **Step 3: Add category Select to `RecurringTaskForm`**

In the `RecurringTaskForm` component, add a category dropdown after the Priority `<Select>` (after the closing `</div>` around line 217):

```tsx
      <div>
        <label className="text-sm font-medium text-foreground mb-1 block">Category</label>
        <Select value={form.category || "default"} onValueChange={(v) => set("category", v)}>
          <SelectTrigger className="border-primary/20">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.slug} value={c.slug}>
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[c.slug]?.split(" ")[0]}`} />
                  {c.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
```

- [ ] **Step 4: Pass category in create and update mutations**

In `handleCreate` (around line 541), add `category` to the mutate data:

```typescript
      data: {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority as "low" | "medium" | "high",
        daysOfWeek: form.daysOfWeek,
        timeOfDay: form.timeOfDay,
        startDate: format(form.startDate, "yyyy-MM-dd"),
        endDate: form.hasEndDate && form.endDate ? format(form.endDate, "yyyy-MM-dd") : undefined,
        ...(form.category ? { category: form.category as any } : {}),
      },
```

In `handleSave` in `RecurringTaskCard` (around line 340), add `category` similarly:

```typescript
      data: {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority as "low" | "medium" | "high",
        daysOfWeek: form.daysOfWeek,
        timeOfDay: form.timeOfDay,
        startDate: format(form.startDate, "yyyy-MM-dd"),
        endDate: form.hasEndDate && form.endDate ? format(form.endDate, "yyyy-MM-dd") : null,
        ...(form.category ? { category: form.category as any } : {}),
      } as Parameters<typeof updateMutation.mutate>[0]["data"],
```

- [ ] **Step 5: Populate category when editing**

In `RecurringTaskCard`, update the `initial` object for editing (around line 357):

```typescript
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
    };
```

- [ ] **Step 6: Add category badge to `RecurringTaskCard` display**

In the card's info section (around line 424), the line currently shows `{task.estimatedPoints} XP · {task.categoryLabel}`. Replace it with a separate category badge:

```tsx
            <span className="flex items-center gap-1 text-primary font-bold">
              <Zap className="w-3 h-3" />
              {task.estimatedPoints} XP
            </span>
            {task.category && task.category !== "default" && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${CATEGORY_COLORS[task.category] ?? CATEGORY_COLORS.default}`}>
                {task.categoryLabel}
              </span>
            )}
```

- [ ] **Step 7: Verify the frontend compiles**

```bash
pnpm --filter focusquest exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add artifacts/focusquest/src/pages/recurring.tsx
git commit -m "feat: add category support to recurring tasks UI"
```

---

### Task 6: Manual verification

**Files:** None (read-only testing)

- [ ] **Step 1: Start the dev server and verify task creation**

Start the app. Create a new task with the title "Morning workout". Verify:
- The XP preview auto-suggests "Health" category
- The category dropdown shows "Health" pre-selected
- Change the category to "Creative" manually
- Type a different title — verify the dropdown stays on "Creative" (manual pick sticks)
- Submit the task — verify it appears with a "Creative" category badge

- [ ] **Step 2: Verify task editing**

Edit the task created above. Verify:
- The category dropdown shows "Creative" (the stored value)
- Change it to "Health" and save
- Verify the task card now shows a "Health" badge

- [ ] **Step 3: Verify category filtering**

Create tasks in different categories. Use the category filter dropdown. Verify:
- "All Categories" shows all tasks
- Selecting "Health" shows only health tasks
- Combining with the status filter works correctly

- [ ] **Step 4: Verify recurring tasks**

Create a recurring task. Verify:
- Category dropdown appears in the form
- Category badge shows on the recurring task card
- Edit the recurring task and change the category — verify it persists

- [ ] **Step 5: Verify insights page**

Open the Insights page. Verify the category breakdown chart still renders correctly with data from the stored `category` column.

- [ ] **Step 6: Commit any fixes**

If any issues were found and fixed during verification, commit those fixes.
