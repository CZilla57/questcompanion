# Dashboard Recent Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the empty right side of the Dashboard "Quest Activity" card with a third section showing the user's 3 most-recently-earned badges as compact category-colored icon chips.

**Architecture:** Extract the badge icon/category styling that currently lives inline in `progress.tsx` into a shared `src/lib/badges.tsx` module (with a pure, unit-tested `pickRecentBadges` helper). Build a new `RecentBadges` component on top of it, and pass a `HeroSummary` + `RecentBadges` composite as the existing `aside` slot of `ActivityHeatmap` — which stays unchanged. The heatmap card's existing `lg:border-l` plus a divider inside the composite yields three columns: `[Heatmap] | [Hero] | [Recent Badges]`.

**Tech Stack:** React + TypeScript, Tailwind, wouter (`Link`), lucide-react icons, date-fns, TanStack Query (`useGetMyBadges` from `@workspace/api-client-react`), Vitest.

## Global Constraints

- Package name for pnpm filters: `@workspace/focusquest`. All commands run from the repo root as `pnpm --filter @workspace/focusquest <script>`.
- Icons-only on the dashboard — badge names surface via `title`/`aria-label` tooltip, never printed next to the chip.
- Fixed at the **3** most-recently-earned badges. No configurable count.
- **No API or database change** — reuse the existing `useGetMyBadges()` hook.
- The `progress.tsx` change is a **behavior-preserving refactor**: the Progress page must render identically after it.
- `ActivityHeatmap` itself must **not** be modified.
- Match existing code style: index-map lookups that may miss use `?? DEFAULT` (the codebase runs with `noUncheckedIndexedAccess`, per the `!` usage already in `progress.tsx`).
- Tests use Vitest (`import { describe, it, expect } from "vitest"`), environment `node`. Pure-logic tests only — no DOM/component-render tests (repo convention).

---

### Task 1: Shared badge module + `pickRecentBadges` unit tests

**Files:**
- Create: `artifacts/focusquest/src/lib/badges.tsx`
- Test: `artifacts/focusquest/src/lib/badges.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; only lucide-react + React types).
- Produces:
  - `BadgeIcon({ icon: string; className?: string }): JSX.Element` — renders the lucide icon for a badge icon string, falling back to `Award`.
  - `BADGE_CATEGORY_STYLE: Record<string, BadgeCategoryStyle>` where `BadgeCategoryStyle = { label: string; color: string; bg: string; border: string }`.
  - `DEFAULT_BADGE_CATEGORY_STYLE: BadgeCategoryStyle` (the `tasks` style).
  - `pickRecentBadges<T extends { earnedAt: string }>(badges: T[] | undefined, n: number): T[]` — the `n` newest by `earnedAt`, newest first, non-mutating.

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest/src/lib/badges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickRecentBadges } from "./badges";

const mk = (id: string, earnedAt: string) => ({ id, earnedAt });

describe("pickRecentBadges", () => {
  it("returns the n newest badges, newest first", () => {
    const badges = [
      mk("a", "2026-07-01T10:00:00.000Z"),
      mk("b", "2026-07-08T10:00:00.000Z"),
      mk("c", "2026-07-05T10:00:00.000Z"),
      mk("d", "2026-07-02T10:00:00.000Z"),
    ];
    expect(pickRecentBadges(badges, 3).map((b) => b.id)).toEqual(["b", "c", "d"]);
  });

  it("caps at n even when more are available", () => {
    const badges = [
      mk("a", "2026-07-01T10:00:00.000Z"),
      mk("b", "2026-07-02T10:00:00.000Z"),
      mk("c", "2026-07-03T10:00:00.000Z"),
    ];
    expect(pickRecentBadges(badges, 2)).toHaveLength(2);
  });

  it("returns all when fewer than n exist", () => {
    const badges = [mk("a", "2026-07-01T10:00:00.000Z")];
    expect(pickRecentBadges(badges, 3).map((b) => b.id)).toEqual(["a"]);
  });

  it("returns [] for empty or undefined input", () => {
    expect(pickRecentBadges([], 3)).toEqual([]);
    expect(pickRecentBadges(undefined, 3)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const badges = [
      mk("a", "2026-07-01T10:00:00.000Z"),
      mk("b", "2026-07-08T10:00:00.000Z"),
    ];
    const snapshot = badges.map((b) => b.id);
    pickRecentBadges(badges, 2);
    expect(badges.map((b) => b.id)).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/focusquest exec vitest run src/lib/badges.test.ts`
Expected: FAIL — cannot resolve `./badges` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `artifacts/focusquest/src/lib/badges.tsx`:

```tsx
import {
  Award, Calendar, CheckCircle2, Crown, Flame, Medal, Rocket,
  Shield, Star, Target, TrendingUp, Trophy, Users, Zap,
} from "lucide-react";
import type { ComponentType } from "react";

/** Maps a badge's stored `icon` string to its lucide component. */
const BADGE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  CheckCircle: CheckCircle2,
  Zap,
  Trophy,
  Medal,
  Flame,
  Star,
  Crown,
  Calendar,
  Target,
  Rocket,
  TrendingUp,
  Shield,
  Users,
  Award,
};

/** Renders the icon for a badge's `icon` string, falling back to `Award`. */
export function BadgeIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = BADGE_ICONS[icon] ?? Award;
  return <Icon className={className} />;
}

export interface BadgeCategoryStyle {
  label: string;
  color: string;
  bg: string;
  border: string;
}

export const BADGE_CATEGORY_STYLE: Record<string, BadgeCategoryStyle> = {
  tasks:        { label: "Task Mastery",  color: "text-primary",    bg: "bg-primary/10",    border: "border-primary/30" },
  points:       { label: "XP Milestones", color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30" },
  streak:       { label: "Daily Streaks", color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/30" },
  level:        { label: "Rank Ups",      color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/30" },
  social:       { label: "Social",        color: "text-green-400",  bg: "bg-green-400/10",  border: "border-green-400/30" },
  habit_streak: { label: "Habit Streaks", color: "text-amber-400",  bg: "bg-amber-400/10",  border: "border-amber-500/40" },
};

/** Fallback style for an unrecognized badge category. */
export const DEFAULT_BADGE_CATEGORY_STYLE: BadgeCategoryStyle = BADGE_CATEGORY_STYLE.tasks!;

/**
 * Returns the `n` badges with the newest `earnedAt` first.
 * Pure — does not mutate the input; tolerates undefined/empty input.
 */
export function pickRecentBadges<T extends { earnedAt: string }>(
  badges: T[] | undefined,
  n: number,
): T[] {
  if (!badges) return [];
  return [...badges]
    .sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime())
    .slice(0, n);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/focusquest exec vitest run src/lib/badges.test.ts`
Expected: PASS — 5 passing tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/lib/badges.tsx artifacts/focusquest/src/lib/badges.test.ts
git commit -m "feat(badges): shared badge icon/category module + pickRecentBadges"
```

---

### Task 2: Refactor `progress.tsx` onto the shared module

Behavior-preserving. Removes the duplicated `ICON_MAP` and `CATEGORY_STYLE` from `progress.tsx` and consumes `src/lib/badges.tsx`. Proves the shared module against the existing consumer before the new one is built.

**Files:**
- Modify: `artifacts/focusquest/src/pages/progress.tsx`

**Interfaces:**
- Consumes: `BadgeIcon`, `BADGE_CATEGORY_STYLE`, `DEFAULT_BADGE_CATEGORY_STYLE` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Replace the lucide import block and add the shared import**

In `artifacts/focusquest/src/pages/progress.tsx`, replace the icon import (lines 5-8):

```tsx
import {
  Award, Flame, Trophy, Zap, CheckCircle2, Star, Target,
  Rocket, TrendingUp, Shield, Users, Medal, Calendar, Crown,
} from "lucide-react";
```

with the trimmed set (only icons still referenced directly — headings, stat cards, and the habit-streak preview) plus the shared module import:

```tsx
import { Award, Flame, Trophy, Zap, Star, Rocket } from "lucide-react";
import { BadgeIcon, BADGE_CATEGORY_STYLE, DEFAULT_BADGE_CATEGORY_STYLE } from "@/lib/badges";
```

- [ ] **Step 2: Delete the local `ICON_MAP` and `CATEGORY_STYLE`**

Delete the entire `ICON_MAP` constant (the `const ICON_MAP: Record<string, React.ReactNode> = { ... };` block, lines 15-30) and the entire `CATEGORY_STYLE` constant (`const CATEGORY_STYLE: Record<...> = { ... };` block, lines 32-39).

- [ ] **Step 3: Update the two usages**

Update the category-style lookup (was line ~189):

```tsx
const style = BADGE_CATEGORY_STYLE[cat] ?? DEFAULT_BADGE_CATEGORY_STYLE;
```

Update the earned-badge card icon (was line ~207) — replace:

```tsx
<span className={style.color}>
  {ICON_MAP[ub.badge.icon] ?? <Award className="w-8 h-8" />}
</span>
```

with (`BadgeIcon` already falls back to `Award` internally):

```tsx
<span className={style.color}>
  <BadgeIcon icon={ub.badge.icon} className="w-8 h-8" />
</span>
```

Leave the habit-streak milestone preview block unchanged — it uses inline `<Flame/>`, `<Zap/>`, `<Star/>`, `<Rocket/>` icons, which are still imported.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors (in particular, no "unused import" — the trimmed icon list is exactly what remains referenced).

- [ ] **Step 5: Verify the Progress page renders unchanged**

Start the dev server with `preview_start` (create `.claude/launch.json` with a `focusquest` config running `pnpm --filter @workspace/focusquest dev` on the Vite port if it does not exist), navigate to `/progress`, and take a `preview_screenshot`. Confirm the badges grid, category sections, and colors look exactly as before.

- [ ] **Step 6: Run the full app test suite**

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS — existing tests plus Task 1's `badges.test.ts` all green.

- [ ] **Step 7: Commit**

```bash
git add artifacts/focusquest/src/pages/progress.tsx
git commit -m "refactor(progress): consume shared badge module instead of local maps"
```

---

### Task 3: `RecentBadges` component

**Files:**
- Create: `artifacts/focusquest/src/components/recent-badges.tsx`

**Interfaces:**
- Consumes: `BadgeIcon`, `BADGE_CATEGORY_STYLE`, `DEFAULT_BADGE_CATEGORY_STYLE`, `pickRecentBadges` from Task 1; `useGetMyBadges` from `@workspace/api-client-react`.
- Produces: `RecentBadges(): JSX.Element` — the third-section component, used as part of the dashboard `aside` composite in Task 4.

- [ ] **Step 1: Create the component**

Create `artifacts/focusquest/src/components/recent-badges.tsx`:

```tsx
import { useGetMyBadges } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Award, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import {
  BadgeIcon,
  BADGE_CATEGORY_STYLE,
  DEFAULT_BADGE_CATEGORY_STYLE,
  pickRecentBadges,
} from "@/lib/badges";

const SECTION_LABEL =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5";

/**
 * Compact "last few earned badges" strip, shown on the dashboard as the third
 * section of the Quest Activity card (beside the heatmap and hero portrait).
 */
export function RecentBadges() {
  const { data: userBadges, isLoading } = useGetMyBadges();

  if (isLoading) {
    return (
      <div className="min-w-0">
        <div className={SECTION_LABEL}>Recent Badges</div>
        <div className="flex gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-11 h-11 rounded-full bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const recent = pickRecentBadges(userBadges, 3);

  if (recent.length === 0) {
    return (
      <div className="min-w-0">
        <div className={SECTION_LABEL}>Recent Badges</div>
        <div className="flex flex-col items-start gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center border border-border bg-muted/20 text-muted-foreground opacity-60 mb-1">
            <Award className="w-5 h-5" aria-hidden />
          </div>
          <p className="text-sm font-medium text-foreground leading-tight">No badges yet</p>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            Complete quests to earn your first <ChevronRight className="w-3 h-3" aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className={SECTION_LABEL}>Recent Badges</div>
      <div className="flex gap-2.5">
        {recent.map((ub) => {
          const style = BADGE_CATEGORY_STYLE[ub.badge.category] ?? DEFAULT_BADGE_CATEGORY_STYLE;
          const tip = `${ub.badge.name} — ${format(new Date(ub.earnedAt), "MMM d")}`;
          return (
            <div
              key={ub.badge.id}
              title={tip}
              aria-label={tip}
              className={`w-11 h-11 rounded-full flex items-center justify-center border ${style.bg} ${style.border} ${style.color}`}
            >
              <BadgeIcon icon={ub.badge.icon} className="w-5 h-5" />
            </div>
          );
        })}
      </div>
      <Link
        href="/progress"
        className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline mt-3"
      >
        View all <ChevronRight className="w-3 h-3" aria-hidden />
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors. (The component is not yet rendered anywhere; full visual verification happens in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add artifacts/focusquest/src/components/recent-badges.tsx
git commit -m "feat(dashboard): RecentBadges section component"
```

---

### Task 4: Wire the hero + badges composite into the dashboard card

**Files:**
- Modify: `artifacts/focusquest/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes: `RecentBadges` from Task 3; existing `HeroSummary` and `ActivityHeatmap`.
- Produces: nothing new.

- [ ] **Step 1: Import `RecentBadges`**

In `artifacts/focusquest/src/pages/dashboard.tsx`, directly below the existing `import { HeroSummary } from "@/components/hero-summary";` (line 6), add:

```tsx
import { RecentBadges } from "@/components/recent-badges";
```

- [ ] **Step 2: Replace the `aside` with the composite**

Replace the heatmap render (line ~261-262):

```tsx
      {/* ── Quest Activity Heatmap + Hero ─────────────────── */}
      <ActivityHeatmap aside={<HeroSummary />} />
```

with the three-section composite (hero, divider, badges):

```tsx
      {/* ── Quest Activity Heatmap + Hero + Recent Badges ── */}
      <ActivityHeatmap
        aside={
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6 w-full">
            <div className="sm:shrink-0">
              <HeroSummary />
            </div>
            <div className="w-full border-t border-border pt-4 sm:w-auto sm:border-t-0 sm:border-l sm:border-border sm:pt-0 sm:pl-6">
              <RecentBadges />
            </div>
          </div>
        }
      />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 4: Visual verification — desktop**

Ensure the dev server is running (`preview_start`), navigate to `/`, `preview_screenshot`. Confirm the Quest Activity card now shows three columns: heatmap, hero portrait, and the Recent Badges chips, separated by dividers, with the right-side gap filled. Use `preview_inspect` on a chip to confirm the category color classes are applied. If an account with badges is available, hover a chip to confirm the `name — date` tooltip.

- [ ] **Step 5: Visual verification — mobile + empty state**

`preview_resize` to `mobile` (375px). `preview_screenshot`. Confirm the three sections stack vertically with the top-border dividers and nothing overflows horizontally. If the test account has no badges, confirm the "No badges yet / Complete quests to earn your first →" nudge renders in place of the chips; otherwise verify against a fresh account or note it as covered by the code path.

- [ ] **Step 6: Build**

Run: `pnpm --filter @workspace/focusquest build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add artifacts/focusquest/src/pages/dashboard.tsx
git commit -m "feat(dashboard): show recent badges as third section of activity card"
```

---

## Notes for the implementer

- The three visual sections come from two dividers: the **existing** `lg:border-l` inside `ActivityHeatmap` (heatmap | aside) and the `sm:border-l` you add inside the composite (hero | badges). Do not edit `ActivityHeatmap`.
- `HeroSummary`'s root has `w-full`; the `sm:shrink-0` wrapper keeps it from consuming the whole row so the badges column gets its share. If the hero still stretches oddly in the preview, constrain the wrapper further (e.g. add `sm:w-auto`) — verify in Task 4 Step 4 before committing.
- `pickRecentBadges` is generic over `{ earnedAt: string }`, so `RecentBadges` passes `UserBadge[]` and gets `UserBadge[]` back with no extra typing.
- Commit after each task. If `git` reports "failed to delete `.git/worktrees/...`: Permission denied", that is a pre-existing OneDrive lock artifact and is harmless — the commit still succeeds; verify with `git log --oneline -1`.
