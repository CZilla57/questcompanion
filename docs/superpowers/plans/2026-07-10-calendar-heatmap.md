# Calendar Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rolling 90-day completion heatmap to the Dashboard that shows quest activity intensity, colored by completion ratio, with an expandable detail panel for each day.

**Architecture:** New `GET /api/calendar/heatmap` endpoint aggregates task completions by date using Drizzle. A new `ActivityHeatmap` React component renders a 7-row x ~13-column grid on the Dashboard between the XP progress bar and Streak Shield card. Clicking a day cell expands an inline panel that fetches that day's tasks via the existing `GET /api/tasks?date=...` endpoint.

**Tech Stack:** Express 5, Drizzle ORM (PostgreSQL), OpenAPI 3.1 + Orval codegen, React 19, TanStack React Query, Tailwind CSS v4, shadcn/ui, Lucide icons.

## Global Constraints

- No new database tables or schema changes — all data comes from the existing `tasks` table.
- Follow existing route patterns: auth guard via `req.isAuthenticated()` + `req.gameUserId`.
- OpenAPI spec uses YAML, OpenAPI 3.1.0 format, no `/api` prefix in paths.
- Codegen: `pnpm --filter @workspace/api-spec codegen` regenerates React Query hooks.
- The app uses forced dark mode with a neon cyan theme (`hsl(180, 100%, 50%)` primary).
- No test framework exists in this project — verify via dev server and browser.

---

### Task 1: API endpoint — OpenAPI spec + route + registration

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (insert before line 930 `components:`)
- Create: `artifacts/api-server/src/routes/calendar.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**
- Consumes: `tasksTable` from `@workspace/db` (columns: `userId`, `dueDate`, `completed`, `pointsAwarded`)
- Produces: `GET /api/calendar/heatmap?days=90` → `{ days: HeatmapDay[] }` where `HeatmapDay = { date: string, totalTasks: number, completedTasks: number, xpEarned: number }`; Orval generates `useGetCalendarHeatmap` hook and `HeatmapDay`/`HeatmapResponse` types.

- [ ] **Step 1: Add the OpenAPI spec endpoint and schemas**

Append this block to `lib/api-spec/openapi.yaml` directly before the `components:` line (line 930). Also add a `calendar` tag to the top-level `tags` array.

Add to the `tags` array (after the last existing tag entry, around line 25):

```yaml
  - name: calendar
    description: Calendar heatmap data
```

Add to the `paths` section (before line 930, after the last `/dopamine-rewards/{id}` block):

```yaml
  /calendar/heatmap:
    get:
      operationId: getCalendarHeatmap
      tags: [calendar]
      summary: Get completion heatmap data for the last N days
      parameters:
        - name: days
          in: query
          schema:
            type: integer
            default: 90
          description: Number of days to return (default 90)
      responses:
        "200":
          description: Heatmap data
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HeatmapResponse"
```

Add to `components/schemas` (at the end of the file, after `DopamineRewardInput`):

```yaml
    HeatmapDay:
      type: object
      required: [date, totalTasks, completedTasks, xpEarned]
      properties:
        date:
          type: string
          description: Date in YYYY-MM-DD format
        totalTasks:
          type: integer
        completedTasks:
          type: integer
        xpEarned:
          type: integer

    HeatmapResponse:
      type: object
      required: [days]
      properties:
        days:
          type: array
          items:
            $ref: "#/components/schemas/HeatmapDay"
```

- [ ] **Step 2: Run codegen**

```bash
pnpm --filter @workspace/api-spec codegen
```

Expected: Orval regenerates `lib/api-client-react/src/generated/api.ts` and `api.schemas.ts` with new `useGetCalendarHeatmap` hook, `HeatmapDay` type, and `HeatmapResponse` type. The `typecheck:libs` step should pass.

- [ ] **Step 3: Create the calendar route**

Create `artifacts/api-server/src/routes/calendar.ts`:

```typescript
import { Router, type IRouter } from "express";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import { format, subDays } from "date-fns";

const router: IRouter = Router();

router.get("/calendar/heatmap", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = req.gameUserId;
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 365);

  const startDate = format(subDays(new Date(), days - 1), "yyyy-MM-dd");

  const rows = await db
    .select({
      date: tasksTable.dueDate,
      totalTasks: count(),
      completedTasks: count(
        sql`CASE WHEN ${tasksTable.completed} = true THEN 1 END`
      ),
      xpEarned: sql<number>`COALESCE(SUM(CASE WHEN ${tasksTable.completed} = true THEN ${tasksTable.pointsAwarded} ELSE 0 END), 0)`,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), gte(tasksTable.dueDate, startDate)))
    .groupBy(tasksTable.dueDate)
    .orderBy(tasksTable.dueDate);

  res.json({
    days: rows.map((r) => ({
      date: r.date,
      totalTasks: Number(r.totalTasks),
      completedTasks: Number(r.completedTasks),
      xpEarned: Number(r.xpEarned),
    })),
  });
});

export default router;
```

- [ ] **Step 4: Register the route**

In `artifacts/api-server/src/routes/index.ts`, add the import and registration:

Add import after the existing imports (e.g., after line 14 `import cronRouter`):

```typescript
import calendarRouter from "./calendar";
```

Add registration after the last `router.use(...)` line (after `router.use(dopamineRewardsRouter)`):

```typescript
router.use(calendarRouter);
```

- [ ] **Step 5: Verify the endpoint**

Start the dev server and test the endpoint manually:

```bash
pnpm dev
```

Then in a separate terminal, curl or use the browser to verify:
- `GET /api/calendar/heatmap` returns `{ days: [...] }` (may be empty if no tasks exist in the last 90 days)
- `GET /api/calendar/heatmap?days=30` works with a custom range
- Without auth, returns 401

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated/ lib/api-zod/src/generated/ artifacts/api-server/src/routes/calendar.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: add calendar heatmap API endpoint"
```

---

### Task 2: ActivityHeatmap component — grid rendering

**Files:**
- Create: `artifacts/focusquest/src/components/activity-heatmap.tsx`

**Interfaces:**
- Consumes: `useGetCalendarHeatmap` hook from `@workspace/api-client-react` (returns `{ data: HeatmapResponse }`)
- Produces: `<ActivityHeatmap />` component (no props) — self-contained, fetches its own data

- [ ] **Step 1: Create the heatmap component with grid rendering**

Create `artifacts/focusquest/src/components/activity-heatmap.tsx`:

```tsx
import { useState, useRef, useEffect } from "react";
import {
  format,
  subDays,
  startOfWeek,
  addDays,
  getDay,
  isSameDay,
  parseISO,
} from "date-fns";
import {
  useGetCalendarHeatmap,
  useGetTasks,
  type HeatmapDay,
  type Task,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, Check, Circle, Flame } from "lucide-react";

const CELL_SIZE = 12;
const CELL_GAP = 3;
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const DAYS_TO_SHOW = 90;

function getColor(day: HeatmapDay | undefined): string {
  if (!day || day.totalTasks === 0) return "hsl(180, 10%, 12%)";
  const ratio = day.completedTasks / day.totalTasks;
  if (ratio === 0) return "hsl(0, 50%, 20%)";
  if (ratio < 0.5) return "hsl(180, 80%, 20%)";
  if (ratio < 1) return "hsl(180, 90%, 35%)";
  return "hsl(180, 100%, 50%)";
}

function getGlow(day: HeatmapDay | undefined): string {
  if (!day || day.totalTasks === 0) return "";
  const ratio = day.completedTasks / day.totalTasks;
  if (ratio === 1) return "drop-shadow-[0_0_4px_rgba(0,255,255,0.6)]";
  return "";
}

function buildGrid(): Date[] {
  const today = new Date();
  const end = today;
  const startRaw = subDays(end, DAYS_TO_SHOW - 1);
  const start = startOfWeek(startRaw, { weekStartsOn: 1 });

  const dates: Date[] = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

function groupByWeek(dates: Date[]): Date[][] {
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];

  for (const date of dates) {
    const dow = getDay(date);
    const mondayBased = dow === 0 ? 6 : dow - 1;
    if (mondayBased === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(date);
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);
  return weeks;
}

function getMonthLabels(
  weeks: Date[][]
): { label: string; colIndex: number }[] {
  const labels: { label: string; colIndex: number }[] = [];
  let lastMonth = -1;

  weeks.forEach((week, colIndex) => {
    const firstDay = week[0];
    const month = firstDay.getMonth();
    if (month !== lastMonth) {
      labels.push({ label: format(firstDay, "MMM"), colIndex });
      lastMonth = month;
    }
  });
  return labels;
}

function DetailPanelSkeleton() {
  return (
    <div className="animate-pulse space-y-3 pt-4 border-t border-border mt-4">
      <div className="flex items-center justify-between">
        <div className="h-4 w-40 bg-muted rounded" />
        <div className="h-5 w-20 bg-muted rounded-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 bg-muted/30 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function DetailPanel({
  date,
  heatmapDay,
}: {
  date: Date;
  heatmapDay: HeatmapDay | undefined;
}) {
  const dateStr = format(date, "yyyy-MM-dd");
  const { data: tasks, isLoading } = useGetTasks({ date: dateStr });

  if (isLoading) return <DetailPanelSkeleton />;

  const pending = tasks?.filter((t: Task) => !t.completed) ?? [];
  const completed = tasks?.filter((t: Task) => t.completed) ?? [];
  const total = (tasks ?? []).length;

  return (
    <div className="pt-4 border-t border-border mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-foreground">
          {format(date, "EEEE, MMM d")}
        </h3>
        <div className="flex items-center gap-3">
          {heatmapDay && heatmapDay.xpEarned > 0 && (
            <span className="text-xs font-bold text-primary flex items-center gap-1">
              <Flame className="w-3 h-3" />
              {heatmapDay.xpEarned} XP
            </span>
          )}
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
            {completed.length}/{total} Quests
          </span>
        </div>
      </div>

      {total === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No quests scheduled this day.
        </p>
      ) : (
        <div className="space-y-1.5">
          {[...completed, ...pending].map((task: Task) => (
            <div
              key={task.id}
              className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-muted/30 transition-colors"
            >
              {task.completed ? (
                <Check className="w-4 h-4 text-primary flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <span
                className={`text-sm truncate ${task.completed ? "line-through text-muted-foreground" : "text-foreground"}`}
              >
                {task.title}
              </span>
              {task.category && task.category !== "default" && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground flex-shrink-0">
                  {task.categoryLabel ?? task.category}
                </span>
              )}
              {task.completed && task.points != null && (
                <span className="text-xs text-primary font-semibold ml-auto flex-shrink-0">
                  +{task.points} XP
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityHeatmap() {
  const { data, isLoading } = useGetCalendarHeatmap({ days: DAYS_TO_SHOW });
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dates = buildGrid();
  const weeks = groupByWeek(dates);
  const monthLabels = getMonthLabels(weeks);
  const today = new Date();

  const dayMap = new Map<string, HeatmapDay>();
  if (data?.days) {
    for (const d of data.days) {
      dayMap.set(d.date, d);
    }
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [isLoading]);

  const handleCellClick = (date: Date) => {
    if (date > today) return;
    setSelectedDate((prev) =>
      prev && isSameDay(prev, date) ? null : date
    );
  };

  const selectedKey = selectedDate
    ? format(selectedDate, "yyyy-MM-dd")
    : null;

  const labelColWidth = 28;
  const gridWidth =
    weeks.length * (CELL_SIZE + CELL_GAP) - CELL_GAP;

  if (isLoading) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            Quest Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[120px] bg-muted/20 animate-pulse rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <CalendarDays className="w-4 h-4" />
          Quest Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="overflow-x-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
        >
          <div
            style={{
              minWidth: labelColWidth + gridWidth,
            }}
          >
            {/* Month labels */}
            <div
              className="flex text-[10px] text-muted-foreground mb-1"
              style={{ paddingLeft: labelColWidth }}
            >
              {weeks.map((week, wi) => {
                const monthLabel = monthLabels.find(
                  (m) => m.colIndex === wi
                );
                return (
                  <div
                    key={wi}
                    style={{
                      width: CELL_SIZE,
                      marginRight: CELL_GAP,
                    }}
                    className="flex-shrink-0 overflow-visible whitespace-nowrap"
                  >
                    {monthLabel?.label ?? ""}
                  </div>
                );
              })}
            </div>

            {/* Grid */}
            <div className="flex gap-0">
              {/* Day labels */}
              <div
                className="flex flex-col justify-between flex-shrink-0 pr-1"
                style={{
                  width: labelColWidth,
                  height: 7 * (CELL_SIZE + CELL_GAP) - CELL_GAP,
                }}
              >
                {DAY_LABELS.map((label, i) => (
                  <span
                    key={i}
                    className="text-[10px] text-muted-foreground leading-none"
                    style={{ height: CELL_SIZE }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              {/* Cells */}
              <div
                className="flex"
                style={{ gap: CELL_GAP }}
              >
                {weeks.map((week, wi) => (
                  <div
                    key={wi}
                    className="flex flex-col"
                    style={{ gap: CELL_GAP }}
                  >
                    {Array.from({ length: 7 }).map((_, dayIndex) => {
                      const date = week[dayIndex];
                      if (!date || date > today) {
                        return (
                          <div
                            key={dayIndex}
                            style={{
                              width: CELL_SIZE,
                              height: CELL_SIZE,
                            }}
                          />
                        );
                      }
                      const key = format(date, "yyyy-MM-dd");
                      const hDay = dayMap.get(key);
                      const isSelected = selectedKey === key;
                      return (
                        <button
                          key={dayIndex}
                          onClick={() => handleCellClick(date)}
                          aria-label={`${format(date, "MMM d")}: ${hDay ? `${hDay.completedTasks}/${hDay.totalTasks} quests` : "no quests"}`}
                          className={`rounded-sm transition-all duration-150 cursor-pointer ${getGlow(hDay)} ${isSelected ? "ring-1 ring-foreground" : "hover:ring-1 hover:ring-muted-foreground"}`}
                          style={{
                            width: CELL_SIZE,
                            height: CELL_SIZE,
                            backgroundColor: getColor(hDay),
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-3 text-[10px] text-muted-foreground">
          <span>Less</span>
          {[
            "hsl(180, 10%, 12%)",
            "hsl(180, 80%, 20%)",
            "hsl(180, 90%, 35%)",
            "hsl(180, 100%, 50%)",
          ].map((color, i) => (
            <div
              key={i}
              className="rounded-sm"
              style={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                backgroundColor: color,
              }}
            />
          ))}
          <span>More</span>
        </div>

        {/* Detail panel */}
        {selectedDate && (
          <DetailPanel
            date={selectedDate}
            heatmapDay={dayMap.get(selectedKey!)}
          />
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/focusquest/src/components/activity-heatmap.tsx
git commit -m "feat: add ActivityHeatmap component"
```

---

### Task 3: Integrate heatmap into the Dashboard

**Files:**
- Modify: `artifacts/focusquest/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes: `<ActivityHeatmap />` from `@/components/activity-heatmap`
- Produces: Heatmap visible on the Dashboard between the XP progress bar and Streak Shield

- [ ] **Step 1: Add the import**

At the top of `artifacts/focusquest/src/pages/dashboard.tsx`, add this import after the existing component imports (around line 4):

```typescript
import { ActivityHeatmap } from "@/components/activity-heatmap";
```

- [ ] **Step 2: Insert the heatmap between XP Progress bar and Decay Warning**

In the JSX return of `Dashboard`, insert `<ActivityHeatmap />` after the XP Progress bar `Card` (which ends around line 257 with `</Card>`) and before the XP Decay Warning section (the `{showDecayWarning && (` block around line 260):

```tsx
      {/* ── Quest Activity Heatmap ────────────────────────── */}
      <ActivityHeatmap />
```

- [ ] **Step 3: Verify in the browser**

Start the dev server if not already running. Open the Dashboard in the browser:

- The heatmap card should appear between the XP progress bar and the Streak Shield (or Decay Warning if visible)
- The grid should show colored cells for days with task data
- Clicking a cell should expand the detail panel showing that day's tasks
- Clicking the same cell again should collapse it
- On mobile viewport, the grid should scroll horizontally
- The legend strip "Less → More" should appear below the grid

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/pages/dashboard.tsx
git commit -m "feat: integrate activity heatmap into dashboard"
```
