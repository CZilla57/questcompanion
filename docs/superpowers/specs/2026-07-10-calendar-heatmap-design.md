# Calendar Heatmap — Design Spec

## Overview

Add a GitHub-style completion heatmap to the Dashboard (`/`) showing the last ~90 days of quest activity. Colored by completion ratio, with a click-to-expand detail panel for any day.

## Placement

Between the XP Progress bar and the Streak Shield card on the Dashboard.

## API

### `GET /api/calendar/heatmap?days=90`

Returns aggregated completion data per day. Query groups tasks by `dueDate`, counts completions, and sums `pointsAwarded`. The `days` query param accepts an integer (default 90). The UI always sends 90; the param exists for potential future flexibility.

```typescript
{
  days: Array<{
    date: string;           // "yyyy-MM-dd"
    totalTasks: number;
    completedTasks: number;
    xpEarned: number;
  }>
}
```

No database schema changes required — all data derives from the existing `tasks` table.

### Detail panel data

Uses the existing `GET /api/tasks?date=YYYY-MM-DD` endpoint. No new API needed.

## Heatmap Component

### Grid layout

- 7 rows (Monday at top, Sunday at bottom) x ~13 columns (weeks)
- Reads left-to-right with today on the far right
- Each cell: 12x12px rounded square, 3px gap between cells
- Month labels (abbreviated: "Apr", "May", "Jun") above the grid at week boundaries
- Day labels (Mon, Wed, Fri) on the left side

### Color scale (completion ratio)

| Condition | Color | Description |
|-----------|-------|-------------|
| No tasks that day | `hsl(180, 10%, 12%)` | Neutral dark — not a miss, just empty |
| 0% completed (tasks exist, none done) | `hsl(0, 50%, 20%)` | Dim red hint |
| 1–49% completed | `hsl(180, 80%, 20%)` | Dim cyan |
| 50–99% completed | `hsl(180, 90%, 35%)` | Medium cyan |
| 100% completed | `hsl(180, 100%, 50%)` | Full neon cyan with subtle glow |

### Legend

A small strip below the grid: "Less" → 4 color swatches → "More"

### Card wrapper

Wrapped in a shadcn `Card` component with:
- Header: "Quest Activity"
- The heatmap grid
- The legend strip
- The detail panel (when a day is selected)

## Detail Panel

Appears below the heatmap grid inside the card when a day cell is clicked.

### Content

- **Date header:** Formatted date (e.g. "Wednesday, Jul 8") with completion ratio badge ("3/4 Quests")
- **XP earned** that day
- **Task list:** Compact list — title, completion status (checkmark or empty circle), XP awarded, category badge

### Interactions

- Click a cell → panel expands with that day's data (fetched via existing tasks endpoint)
- Click the same cell again → panel collapses
- Click a different cell → panel swaps to new day's data
- Only one day's panel open at a time
- While fetching task data, show a compact loading skeleton in the panel

### Animation

Smooth expand/collapse animation (framer-motion or CSS transition).

## Mobile

- The heatmap grid scrolls horizontally with today visible first (scroll starts at right edge)
- Detail panel appears below the heatmap with smooth expand animation
- Same interaction model as desktop

## Files to create/modify

### New files
- `artifacts/focusquest/src/components/activity-heatmap.tsx` — the heatmap component with grid, color logic, detail panel

### Modified files
- `artifacts/api-server/src/routes/` — new `calendar.ts` route file for the heatmap endpoint
- `artifacts/api-server/src/app.ts` — register the new calendar route
- `lib/api-spec/` — add the heatmap endpoint to the OpenAPI spec
- `lib/api-client-react/` — regenerate via Orval after spec update
- `artifacts/focusquest/src/pages/dashboard.tsx` — import and render `ActivityHeatmap` between XP bar and Streak Shield

## Non-goals

- No drag-to-select date ranges
- No task creation from the calendar
- No weekly/monthly view toggle — always the rolling 90-day strip
- No category filtering on the heatmap itself
