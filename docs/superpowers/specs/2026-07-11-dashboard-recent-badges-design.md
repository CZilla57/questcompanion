# Dashboard Recent Badges — Design Spec

## Overview

The Dashboard "Quest Activity" card (rendered by `ActivityHeatmap`) is a two-column row: the heatmap grid on the left and a `HeroSummary` in the right `aside` slot. On wide screens the hero only fills the left portion of that flex-1 column, leaving a large empty gap on the right — the card reads as empty.

Fill that gap with a **third section** showing the user's 3 most-recently-earned badges as compact, category-colored icon chips, with a graceful "no badges yet" nudge for new accounts. Final layout: `[Heatmap] | [Hero] | [Recent Badges]`, two dividers, stacking on mobile.

The badge data and its presentation styling already exist inline in `progress.tsx` (`useGetMyBadges()`, an `ICON_MAP`, and a `CATEGORY_STYLE` map). This work extracts that presentation into a shared module so both the Progress page and the new section use one source of truth.

## Data

Uses the existing `useGetMyBadges()` hook — no API or schema changes. Each item is:

```typescript
{
  badge: { id: string; name: string; icon: string; category: string; /* + description, requirement */ };
  earnedAt: string; // ISO timestamp — the field this feature sorts on
}
```

The feature reads only `badge.name`, `badge.icon`, `badge.category`, and `earnedAt`.

The hook fires its own react-query request, independent of the heatmap and hero queries.

## Shared badge module — `src/lib/badges.tsx`

Single source of truth for badge presentation, extracted from `progress.tsx`:

- **`BadgeIcon`** — component mapping an icon string (`"Flame"`, `"Trophy"`, `"Zap"`, …) to the corresponding lucide icon, accepting a `className` so callers choose the size. Falls back to `Award` for unknown strings. Icon set is the 14 icons currently in `progress.tsx`'s `ICON_MAP` (`CheckCircle`→`CheckCircle2`, `Zap`, `Trophy`, `Medal`, `Flame`, `Star`, `Crown`, `Calendar`, `Target`, `Rocket`, `TrendingUp`, `Shield`, `Users`, `Award`).
- **`BADGE_CATEGORY_STYLE`** — the per-category `{ label, color, bg, border }` map moved verbatim from `progress.tsx` (`tasks`, `points`, `streak`, `level`, `social`, `habit_streak`).
- **`DEFAULT_BADGE_CATEGORY_STYLE`** — the `tasks` style, used as the fallback for unrecognized categories.
- **`pickRecentBadges(badges, n)`** — pure helper: returns a new array of the `n` badges with the newest `earnedAt` first. Does not mutate the input; tolerates `undefined`/empty input (returns `[]`) and fewer-than-`n` items.

## Recent Badges component — `src/components/recent-badges.tsx`

Sibling to `HeroSummary`. Calls `useGetMyBadges()`, then renders one of three states inside a self-contained block (its own small "Recent Badges" section label).

### Populated
- Section label: "Recent Badges" (small, uppercase, muted — matching the visual language of the other card labels).
- A horizontal row of up to 3 category-colored icon chips, newest first, from `pickRecentBadges(data, 3)`. Each chip: a rounded circle using the badge category's `bg`/`border`, with `BadgeIcon` in the category `color` (chip ~11 units, icon ~5 units).
- Each chip carries a `title` and `aria-label` of `"<name> — <earned date>"` (date formatted like `MMM d`, e.g. "On Fire — Jul 8") so the name is discoverable on hover and to screen readers, keeping the visual compact (icons only).
- A `View all →` link (wouter `Link`) to `/progress`.

### Empty (no badges earned)
- A dimmed `Award` icon, "No badges yet", and "Complete quests to earn your first →" as a `Link` to `/tasks`. Keeps the third column present and gives new accounts a nudge rather than blank space.

### Loading
- Three pulsing circular chip placeholders (same footprint as the real chips) so the layout does not jump.

## Layout wiring

### `src/pages/dashboard.tsx`
Change the `aside` passed to `<ActivityHeatmap>` from a bare `<HeroSummary />` to a composite: a flex row containing `HeroSummary`, a vertical divider, and `RecentBadges`. Stacks vertically on mobile (`flex-col`), row on `sm`+. The hero must be constrained (not allowed to greedily consume the row via its internal `w-full`) so the badges column gets its share of the width.

### `ActivityHeatmap` — unchanged
Stays generic. Its existing `lg:border-l` divides `[Heatmap] | [aside]`; the divider added inside the composite between hero and badges creates the third visual section. Result: three columns, two dividers, matching the approved layout. The component renders `aside` identically in both its loading and loaded branches, so no change there is required.

### `src/pages/progress.tsx`
Delete the local `ICON_MAP` and `CATEGORY_STYLE`; import `BadgeIcon` and `BADGE_CATEGORY_STYLE` from `src/lib/badges.tsx`. Replace `ICON_MAP[ub.badge.icon] ?? <Award … />` usages with `<BadgeIcon icon={ub.badge.icon} className="w-8 h-8" />`. The habit-streak milestone preview block keeps its own inline icons and is left untouched. This is a behavior-preserving refactor — the Progress page renders identically.

## Files to create/modify

### New files
- `artifacts/focusquest/src/lib/badges.tsx` — `BadgeIcon`, `BADGE_CATEGORY_STYLE`, `DEFAULT_BADGE_CATEGORY_STYLE`, `pickRecentBadges`
- `artifacts/focusquest/src/lib/badges.test.ts` — unit tests for `pickRecentBadges`
- `artifacts/focusquest/src/components/recent-badges.tsx` — the Recent Badges section component

### Modified files
- `artifacts/focusquest/src/pages/dashboard.tsx` — pass the hero + badges composite as `aside`
- `artifacts/focusquest/src/pages/progress.tsx` — consume the shared badge module instead of local maps

## Testing

- **Unit test** `pickRecentBadges` (`src/lib/badges.test.ts`), matching the repo's pure-logic test convention (`src/lib/hero/*.test.ts`): sorts newest-first by `earnedAt`, caps at `n`, handles fewer-than-`n`, empty array, and `undefined` input; does not mutate the input.
- **Visual verification** via the preview dev server: `preview_screenshot` + `preview_inspect` at desktop and mobile widths, confirming the three-column layout with two dividers, correct per-category chip colors, hover tooltips, the `View all →` link, and the empty-state nudge.
- **`pnpm --filter focusquest typecheck`** and **`build`** pass.

## Non-goals

- No new API endpoint or database change — reuses `useGetMyBadges()`.
- No badge names printed next to the chips on the dashboard — icons only, names surface via tooltip (per the chosen compact style).
- No configurable count — fixed at the 3 most recent.
- No changes to how badges are earned, or to the Progress page's layout/behavior beyond the styling-map refactor.
- No redesign of `HeroSummary` or the heatmap itself.
