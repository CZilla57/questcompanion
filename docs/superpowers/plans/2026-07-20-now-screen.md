# The Now Screen Implementation Plan (Act VII quest 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert `/` from a status dashboard into a Now surface (chips → momentum suggestion → quick-add → today's quests → status row), relocate status modules to `/progress`, and consolidate nav 12 → 7 desktop / 5 mobile via tabs-as-links — with zero URL changes and zero server changes.

**Architecture:** Pure nav/group config lives in `lib/nav-groups.ts` (tested), consumed by a `PageTabs` link-row component and by `layout.tsx`. The momentum block inlined in `tasks.tsx` is extracted into `useMomentumBoard` + `TodaysFocus` and reused on the Now page. `dashboard.tsx` is renamed `now.tsx`; relocated blocks move verbatim into `progress.tsx`.

**Tech Stack:** React 18, wouter (`Link`, `useLocation`), TanStack Query via generated `@workspace/api-client-react` hooks, tailwind + local `ui/*` primitives, vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-now-screen-design.md` (approved, PR #67). Line-range anchors below refer to files **at commit `a7a9714`**.

## Global Constraints

- **Zero diffs outside `artifacts/focusquest/`.** No api-server, api-spec, db, or generated-client changes (spec §8.7).
- **Zero URL changes.** Every existing route keeps rendering its page; no wouter redirects in this quest (spec §2).
- **Behavior parity on `/tasks`**: the momentum extraction must not change what renders there; no edits to existing `momentum-board` lib tests (spec §9).
- Momentum/steering logic itself untouched (spec §10). Visual idiom: reuse existing card/pill/tailwind patterns — no redesign.
- Anti-shame: status row states facts, no loss framing; welcome-back banner copy untouched; streak 0 renders no streak segment.
- Fold contract (spec §8.1): at 375×812 with chips present, momentum suggestion card + quick-add bar + first pending quest fully visible without scrolling.
- Run tests with `pnpm --filter @workspace/focusquest test`, typecheck with `pnpm typecheck` (repo root). Commit after every task on branch `feat/now-screen`.

---

### Task 0: Branch

- [ ] **Step 1:** From up-to-date `main`, create the feature branch and confirm cleanliness:

```bash
git switch main && git pull && git switch -c feat/now-screen && git status --short
```

Expected: empty status. (This plan file is committed on this branch as its first commit if not already present.)

---

### Task 1: `lib/nav-groups.ts` — nav/group config + active-group resolution

**Files:**
- Create: `artifacts/focusquest/src/lib/nav-groups.ts`
- Test: `artifacts/focusquest/src/lib/nav-groups.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 2 and 3):
  - `interface NavTab { label: string; href: string }`
  - `interface NavGroup { key: string; label: string; href: string; mobileShow: boolean; tabs?: NavTab[] }`
  - `const NAV_GROUPS: NavGroup[]` (7 entries, order = sidebar order)
  - `function activeGroupKey(location: string): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// artifacts/focusquest/src/lib/nav-groups.test.ts
import { describe, it, expect } from "vitest";
import { NAV_GROUPS, activeGroupKey } from "./nav-groups";

describe("NAV_GROUPS shape", () => {
  it("has exactly 7 desktop entries and 5 mobile entries", () => {
    expect(NAV_GROUPS).toHaveLength(7);
    expect(NAV_GROUPS.filter((g) => g.mobileShow)).toHaveLength(5);
    expect(NAV_GROUPS.filter((g) => g.mobileShow).map((g) => g.label))
      .toEqual(["Home", "Quests", "Focus", "Progress", "Hero"]);
  });
  it("keeps every pre-consolidation nav href reachable in some group", () => {
    const reachable = NAV_GROUPS.flatMap((g) => [g.href, ...(g.tabs ?? []).map((t) => t.href)]);
    for (const href of ["/", "/tasks", "/questlines", "/focus", "/recurring", "/progress",
      "/insights", "/avatar", "/partners", "/leaderboard", "/dopamine-menu", "/rewards"]) {
      expect(reachable).toContain(href);
    }
  });
  it("group hrefs are unique", () => {
    const hrefs = NAV_GROUPS.map((g) => g.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("activeGroupKey", () => {
  it("matches exact group and tab hrefs", () => {
    expect(activeGroupKey("/")).toBe("home");
    expect(activeGroupKey("/tasks")).toBe("quests");
    expect(activeGroupKey("/recurring")).toBe("quests");
    expect(activeGroupKey("/insights")).toBe("progress");
    expect(activeGroupKey("/leaderboard")).toBe("allies");
    expect(activeGroupKey("/dopamine-menu")).toBe("rewards");
  });
  it("matches :id subroutes by prefix, but never treats / as a prefix", () => {
    expect(activeGroupKey("/questlines/7")).toBe("quests");
    expect(activeGroupKey("/partners/3")).toBe("allies");
    expect(activeGroupKey("/reflection")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- nav-groups`
Expected: FAIL — cannot resolve `./nav-groups`.

- [ ] **Step 3: Write minimal implementation**

```ts
// artifacts/focusquest/src/lib/nav-groups.ts
// Single source of truth for the 7-entry nav and its tab groups (Act VII q2).
// Pure — layout.tsx and page-tabs.tsx both derive from this; icons stay in layout.

export interface NavTab { label: string; href: string }
export interface NavGroup {
  key: string;
  label: string;
  href: string;        // where the nav entry lands
  mobileShow: boolean; // bottom-bar membership (exactly 5 true)
  tabs?: NavTab[];     // tabs-as-links rendered on every page in the group
}

export const NAV_GROUPS: NavGroup[] = [
  { key: "home", label: "Home", href: "/", mobileShow: true },
  {
    key: "quests", label: "Quests", href: "/tasks", mobileShow: true,
    tabs: [
      { label: "Today", href: "/tasks" },
      { label: "Questlines", href: "/questlines" },
      { label: "Recurring", href: "/recurring" },
    ],
  },
  { key: "focus", label: "Focus", href: "/focus", mobileShow: true },
  {
    key: "progress", label: "Progress", href: "/progress", mobileShow: true,
    tabs: [
      { label: "Progress", href: "/progress" },
      { label: "Insights", href: "/insights" },
    ],
  },
  { key: "hero", label: "Hero", href: "/avatar", mobileShow: true },
  {
    key: "allies", label: "Allies", href: "/partners", mobileShow: false,
    tabs: [
      { label: "Allies", href: "/partners" },
      { label: "Leaderboard", href: "/leaderboard" },
    ],
  },
  {
    // Interim group until Quest 3 (Honest Coin) builds the real hub and
    // retires /dopamine-menu — one nav entry, two existing pages as tabs.
    key: "rewards", label: "Rewards", href: "/rewards", mobileShow: false,
    tabs: [
      { label: "Treats", href: "/dopamine-menu" },
      { label: "Store", href: "/rewards" },
    ],
  },
];

/** Which nav group is active for a location: exact group/tab href match, or a
 * `${href}/` prefix so /questlines/7 lights Quests. "/" only matches exactly. */
export function activeGroupKey(location: string): string | null {
  for (const g of NAV_GROUPS) {
    const hrefs = [g.href, ...(g.tabs ?? []).map((t) => t.href)];
    for (const href of hrefs) {
      if (location === href) return g.key;
      if (href !== "/" && location.startsWith(`${href}/`)) return g.key;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/focusquest test -- nav-groups`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/nav-groups.ts artifacts/focusquest/src/lib/nav-groups.test.ts
git commit -m "feat(web): nav-groups config — 7 desktop / 5 mobile, active-group resolution"
```

---

### Task 2: `lib/status-row.ts` — status parts helper

**Files:**
- Create: `artifacts/focusquest/src/lib/status-row.ts`
- Test: `artifacts/focusquest/src/lib/status-row.test.ts`

**Interfaces:**
- Produces (used by Task 6's `StatusRow` component):
  - `interface StatusRowStats { streakDays: number; currentLevel: number; todayPoints: number }`
  - `function statusRowParts(s: StatusRowStats): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// artifacts/focusquest/src/lib/status-row.test.ts
import { describe, it, expect } from "vitest";
import { statusRowParts } from "./status-row";

describe("statusRowParts", () => {
  it("renders streak, level, and today's XP as plain facts", () => {
    expect(statusRowParts({ streakDays: 6, currentLevel: 4, todayPoints: 35 }))
      .toEqual(["6-day streak", "Lv 4", "35 XP today"]);
  });
  it("omits the streak segment at streak 0 — never leads home with a zero", () => {
    expect(statusRowParts({ streakDays: 0, currentLevel: 1, todayPoints: 0 }))
      .toEqual(["Lv 1", "0 XP today"]);
  });
  it("singularizes day 1", () => {
    expect(statusRowParts({ streakDays: 1, currentLevel: 2, todayPoints: 10 })[0])
      .toBe("1-day streak");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- status-row`
Expected: FAIL — cannot resolve `./status-row`.

- [ ] **Step 3: Write minimal implementation**

```ts
// artifacts/focusquest/src/lib/status-row.ts
// Compact home status line (Act VII q2). Anti-shame: streak 0 is silence,
// not a zero — the row simply starts at level.

export interface StatusRowStats {
  streakDays: number;
  currentLevel: number;
  todayPoints: number;
}

export function statusRowParts(s: StatusRowStats): string[] {
  const parts: string[] = [];
  if (s.streakDays > 0) parts.push(`${s.streakDays}-day streak`);
  parts.push(`Lv ${s.currentLevel}`);
  parts.push(`${s.todayPoints} XP today`);
  return parts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/focusquest test -- status-row`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/status-row.ts artifacts/focusquest/src/lib/status-row.test.ts
git commit -m "feat(web): status-row parts helper — streak omitted at zero"
```

---

### Task 3: `PageTabs` component + tab headers on all 9 grouped pages

**Files:**
- Create: `artifacts/focusquest/src/components/page-tabs.tsx`
- Modify: `artifacts/focusquest/src/pages/tasks.tsx`, `questlines.tsx`, `recurring.tsx`, `progress.tsx`, `insights.tsx`, `partners.tsx`, `leaderboard.tsx`, `dopamine-menu.tsx`, `rewards-store.tsx`

**Interfaces:**
- Consumes: `NAV_GROUPS` from Task 1.
- Produces: `function PageTabs({ group }: { group: "quests" | "progress" | "allies" | "rewards" }): JSX.Element | null`

- [ ] **Step 1: Write the component**

```tsx
// artifacts/focusquest/src/components/page-tabs.tsx
// Tabs-as-links (Act VII q2): grouped routes stay first-class pages joined by
// a link row, so deep links and old URLs never break. Styled after ui/tabs
// triggers; active state mirrors nav-groups' prefix rule for :id subroutes.
import { Link, useLocation } from "wouter";
import { NAV_GROUPS } from "@/lib/nav-groups";

export function PageTabs({ group }: { group: "quests" | "progress" | "allies" | "rewards" }) {
  const [location] = useLocation();
  const tabs = NAV_GROUPS.find((g) => g.key === group)?.tabs;
  if (!tabs) return null;

  return (
    <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground mb-2" role="tablist" aria-label={`${group} sections`}>
      {tabs.map((t) => {
        const active = location === t.href || location.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} role="tab" aria-selected={active}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${
              active ? "bg-background text-foreground shadow" : "hover:text-foreground"
            }`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Insert into all 9 pages**

In each file below, add `import { PageTabs } from "@/components/page-tabs";` and insert the tag as the **first child of the default-export page component's outermost returned `<div>`** (not inside helper components):

| File | Page component | Outer div anchor (at a7a9714) | Insert |
|---|---|---|---|
| `tasks.tsx` | `Tasks` | line 311 `<div className="space-y-6 animate-in fade-in duration-500">` | `<PageTabs group="quests" />` |
| `questlines.tsx` | default export | its outermost returned `<div>` | `<PageTabs group="quests" />` |
| `recurring.tsx` | default export | its outermost returned `<div>` | `<PageTabs group="quests" />` |
| `progress.tsx` | `Progress` | line 59 `<div className="space-y-8 animate-in fade-in duration-500">` | `<PageTabs group="progress" />` |
| `insights.tsx` | default export | its outermost returned `<div>` | `<PageTabs group="progress" />` |
| `partners.tsx` | `Partners` | its outermost returned `<div>` | `<PageTabs group="allies" />` |
| `leaderboard.tsx` | default export | its outermost returned `<div>` | `<PageTabs group="allies" />` |
| `dopamine-menu.tsx` | default export | line 73 `<div className="space-y-8 animate-in fade-in duration-500 max-w-xl">` | `<PageTabs group="rewards" />` |
| `rewards-store.tsx` | default export | line 82 `<div className="space-y-8 animate-in fade-in duration-500 max-w-xl">` | `<PageTabs group="rewards" />` |

Note: `progress.tsx` has an early-return loading state (lines 37–43) — the tabs go in the main return only. Loading flashes without tabs are acceptable (parity with current behavior).

- [ ] **Step 3: Verify suite + typecheck**

Run: `pnpm --filter @workspace/focusquest test` then `pnpm typecheck`
Expected: all existing tests PASS; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/components/page-tabs.tsx artifacts/focusquest/src/pages
git commit -m "feat(web): PageTabs link-row on all grouped pages (quests/progress/allies/rewards)"
```

---

### Task 4: `layout.tsx` — 7-entry nav, group-aware active state, 5-slot mobile bar, hamburger unread dot

**Files:**
- Modify: `artifacts/focusquest/src/components/layout.tsx`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `activeGroupKey` (Task 1).

- [ ] **Step 1: Replace the nav config (lines 162–177 at a7a9714)**

Delete the `allNavItems` array and `mobileNavItems` filter. Replace with:

```tsx
import { NAV_GROUPS, activeGroupKey } from "@/lib/nav-groups";

// Icons stay presentational, keyed by group; config truth lives in nav-groups.ts.
const NAV_ICONS: Record<string, typeof Home> = {
  home: Home, quests: CheckSquare, focus: Timer, progress: BarChart2,
  hero: User, allies: Users, rewards: ShoppingBag,
};
const allNavItems = NAV_GROUPS.map((g) => ({ ...g, icon: NAV_ICONS[g.key] }));
const mobileNavItems = allNavItems.filter((i) => i.mobileShow);
```

Unused lucide imports after this change (`BarChart3`, `Trophy`, `Repeat`, `Coffee`, `Scroll`) are removed from the import on line 4.

- [ ] **Step 2: Group-aware active state**

In `Layout`, add `const activeKey = activeGroupKey(location);` next to the existing `useLocation()`. In **both** nav renderers (sidebar map, lines 255–284; mobile bar map, lines 321–349):
- change `const isActive = location === item.href;` → `const isActive = activeKey === item.key;`
- change the map key from `item.href` → `item.key`
- delete the sidebar's `"Board" → "Leaderboard"` label special-case (line 279) — labels now come from config: `{item.label}`.

- [ ] **Step 3: Hamburger unread dot**

The ally-unread badge JSX on `/partners` items stays as-is (sidebar + any bar item with `item.href === "/partners"` — now unreachable on the bar since Allies left it, which is fine and self-healing if it ever returns). Add the dot to the mobile hamburger button (lines 211–219): inside the `<Button aria-label="Open menu">`, after the icon ternary, add:

```tsx
{allyUnread > 0 && !sidebarOpen && (
  <span aria-hidden className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-destructive rounded-full" />
)}
```

and add `relative` to that Button's className.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @workspace/focusquest test` and `pnpm typecheck`
Expected: PASS / clean. (Nav counts are already pinned by the Task 1 tests.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): nav 12->7 desktop / 5 mobile from NAV_GROUPS; hamburger unread dot"
```

---

### Task 5: Extract `useMomentumBoard` + `TodaysFocus`; `tasks.tsx` consumes them

**Files:**
- Create: `artifacts/focusquest/src/hooks/use-momentum-board.ts`
- Create: `artifacts/focusquest/src/components/todays-focus.tsx`
- Modify: `artifacts/focusquest/src/pages/tasks.tsx`

**Interfaces:**
- Consumes: existing `momentumBoardState` (`@/lib/momentum-board`), `MODE_META` (`@/lib/brain-mode-meta`), `inWindowNow` (`@/lib/steering`), `formatPowerHours` (`@/lib/rhythms`), `MomentumCard` (`@/components/momentum-card`), generated hooks.
- Produces (used by Task 8):
  - `useMomentumBoard(): { momentum, momentumLoading: boolean, patterns, momentumMinutes: number | null, setMinutes: (m: number | null) => void, handleSkip: () => void, visibleSuggestions, todayStrKey: string }`
  - `TodaysFocus({ tasks, showPinned, onEditTask }: { tasks: Task[]; showPinned: boolean; onEditTask?: (t: Task) => void }): JSX.Element`

- [ ] **Step 1: Create the hook** — the state block moves **verbatim** from `tasks.tsx` lines 124–169 at a7a9714 (from `const tz = browserTimeZone();` through the close of `handleSkip`), wrapped as:

```ts
// artifacts/focusquest/src/hooks/use-momentum-board.ts
// Extracted verbatim from pages/tasks.tsx (Act VII q2) so / and /tasks share
// one momentum implementation. No behavior change — logic is the spec.
import { useState } from "react";
import { format } from "date-fns";
import {
  useGetTasksMomentum, useGetMyPatterns, getGetMyPatternsQueryKey,
} from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";

export function useMomentumBoard() {
  const tz = browserTimeZone();
  const todayStrKey = format(new Date(), "yyyy-MM-dd");
  // …lines 126–169 of tasks.tsx@a7a9714 pasted here unchanged:
  // skippedIds/altIndex/momentumMinutes state (sessionStorage read),
  // setMinutes, useGetTasksMomentum call, useGetMyPatterns call,
  // batch/visibleSuggestions, handleSkip.
  return { momentum, momentumLoading, patterns, momentumMinutes, setMinutes, handleSkip, visibleSuggestions, todayStrKey };
}
```

The pasted body is the exact code currently at those lines — first line `const [skippedIds, setSkippedIds] = useState<number[]>([]);`, last line of `handleSkip` is its closing `};`. Do not edit it.

- [ ] **Step 2: Create the component** — the render block moves from `tasks.tsx` lines 384–461 at a7a9714 (the `{/* Today's Focus section */}` IIFE):

```tsx
// artifacts/focusquest/src/components/todays-focus.tsx
// The momentum block, shared by / (suggestion only) and /tasks (with pinned
// rail). Extracted from pages/tasks.tsx; rendering and copy unchanged.
import { Target, Pin, Zap } from "lucide-react";
import { Task, BrainMode } from "@workspace/api-client-react";
import { MomentumCard } from "@/components/momentum-card";
import { TaskItem } from "@/components/task-item";
import { momentumBoardState } from "@/lib/momentum-board";
import { MODE_META } from "@/lib/brain-mode-meta";
import { inWindowNow } from "@/lib/steering";
import { formatPowerHours } from "@/lib/rhythms";
import { useMomentumBoard } from "@/hooks/use-momentum-board";

export function TodaysFocus({ tasks, showPinned, onEditTask }: {
  tasks: Task[]; showPinned: boolean; onEditTask?: (t: Task) => void;
}) {
  const { momentum, momentumLoading, patterns, momentumMinutes, setMinutes, handleSkip, visibleSuggestions, todayStrKey } = useMomentumBoard();
  const board = momentumBoardState(tasks, visibleSuggestions, todayStrKey);
  // …the body of the IIFE from tasks.tsx lines 386–460 pasted here unchanged,
  // with exactly two mechanical edits:
  //   1. `board.pinned` rail block (lines 451–457) wrapped in `{showPinned && (…)}`
  //   2. `onEdit={handleOpenEdit}` → `onEdit={onEditTask}`
  // Everything else — heading, power banner, flavor line, empty/all-done
  // states, MomentumCard wiring — is byte-identical.
}
```

- [ ] **Step 3: Consume in `tasks.tsx`** — delete lines 124–169 (state block) and replace the IIFE (lines 384–461) with:

```tsx
<TodaysFocus tasks={tasks ?? []} showPinned onEditTask={handleOpenEdit} />
```

Add the import, remove now-unused imports (`MomentumCard`, `momentumBoardState`, `MODE_META`, `inWindowNow`, `formatPowerHours`, `useGetTasksMomentum`, `useGetMyPatterns`, `getGetMyPatternsQueryKey`, `Pin`; keep `getGetTasksMomentumQueryKey` — the create/edit/breakdown invalidations still use it).

- [ ] **Step 4: Verify parity**

Run: `pnpm --filter @workspace/focusquest test` and `pnpm typecheck`
Expected: PASS / clean — no test edits allowed by this task.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/hooks/use-momentum-board.ts artifacts/focusquest/src/components/todays-focus.tsx artifacts/focusquest/src/pages/tasks.tsx
git commit -m "refactor(web): extract useMomentumBoard + TodaysFocus from tasks page"
```

---

### Task 6: Chip variants — `BrainCheckinPrompt`, `EveningReflectionCard`, `StatusRow`

**Files:**
- Modify: `artifacts/focusquest/src/components/brain-checkin-prompt.tsx`
- Modify: `artifacts/focusquest/src/components/evening-reflection-card.tsx`
- Create: `artifacts/focusquest/src/components/status-row.tsx`

**Interfaces:**
- Consumes: `statusRowParts` (Task 2).
- Produces (used by Task 8): `BrainCheckinPrompt({ variant?: "card" | "chip" })`, `EveningReflectionCard({ variant?: "card" | "chip" })`, `StatusRow({ stats })` where `stats` is the `useGetMyStats` payload (needs `streakDays`, `currentLevel`, `todayPoints`).

- [ ] **Step 1: `BrainCheckinPrompt` chip** — add prop `variant: "card" | "chip" = "card"` and `const [expanded, setExpanded] = useState(false);`. Show-logic line 31 unchanged. When `variant === "chip" && !expanded`, return the one-liner instead of the card:

```tsx
return (
  <button onClick={() => setExpanded(true)}
    className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.04] px-3 py-1.5 text-xs text-foreground hover:border-primary/50 transition-colors">
    <span aria-hidden>🧠</span> How's the brain today?
  </button>
);
```

Tapping expands to the existing card JSX (unchanged, lines 51–71) — same flow, one line until touched. `dismiss` also sets `setExpanded(false)`.

- [ ] **Step 2: `EveningReflectionCard` chip** — add the same prop. When `"chip"`, return:

```tsx
return (
  <Link href="/reflection"
    className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.04] px-3 py-1.5 text-xs text-foreground hover:border-primary/50 transition-colors">
    <Moon className="w-3.5 h-3.5 text-primary" aria-hidden /> Evening reflection — 1 minute
  </Link>
);
```

Visibility conditions (line 21) unchanged; the card branch stays for any other caller.

- [ ] **Step 3: `StatusRow`**

```tsx
// artifacts/focusquest/src/components/status-row.tsx
// One quiet line where four stat cards used to be. Tap-through to /progress.
import { Link } from "wouter";
import { Flame } from "lucide-react";
import { statusRowParts, type StatusRowStats } from "@/lib/status-row";

export function StatusRow({ stats }: { stats: StatusRowStats }) {
  const parts = statusRowParts(stats);
  return (
    <Link href="/progress"
      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Open progress">
      {stats.streakDays > 0 && <Flame className="w-4 h-4 text-orange-400" aria-hidden />}
      <span>{parts.join(" · ")}</span>
    </Link>
  );
}
```

- [ ] **Step 4: Verify** — `pnpm --filter @workspace/focusquest test` and `pnpm typecheck`: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/brain-checkin-prompt.tsx artifacts/focusquest/src/components/evening-reflection-card.tsx artifacts/focusquest/src/components/status-row.tsx
git commit -m "feat(web): chip variants for check-in/reflection prompts + StatusRow"
```

---

### Task 7: `progress.tsx` absorbs the relocated modules

**Files:**
- Modify: `artifacts/focusquest/src/pages/progress.tsx`

**Interfaces:**
- Consumes: nothing new from this plan — moves existing dashboard blocks.
- Produces: `/progress` renders XP bar, heatmap composite, Streak Shield (with buy flow), Activity Log.

All source ranges are `pages/dashboard.tsx` **at a7a9714** (dashboard is rewritten in Task 8 — this task copies, Task 8 deletes).

- [ ] **Step 1: Move the logic pieces into `Progress()`**
  - `const FREEZE_COST = 50;` (dashboard line 29) → module scope of progress.tsx.
  - `handleBuyFreeze` (lines 147–165), `hasFreeze`/`canAfford` (174–175), and the `progressPercent` computation (167–172) → inside `Progress()`, after the existing data hooks. They need: `useBuyStreakFreeze`, `useQueryClient`, `getGetMyStatsQueryKey`, `useToast`, `apiErrorMessage` — add those imports; add `const queryClient = useQueryClient();`, `const { toast } = useToast();`, `const buyFreezeMutation = useBuyStreakFreeze();`. `stats` already exists in Progress (same `useGetMyStats` hook).

- [ ] **Step 2: Move the JSX blocks** — insert before the main return's closing `</div>` (after the Badges section, line 252), in this order, all byte-identical from dashboard.tsx:
  1. **XP progress bar** card — lines 278–290 (anchor: `{/* ── XP Progress bar ───` … `</Card>`).
  2. **Heatmap + Hero + Badges** composite — lines 299–311 (`<ActivityHeatmap aside={…} />`).
  3. **Streak Shield** card — lines 351–402 (anchor: `{/* ── Streak Shield ───` … `</Card>`).
  4. **Activity Log** — lines 450–492, but as a full-width section: keep the inner `<h2>Activity Log</h2>` + `<Card>` markup, drop the old grid wrapper `div className="space-y-5"` in favor of `<div className="space-y-5 max-w-2xl">`.

  New imports for these blocks: `ActivityHeatmap`, `HeroSummary`, `RecentBadges`, `Progress as ProgressBar` from `@/components/ui/progress` (aliased — the page component is already named `Progress`; rename the moved JSX's `<Progress …>` bar accordingly), `ActivityItem` type, and lucide icons used by the shield + activity rows (`Shield`, `ShieldCheck`, `ShieldOff`, `Check`, `Timer`, `Play`, `Moon`); `format` from date-fns is already imported.

- [ ] **Step 3: Verify** — `pnpm --filter @workspace/focusquest test` and `pnpm typecheck`: PASS / clean.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/pages/progress.tsx
git commit -m "feat(web): /progress absorbs XP bar, heatmap composite, Streak Shield, Activity Log"
```

---

### Task 8: `dashboard.tsx` → `now.tsx` — the Now surface

**Files:**
- Rename: `artifacts/focusquest/src/pages/dashboard.tsx` → `artifacts/focusquest/src/pages/now.tsx` (`git mv`)
- Modify: `artifacts/focusquest/src/App.tsx` (line 13 import → `import NowScreen from "@/pages/now";`, line 165 route → `<Route path="/" component={NowScreen} />`)

**Interfaces:**
- Consumes: `TodaysFocus` (Task 5), `StatusRow` (Task 6), chip variants (Task 6), `QuickAddBar` (`{ selectedDate }` — existing).

- [ ] **Step 1: Rewrite the page.** Component renamed `NowScreen`. Order per spec §3; kept blocks come verbatim from dashboard.tsx@a7a9714. Full new render:

```tsx
return (
  <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
    {/* 1 — prompt chips (one row, wrap allowed) */}
    <div className="flex flex-wrap items-center gap-2 empty:hidden">
      <BrainCheckinPrompt variant="chip" />
      <EveningReflectionCard variant="chip" />
    </div>

    {/* 2 — momentum suggestion (no pinned rail here: the list below has them) */}
    <TodaysFocus tasks={tasks ?? []} showPinned={false} />

    {/* 3 — capture, one tap from open */}
    <div id="quick-add">
      <QuickAddBar selectedDate={new Date()} />
    </div>

    {/* 4 — today's quests: dashboard.tsx lines 407–448 verbatim, minus the
        grid wrapper and minus the "View All" button's redundancy — it stays,
        retargeted copy unchanged (href /tasks). Empty-state copy becomes: */}
    {/*   <h3>Nothing queued today</h3><p>Capture one above — text or voice.</p>
          (the old "Add a Quest" button is removed; quick-add sits directly above) */}

    {/* 5 — status row (replaces the 4 stat cards) */}
    {stats && <StatusRow stats={stats} />}

    {/* 6 — welcome-back banner: lines 313–349 verbatim, except the CTA Button
        (lines 333–339) becomes an in-page scroll instead of a /tasks link: */}
    {/*   <Button size="sm" className="…same classes…" onClick={() =>
            document.getElementById("quick-add")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
            Capture a small quest →
          </Button> */}

    {/* dialogs: edit-quest (495–568) and level-up (570–604) verbatim */}
  </div>
);
```

Removed entirely (relocated by Task 7 or dropped by spec §11): stat cards (190–258), focus CTA banner (260–276), XP bar (278–290), `KingdomStrip` (292–297), heatmap composite (299–311), Streak Shield (351–402) with `FREEZE_COST`/`handleBuyFreeze`/`hasFreeze`/`canAfford`/`progressPercent`, Activity Log (450–492), and the `lg:grid-cols-3` grid wrapper. Kept state/handlers: `levelUpData`, `decayDismissed`, edit-dialog state + `handleOpenEdit`/`handleSaveEdit`, `pendingTasks`/`completedTasks`, `daysSinceActive`/`showDecayWarning`. The quest list's `TaskItem`s keep `onEdit={handleOpenEdit}` and `onLevelUp={setLevelUpData}`.

- [ ] **Step 2: Replace the skeleton** — `DashboardSkeleton` becomes `NowSkeleton`, mirroring slots 2–4 so the fold contract holds while loading:

```tsx
function NowSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 bg-muted rounded-full animate-pulse" />
      <div className="h-28 bg-muted/20 animate-pulse rounded-xl border border-border" />
      <div className="h-12 bg-muted/20 animate-pulse rounded-xl border border-border" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 bg-muted/20 animate-pulse rounded-xl border border-border" />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Prune imports** to what the new page uses; `pnpm typecheck` is the arbiter.

- [ ] **Step 4: Verify** — `pnpm --filter @workspace/focusquest test` and `pnpm typecheck`: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add -A artifacts/focusquest/src/pages artifacts/focusquest/src/App.tsx
git commit -m "feat(web): home inverts to the Now screen — chips, momentum, quick-add, quests, status row"
```

---

### Task 9: End-to-end verification + PR

**Files:** none (verification only; fixes loop back into the owning task's files).

- [ ] **Step 1: Full local gate**

Run: `pnpm --filter @workspace/focusquest test` → all PASS; `pnpm typecheck` → clean; `git diff main --stat` → **only** `artifacts/focusquest/**` + this plan file (Global Constraint 1).

- [ ] **Step 2: Browser verification** (dev server via preview tooling, never Bash):
  1. Viewport 375×812 on `/`: screenshot — momentum suggestion card, quick-add bar, and first pending quest all fully visible without scrolling, chips row present (spec §8.1).
  2. `read_page`: mobile bar has exactly 5 items (Home, Quests, Focus, Progress, Hero); desktop (1280×800) sidebar exactly 7.
  3. Click through every tab group: Quests → Today/Questlines/Recurring; Progress → Progress/Insights; Allies → Allies/Leaderboard; Rewards → Treats/Store. Each lands on its page, tab + nav highlight correctly; `/questlines/:id` and `/partners/:id` still render with Quests/Allies active.
  4. `/progress`: XP bar, heatmap composite, Streak Shield, Activity Log all render.
  5. Welcome-back banner CTA scrolls to the quick-add bar (temporarily set the decay threshold state via a seeded stale account if available; otherwise verify the onClick target exists: `document.getElementById("quick-add")`).
  6. Mobile 375×812 with an unread ally nudge (or `allyUnread` forced truthy in devtools): red dot renders on the hamburger button; opening the drawer shows the count on the Allies entry.
  7. Console clean of new errors (`read_console_messages`).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/now-screen
```

PR title: `feat(web): The Now Screen — home inversion + nav merge (Act VII q2)`. Body: what/why, fold screenshot from step 2.1, spec + plan links, acceptance checklist (spec §8) with each item checked, note "zero server changes — diff is focusquest-only". End the body with the standard Claude Code attribution line.

---

## Self-Review Notes (resolved inline)

- Spec §3.6 banner CTA copy: spec says the button retargets quick-add; plan renames its label to "Capture a small quest →" so the copy matches the new action — flag in PR body as a copy delta if Chad prefers the old wording.
- `getGetTasksMomentumQueryKey` stays imported in `tasks.tsx` (invalidations) — noted in Task 5 to prevent an over-eager import prune.
- `Progress` name collision with the `ui/progress` bar component in Task 7 — resolved via `Progress as ProgressBar` alias, called out explicitly.
- Stat cards intentionally NOT copied to `/progress` (spec §4 dedupe) — Task 7 moves only the four listed blocks.
