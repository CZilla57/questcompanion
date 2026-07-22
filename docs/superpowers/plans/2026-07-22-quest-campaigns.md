# Quest Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Campaign tier above Questlines — one running long-horizon goal, told as an ordered story arc whose chapters are real questlines.

**Architecture:** New `campaigns` table plus three additive columns on `questlines` (`campaign_id` FK `ON DELETE SET NULL`, `chapter_order`, `chapter_beat`). All decision logic lives in pure, unit-tested libs (`lib/campaigns.ts`, `lib/campaign-arc.ts`, `lib/ai/campaign-arc.ts`); the Express routes are thin orchestration reusing the questline claim transaction shape. Story text is AI-drafted at creation with a curated fallback, snapshotted to the row, and never regenerated on read. Client gets a new `campaigns` feature key at Gentle Door L4 gating a third tab inside the existing Quests nav group.

**Tech Stack:** TypeScript, Express, drizzle-orm/Postgres (Neon), vitest, React + wouter + TanStack Query v5, orval-generated clients from `lib/api-spec/openapi.yaml`, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-22-quest-campaigns-design.md`

## Global Constraints

- **Anti-shame design law.** No decay, no stalled state, no gap counters, no guilt copy. Setting a campaign aside is worded as the user's choice. Campaigns emit **zero notifications** in v1.
- **Chapters are ordered but NEVER gated.** Every quest in every chapter stays visible and workable regardless of chapter order.
- **`ready-to-claim` is derived, never stored** — at both the questline and campaign tier.
- **Exactly one `running` campaign per user**, enforced by a partial unique index, not only by route code.
- **XP monotonicity** (standing guard): campaign paths only ever add XP. Reward is `50 × chapters, capped at 5 chapters = 250 XP max`.
- **Deleting a campaign never deletes work** — `ON DELETE SET NULL` unlinks chapters.
- **Never hand-edit anything under `*/src/generated`** — regenerate with `pnpm --filter @workspace/api-spec codegen`.
- **`drizzle-kit push` is REMOVED.** Migrations are generated: `pnpm --filter @workspace/db generate --name <name>`, review the SQL, commit SQL + `meta/` together.
- **No route-test harness exists** (no supertest in this repo). Push logic into pure libs; prove routes with a live authed drive.
- Migrations are applied to live Neon **before** the PR merges (standing instruction).
- Branch off `main`. Work on `feat/quest-campaigns`.

## File Structure

**Create:**
- `lib/db/src/schema/campaigns.ts` — campaigns table + zod insert schema
- `lib/db/drizzle/0006_quest_campaigns.sql` — generated migration (+ `meta/` updates)
- `artifacts/api-server/src/lib/campaigns.ts` — pure campaign logic
- `artifacts/api-server/src/lib/campaigns.test.ts`
- `artifacts/api-server/src/lib/campaign-arc.ts` — curated arcs + `buildArc` selection
- `artifacts/api-server/src/lib/campaign-arc.test.ts`
- `artifacts/api-server/src/lib/ai/campaign-arc.ts` — prompt + parse + suggest
- `artifacts/api-server/src/lib/ai/campaign-arc.test.ts`
- `artifacts/api-server/src/routes/campaigns.ts` — routes
- `artifacts/focusquest/src/pages/campaigns.tsx` — list page
- `artifacts/focusquest/src/pages/campaign-detail.tsx` — detail page
- `artifacts/focusquest/src/components/campaign-now-line.tsx` — Now-screen current-chapter line

**Modify:**
- `lib/db/src/schema/questlines.ts` — three chapter columns
- `lib/db/src/schema/index.ts` — export campaigns
- `artifacts/api-server/src/lib/account-data.ts` — register `campaigns`
- `artifacts/api-server/src/lib/feature-gates.ts` — add `campaigns` key at L4
- `artifacts/api-server/src/lib/ally-milestones.ts` — add `campaign_complete`
- `artifacts/api-server/src/routes/questlines.ts` — chapter fields in `formatQuestline`, `campaignId`/`chapterOrder` in PATCH
- `artifacts/api-server/src/routes/index.ts` — mount campaigns router
- `lib/api-spec/openapi.yaml` — paths + schemas + enum additions
- `artifacts/focusquest/src/lib/feature-gates.ts` — client mirror
- `artifacts/focusquest/src/lib/nav-groups.ts` — Campaigns tab in the quests group
- `artifacts/focusquest/src/components/page-tabs.tsx` — gate-aware tab filtering
- `artifacts/focusquest/src/App.tsx` — routes + `withGate`
- `artifacts/focusquest/src/pages/now.tsx` — mount the current-chapter line
- `artifacts/focusquest/src/pages/questline-detail.tsx` — chapter beat on claim

---

### Task 1: Schema, migration, and the data registry

**Files:**
- Create: `lib/db/src/schema/campaigns.ts`
- Modify: `lib/db/src/schema/questlines.ts`, `lib/db/src/schema/index.ts`, `artifacts/api-server/src/lib/account-data.ts`
- Generated: `lib/db/drizzle/0006_quest_campaigns.sql` + `lib/db/drizzle/meta/*`
- Test: `artifacts/api-server/src/lib/account-data.test.ts` (existing guard — must stay green)

**Interfaces:**
- Consumes: nothing.
- Produces: `campaignsTable` (columns `id`, `userId`, `title`, `arcPremise`, `endingBeat`, `storySource`, `status`, `rewardXpAwarded`, `completedAt`, `setAsideAt`, `createdAt`), type `Campaign`; `questlinesTable.campaignId | chapterOrder | chapterBeat`.

- [ ] **Step 1: Create the campaigns schema file**

```typescript
// lib/db/src/schema/campaigns.ts
import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  // Denormalized ownership check, matching questlines / task_steps.
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  // Story text is SNAPSHOTTED at creation and never regenerated on read.
  arcPremise: text("arc_premise"),
  endingBeat: text("ending_beat"),
  // 'ai' | 'curated' — which path produced the text above.
  storySource: text("story_source").notNull().default("curated"),
  // 'running' -> 'set_aside' <-> 'running' -> 'completed'.
  // 'ready-to-claim' is derived, never stored (same rule as questlines).
  status: text("status").notNull().default("running"),
  // Claim snapshot so the payout is auditable, mirroring questlines.rewardXpAwarded.
  rewardXpAwarded: integer("reward_xp_awarded"),
  completedAt: timestamp("completed_at"),
  setAsideAt: timestamp("set_aside_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // One running campaign per user — the DB is the guard, not just the route.
  uniqueIndex("campaigns_one_running_per_user")
    .on(t.userId)
    .where(sql`${t.status} = 'running'`),
]);

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  setAsideAt: true,
  status: true,
  rewardXpAwarded: true,
});
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
```

- [ ] **Step 2: Add the three chapter columns to questlines**

In `lib/db/src/schema/questlines.ts`, add the `campaigns` import and the columns. The whole file becomes:

```typescript
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { campaignsTable } from "./campaigns";

export const questlinesTable = pgTable("questlines", {
  id: serial("id").primaryKey(),
  // Denormalized ownership check, matching task_steps / focus_sessions.
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description"),
  color: text("color"),
  // 'active' -> 'completed'. 'ready-to-claim' is derived, never stored.
  status: text("status").notNull().default("active"),
  // Snapshot written at claim so the payout is auditable/reversible, mirroring tasks.pointsAwarded.
  rewardXpAwarded: integer("reward_xp_awarded"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Act VI Quest Campaigns: a questline may be one chapter of one campaign.
  // SET NULL keeps the promise questlines make to quests — deleting the parent
  // unlinks the children, it never deletes work.
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  chapterOrder: integer("chapter_order"),
  chapterBeat: text("chapter_beat"),
});

export const insertQuestlineSchema = createInsertSchema(questlinesTable).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  status: true,
  rewardXpAwarded: true,
});
export type InsertQuestline = z.infer<typeof insertQuestlineSchema>;
export type Questline = typeof questlinesTable.$inferSelect;
```

- [ ] **Step 3: Export the new schema module**

Add to `lib/db/src/schema/index.ts`, immediately after the `questlines` line:

```typescript
export * from "./campaigns";
```

- [ ] **Step 4: Generate the migration**

Run (offline placeholder URL is fine for `generate` — it never introspects):

```bash
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm --filter @workspace/db generate --name quest_campaigns
```

Expected: creates `lib/db/drizzle/0006_quest_campaigns.sql` and updates `lib/db/drizzle/meta/`.

- [ ] **Step 5: Review the generated SQL**

Open `lib/db/drizzle/0006_quest_campaigns.sql` and confirm it contains, and contains nothing else:
- `CREATE TABLE "campaigns" (...)` with the FK to `users`
- `ALTER TABLE "questlines" ADD COLUMN "campaign_id" integer` (+ `chapter_order`, `chapter_beat`)
- an FK from `questlines.campaign_id` to `campaigns.id` with `ON DELETE set null`
- `CREATE UNIQUE INDEX "campaigns_one_running_per_user" ON "campaigns" ("user_id") WHERE "campaigns"."status" = 'running';`

If any `DROP` statement appears, STOP — the generator has picked up unrelated drift. Do not edit the SQL by hand to hide it; report it.

- [ ] **Step 6: Register campaigns in the account-data registry**

In `artifacts/api-server/src/lib/account-data.ts`, add `campaignsTable` to the schema import list, and insert this entry **immediately after** the `questlines` entry (questlines reference campaigns, so children come first):

```typescript
  // Quest Campaigns: chapters (questlines) unlink above, so the campaign row
  // is safe to delete once its questlines are gone.
  { name: "campaigns",          table: campaignsTable,        userColumns: [campaignsTable.userId] },
```

- [ ] **Step 7: Run the registry guard test**

```bash
pnpm --filter @workspace/api-server test -- account-data
```

Expected: PASS. The guard walks the drizzle schema, so a missing registration or a wrong delete order fails here.

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/db/src/schema/campaigns.ts lib/db/src/schema/questlines.ts lib/db/src/schema/index.ts lib/db/drizzle artifacts/api-server/src/lib/account-data.ts
git commit -m "feat(campaigns): campaigns table + questline chapter columns"
```

---

### Task 2: Pure campaign logic

**Files:**
- Create: `artifacts/api-server/src/lib/campaigns.ts`
- Test: `artifacts/api-server/src/lib/campaigns.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `computeCampaignProgress(chapters: { status: string }[]): { total: number; done: number }`
  - `isCampaignReadyToClaim(campaign: { status: string }, progress: { total: number; done: number }): boolean`
  - `computeCampaignRewardXp(chapterCount: number): number`
  - `nextChapter<T extends { status: string; chapterOrder: number | null }>(chapters: T[]): T | null`
  - `renumber(orderedIds: number[]): { id: number; chapterOrder: number }[]`
  - `CAMPAIGN_XP_PER_CHAPTER = 50`, `CAMPAIGN_XP_CHAPTER_CAP = 5`

- [ ] **Step 1: Write the failing tests**

```typescript
// artifacts/api-server/src/lib/campaigns.test.ts
import { describe, it, expect } from "vitest";
import {
  computeCampaignProgress,
  isCampaignReadyToClaim,
  computeCampaignRewardXp,
  nextChapter,
  renumber,
} from "./campaigns";

describe("computeCampaignProgress", () => {
  it("counts chapters and completed chapters", () => {
    expect(computeCampaignProgress([{ status: "completed" }, { status: "active" }, { status: "completed" }]))
      .toEqual({ total: 3, done: 2 });
  });
  it("returns zeros for a chapter-less campaign", () => {
    expect(computeCampaignProgress([])).toEqual({ total: 0, done: 0 });
  });
});

describe("isCampaignReadyToClaim", () => {
  it("is ready when running with >=1 chapter, all completed", () => {
    expect(isCampaignReadyToClaim({ status: "running" }, { total: 3, done: 3 })).toBe(true);
  });
  it("is not ready while chapters remain", () => {
    expect(isCampaignReadyToClaim({ status: "running" }, { total: 3, done: 2 })).toBe(false);
  });
  it("is not ready when chapter-less", () => {
    expect(isCampaignReadyToClaim({ status: "running" }, { total: 0, done: 0 })).toBe(false);
  });
  it("is not ready when set aside", () => {
    expect(isCampaignReadyToClaim({ status: "set_aside" }, { total: 2, done: 2 })).toBe(false);
  });
  it("is not ready when already completed", () => {
    expect(isCampaignReadyToClaim({ status: "completed" }, { total: 2, done: 2 })).toBe(false);
  });
});

describe("computeCampaignRewardXp", () => {
  it("pays 50 per chapter", () => {
    expect(computeCampaignRewardXp(3)).toBe(150);
  });
  it("caps at 5 chapters (250 XP)", () => {
    expect(computeCampaignRewardXp(9)).toBe(250);
  });
  it("pays nothing for a chapter-less campaign", () => {
    expect(computeCampaignRewardXp(0)).toBe(0);
  });
  it("never returns a negative payout", () => {
    expect(computeCampaignRewardXp(-4)).toBe(0);
  });
});

describe("nextChapter", () => {
  const ch = (id: number, order: number | null, status = "active") => ({ id, chapterOrder: order, status });

  it("returns the first incomplete chapter by order, not by array position", () => {
    expect(nextChapter([ch(3, 2), ch(1, 0, "completed"), ch(2, 1)])?.id).toBe(2);
  });
  it("returns null when every chapter is completed", () => {
    expect(nextChapter([ch(1, 0, "completed"), ch(2, 1, "completed")])).toBeNull();
  });
  it("returns null for no chapters", () => {
    expect(nextChapter([])).toBeNull();
  });
  it("sorts null order last so an unordered chapter never hijacks the pointer", () => {
    expect(nextChapter([ch(9, null), ch(4, 1)])?.id).toBe(4);
  });
});

describe("renumber", () => {
  it("assigns dense zero-based order in the given sequence", () => {
    expect(renumber([7, 3, 9])).toEqual([
      { id: 7, chapterOrder: 0 },
      { id: 3, chapterOrder: 1 },
      { id: 9, chapterOrder: 2 },
    ]);
  });
  it("drops duplicate ids, keeping first position", () => {
    expect(renumber([5, 5, 8])).toEqual([
      { id: 5, chapterOrder: 0 },
      { id: 8, chapterOrder: 1 },
    ]);
  });
  it("returns an empty list unchanged", () => {
    expect(renumber([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @workspace/api-server test -- campaigns
```

Expected: FAIL — `Failed to resolve import "./campaigns"`.

- [ ] **Step 3: Write the implementation**

```typescript
// artifacts/api-server/src/lib/campaigns.ts
// Act VI Quest Campaigns: the tier above questlines. Pure — no I/O.
// Mirrors lib/questlines.ts in style and in its central rule: readiness is
// DERIVED from the chapters, never stored on the row.

/** 50 XP per chapter, capped at 5 chapters. Deliberately modest: the same work
 * already pays per-quest XP and a per-questline claim (up to 200). */
export const CAMPAIGN_XP_PER_CHAPTER = 50;
export const CAMPAIGN_XP_CHAPTER_CAP = 5;

/** Roll up chapter (questline) completion counts for a campaign. */
export function computeCampaignProgress(
  chapters: { status: string }[],
): { total: number; done: number } {
  const total = chapters.length;
  const done = chapters.reduce((n, c) => n + (c.status === "completed" ? 1 : 0), 0);
  return { total, done };
}

/** Claimable only while running, holding at least one chapter, all chapters done. */
export function isCampaignReadyToClaim(
  campaign: { status: string },
  progress: { total: number; done: number },
): boolean {
  return campaign.status === "running" && progress.total >= 1 && progress.done === progress.total;
}

/** One-time payout. Clamped at zero — XP monotonicity is a standing guard. */
export function computeCampaignRewardXp(chapterCount: number): number {
  const chapters = Math.max(0, Math.min(chapterCount, CAMPAIGN_XP_CHAPTER_CAP));
  return chapters * CAMPAIGN_XP_PER_CHAPTER;
}

/** The "current chapter" pointer: first not-completed chapter in story order.
 * Chapters with a null order sort last so an unordered adoptee never hijacks it.
 * This drives display only — chapters are ORDERED BUT NEVER GATED. */
export function nextChapter<T extends { status: string; chapterOrder: number | null }>(
  chapters: T[],
): T | null {
  const pending = chapters.filter((c) => c.status !== "completed");
  if (pending.length === 0) return null;
  const sorted = [...pending].sort((a, b) => {
    const ao = a.chapterOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.chapterOrder ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
  return sorted[0] ?? null;
}

/** Normalize an ordered id list to dense zero-based positions. Used by reorder,
 * detach, and delete so two rows can never disagree about position. */
export function renumber(orderedIds: number[]): { id: number; chapterOrder: number }[] {
  const seen = new Set<number>();
  const unique = orderedIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  return unique.map((id, i) => ({ id, chapterOrder: i }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @workspace/api-server test -- campaigns
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/campaigns.ts artifacts/api-server/src/lib/campaigns.test.ts
git commit -m "feat(campaigns): pure campaign progress, readiness, reward, ordering"
```

---

### Task 3: Curated story arcs and the fallback selector

**Files:**
- Create: `artifacts/api-server/src/lib/campaign-arc.ts`
- Test: `artifacts/api-server/src/lib/campaign-arc.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `type Arc = { arcPremise: string; endingBeat: string; chapterBeats: string[] }`
  - `CURATED_ARCS: readonly { key: string; premise: string; ending: string; beats: readonly string[] }[]`
  - `curatedArc(chapterCount: number, pick?: number): Arc`
  - `MIN_CHAPTERS = 3`, `MAX_CHAPTERS = 5`

- [ ] **Step 1: Write the failing tests**

```typescript
// artifacts/api-server/src/lib/campaign-arc.test.ts
import { describe, it, expect } from "vitest";
import { curatedArc, CURATED_ARCS, MIN_CHAPTERS, MAX_CHAPTERS } from "./campaign-arc";

describe("CURATED_ARCS", () => {
  it("ships at least three arcs", () => {
    expect(CURATED_ARCS.length).toBeGreaterThanOrEqual(3);
  });
  it("gives every arc enough beats for the maximum chapter count", () => {
    for (const arc of CURATED_ARCS) {
      expect(arc.beats.length).toBeGreaterThanOrEqual(MAX_CHAPTERS);
    }
  });
  it("never names a goal it cannot know", () => {
    // Curated prose must read correctly without knowing the user's goal.
    for (const arc of CURATED_ARCS) {
      const text = [arc.premise, arc.ending, ...arc.beats].join(" ");
      expect(text).not.toMatch(/\{|\}|%s|GOAL/i);
    }
  });
});

describe("curatedArc", () => {
  it("returns exactly the requested number of chapter beats", () => {
    expect(curatedArc(4).chapterBeats).toHaveLength(4);
  });
  it("is deterministic for the same pick", () => {
    expect(curatedArc(3, 1)).toEqual(curatedArc(3, 1));
  });
  it("selects different arcs for different picks", () => {
    expect(curatedArc(3, 0).arcPremise).not.toBe(curatedArc(3, 1).arcPremise);
  });
  it("wraps out-of-range picks instead of throwing", () => {
    expect(curatedArc(3, 99).chapterBeats).toHaveLength(3);
    expect(curatedArc(3, -1).chapterBeats).toHaveLength(3);
  });
  it("clamps chapter counts below the minimum", () => {
    expect(curatedArc(0).chapterBeats).toHaveLength(MIN_CHAPTERS);
  });
  it("clamps chapter counts above the maximum", () => {
    expect(curatedArc(50).chapterBeats).toHaveLength(MAX_CHAPTERS);
  });
  it("always supplies a premise and an ending", () => {
    const arc = curatedArc(5);
    expect(arc.arcPremise.length).toBeGreaterThan(0);
    expect(arc.endingBeat.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @workspace/api-server test -- campaign-arc
```

Expected: FAIL — cannot resolve `./campaign-arc`.

- [ ] **Step 3: Write the implementation**

```typescript
// artifacts/api-server/src/lib/campaign-arc.ts
// Act VI Quest Campaigns: hand-written story arcs. Pure — no I/O, no AI.
// These are the FALLBACK PATH, not an error path: campaign creation must never
// fail because the model is unavailable. Prose is deliberately goal-agnostic so
// it reads correctly without knowing what the user is actually working on.

export const MIN_CHAPTERS = 3;
export const MAX_CHAPTERS = 5;

export interface Arc {
  arcPremise: string;
  endingBeat: string;
  chapterBeats: string[];
}

export const CURATED_ARCS = [
  {
    key: "the_long_haul",
    premise: "Some roads are walked, not sprinted. This one is yours, and it is long enough to be worth walking.",
    ending: "The road ends where you stand. You walked all of it, on the days it was easy and the days it wasn't.",
    beats: [
      "The first stretch is behind you. That was the part most people never start.",
      "You have found your pace. The road stops fighting you.",
      "The middle miles — quiet, unglamorous, and the ones that actually carry you.",
      "The ground begins to rise. You are further along than the view suggests.",
      "The last stretch is in sight, and you already know how to walk it.",
    ],
  },
  {
    key: "the_reclamation",
    premise: "Something here was yours before it slipped out of reach. This is the work of taking it back.",
    ending: "It's yours again. Not because it was returned to you, but because you went and got it.",
    beats: [
      "The first corner is reclaimed. Small, but unmistakably yours again.",
      "What was scattered is starting to hold a shape.",
      "The hard middle: the part that was always going to take real work.",
      "More of it is yours now than isn't.",
      "Only the edges remain, and edges go quickly.",
    ],
  },
  {
    key: "the_steady_climb",
    premise: "No summit is taken in one move. It is taken in the ordinary steps nobody claps for.",
    ending: "You're at the top. It was never one heroic push — it was every ordinary step you took.",
    beats: [
      "The climb has begun. The first ledge always looks smaller from above.",
      "Height gained. Look back once — then keep going.",
      "The steep section, met and passed.",
      "The air is thinner here, and you are still climbing.",
      "The summit is one honest push away.",
    ],
  },
  {
    key: "the_open_workshop",
    premise: "Nothing worth having arrives finished. This is the bench where it gets built, piece by piece.",
    ending: "It's built. It exists because you kept coming back to the bench.",
    beats: [
      "The bench is cleared and the first piece is cut. Work can begin.",
      "The frame holds. What was an idea now has edges.",
      "The fiddly middle work — the part that decides whether it lasts.",
      "It looks like the thing it was meant to be.",
      "Final fittings. Everything from here is finish work.",
    ],
  },
] as const;

/** Positive modulo so negative picks wrap instead of throwing. */
function wrapIndex(pick: number, length: number): number {
  return ((Math.trunc(pick) % length) + length) % length;
}

/** A curated arc trimmed to the requested chapter count. Deterministic: the same
 * (count, pick) always yields the same text. */
export function curatedArc(chapterCount: number, pick = 0): Arc {
  const arc = CURATED_ARCS[wrapIndex(pick, CURATED_ARCS.length)]!;
  const count = Math.max(MIN_CHAPTERS, Math.min(chapterCount, MAX_CHAPTERS));
  return {
    arcPremise: arc.premise,
    endingBeat: arc.ending,
    chapterBeats: arc.beats.slice(0, count),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @workspace/api-server test -- campaign-arc
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/campaign-arc.ts artifacts/api-server/src/lib/campaign-arc.test.ts
git commit -m "feat(campaigns): curated story arcs as a first-class fallback"
```

---

### Task 4: AI arc drafting

**Files:**
- Create: `artifacts/api-server/src/lib/ai/campaign-arc.ts`
- Test: `artifacts/api-server/src/lib/ai/campaign-arc.test.ts`
- Read first: `artifacts/api-server/src/lib/ai/questline-quests.ts` (the pattern this mirrors)

**Interfaces:**
- Consumes: `GenerateJson` from `./task-breakdown`; `MIN_CHAPTERS`/`MAX_CHAPTERS` from `../campaign-arc`.
- Produces:
  - `class CampaignArcParseError extends Error`
  - `buildCampaignArcPrompt(goal: string): string`
  - `parseCampaignArc(raw: unknown): { arcPremise: string; endingBeat: string; chapters: { title: string; beat: string }[] }`
  - `suggestCampaignArc(goal: string, generate: GenerateJson): Promise<...same shape...>`
  - `MAX_TITLE_LENGTH = 120`, `MAX_BEAT_LENGTH = 240`, `MAX_PREMISE_LENGTH = 320`

- [ ] **Step 1: Write the failing tests**

```typescript
// artifacts/api-server/src/lib/ai/campaign-arc.test.ts
import { describe, it, expect } from "vitest";
import {
  buildCampaignArcPrompt,
  parseCampaignArc,
  suggestCampaignArc,
  CampaignArcParseError,
  MAX_TITLE_LENGTH,
  MAX_BEAT_LENGTH,
} from "./campaign-arc";

const ok = {
  arcPremise: "A premise.",
  endingBeat: "An ending.",
  chapters: [
    { title: "Clear one shelf", beat: "It begins." },
    { title: "Sort the boxes", beat: "It builds." },
    { title: "Haul it out", beat: "It ends." },
  ],
};

describe("buildCampaignArcPrompt", () => {
  it("includes the goal", () => {
    expect(buildCampaignArcPrompt("make the garage usable")).toContain("make the garage usable");
  });
  it("states the chapter range and the JSON shape", () => {
    const p = buildCampaignArcPrompt("x");
    expect(p).toContain("3");
    expect(p).toContain("5");
    expect(p).toContain("arcPremise");
    expect(p).toContain("endingBeat");
  });
});

describe("parseCampaignArc", () => {
  it("accepts a well-formed arc", () => {
    expect(parseCampaignArc(ok).chapters).toHaveLength(3);
  });
  it("rejects a non-object", () => {
    expect(() => parseCampaignArc("nope")).toThrow(CampaignArcParseError);
  });
  it("rejects a missing chapters array", () => {
    expect(() => parseCampaignArc({ arcPremise: "a", endingBeat: "b" })).toThrow(CampaignArcParseError);
  });
  it("rejects fewer than three usable chapters", () => {
    expect(() => parseCampaignArc({ ...ok, chapters: ok.chapters.slice(0, 2) })).toThrow(CampaignArcParseError);
  });
  it("drops chapters with an empty title before counting", () => {
    const bad = { ...ok, chapters: [...ok.chapters.slice(0, 2), { title: "   ", beat: "x" }] };
    expect(() => parseCampaignArc(bad)).toThrow(CampaignArcParseError);
  });
  it("clamps to five chapters", () => {
    const many = { ...ok, chapters: Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, beat: `b${i}` })) };
    expect(parseCampaignArc(many).chapters).toHaveLength(5);
  });
  it("truncates over-long titles and beats", () => {
    const long = {
      ...ok,
      chapters: ok.chapters.map((c) => ({ title: "t".repeat(400), beat: "b".repeat(900) })),
    };
    const parsed = parseCampaignArc(long);
    expect(parsed.chapters[0]!.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(parsed.chapters[0]!.beat).toHaveLength(MAX_BEAT_LENGTH);
  });
  it("tolerates a missing beat by substituting an empty string", () => {
    const noBeat = { ...ok, chapters: ok.chapters.map((c) => ({ title: c.title })) };
    expect(parseCampaignArc(noBeat).chapters[0]!.beat).toBe("");
  });
  it("tolerates missing premise/ending by substituting empty strings", () => {
    const bare = { chapters: ok.chapters };
    const parsed = parseCampaignArc(bare);
    expect(parsed.arcPremise).toBe("");
    expect(parsed.endingBeat).toBe("");
  });
});

describe("suggestCampaignArc", () => {
  it("passes the prompt to the injected generator and parses the result", async () => {
    let seen = "";
    const generate = async (prompt: string) => { seen = prompt; return ok; };
    const arc = await suggestCampaignArc("tidy the loft", generate);
    expect(seen).toContain("tidy the loft");
    expect(arc.chapters).toHaveLength(3);
  });
  it("propagates a parse failure", async () => {
    const generate = async () => ({ nope: true });
    await expect(suggestCampaignArc("x", generate)).rejects.toBeInstanceOf(CampaignArcParseError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @workspace/api-server test -- ai/campaign-arc
```

Expected: FAIL — cannot resolve `./campaign-arc`.

- [ ] **Step 3: Write the implementation**

```typescript
// artifacts/api-server/src/lib/ai/campaign-arc.ts
// Act VI Quest Campaigns: draft a story arc over a real goal. Pure except for
// the injected generator, mirroring ai/questline-quests.ts. Output is
// SNAPSHOTTED to the campaign row at creation and never regenerated on read.
import type { GenerateJson } from "./task-breakdown";
import { MIN_CHAPTERS, MAX_CHAPTERS } from "../campaign-arc";

export const MAX_TITLE_LENGTH = 120;
export const MAX_BEAT_LENGTH = 240;
export const MAX_PREMISE_LENGTH = 320;

export class CampaignArcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignArcParseError";
  }
}

export interface DraftChapter { title: string; beat: string }
export interface DraftArc {
  arcPremise: string;
  endingBeat: string;
  chapters: DraftChapter[];
}

export function buildCampaignArcPrompt(goal: string): string {
  return `You help people with ADHD carry a long goal by telling it as a short story arc. Break the goal below into ${MIN_CHAPTERS}-${MAX_CHAPTERS} chapters, and write one line of story for each.

Rules:
- Each chapter TITLE is a concrete stage of the real work, written as a short present-tense imperative phrase.
- Order chapters from the easiest starting stage to later progress.
- The FIRST chapter must be a tiny, no-decision starting stage that still makes real progress.
- Each chapter BEAT is one sentence of warm narration for finishing that chapter. Never scold, never mention falling behind, never mention time passing or days missed.
- The arcPremise is one or two sentences on why this journey is worth walking. The endingBeat is one sentence for finishing the whole thing.
- No comfort rituals, warm-ups, or filler (never "get motivated", "make a plan to plan").
- Never use vague verbs like "organize", "work on", "deal with", or "handle" — name the specific stage.
- Do not restate the goal itself as a chapter.

Goal: ${goal}

Respond with JSON only, in this exact shape: {"arcPremise": "...", "endingBeat": "...", "chapters": [{"title": "...", "beat": "..."}]}`;
}

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t;
}

export function parseCampaignArc(raw: unknown): DraftArc {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { chapters?: unknown }).chapters)) {
    throw new CampaignArcParseError("Model output did not match { chapters: [...] }");
  }
  const src = raw as { arcPremise?: unknown; endingBeat?: unknown; chapters: unknown[] };

  const chapters: DraftChapter[] = src.chapters
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ title: str(c.title, MAX_TITLE_LENGTH), beat: str(c.beat, MAX_BEAT_LENGTH) }))
    .filter((c) => c.title.length > 0)
    .slice(0, MAX_CHAPTERS);

  if (chapters.length < MIN_CHAPTERS) {
    throw new CampaignArcParseError(
      `Expected at least ${MIN_CHAPTERS} chapters, got ${chapters.length}`,
    );
  }

  return {
    arcPremise: str(src.arcPremise, MAX_PREMISE_LENGTH),
    endingBeat: str(src.endingBeat, MAX_BEAT_LENGTH),
    chapters,
  };
}

export async function suggestCampaignArc(goal: string, generate: GenerateJson): Promise<DraftArc> {
  const raw = await generate(buildCampaignArcPrompt(goal));
  return parseCampaignArc(raw);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @workspace/api-server test -- ai/campaign-arc
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/ai/campaign-arc.ts artifacts/api-server/src/lib/ai/campaign-arc.test.ts
git commit -m "feat(campaigns): AI arc prompt, parser, and suggest seam"
```

---

### Task 5: Feature gate — the `campaigns` key at L4

**Files:**
- Modify: `artifacts/api-server/src/lib/feature-gates.ts`, `artifacts/focusquest/src/lib/feature-gates.ts`
- Test: `artifacts/api-server/src/lib/feature-gates.test.ts`, `artifacts/focusquest/src/lib/feature-gates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FeatureKey` gains `"campaigns"` on both sides; `FEATURE_GATES.campaigns = 4`.

**Note:** the server's `FEATURE_KEYS` comment currently claims keys equal client `NavGroupKey` values. `campaigns` is the first key that gates a *tab* rather than a nav group, so both comments must be corrected — a stale comment here is how the next person breaks the invariant.

- [ ] **Step 1: Write the failing server test**

Append to `artifacts/api-server/src/lib/feature-gates.test.ts`:

```typescript
describe("campaigns gate (Act VI Quest Campaigns)", () => {
  const user = (totalPoints: number) => ({ totalPoints, highestLevel: 0, unlockAll: false });

  it("is locked below level 4", () => {
    expect(isFeatureUnlocked(user(0), "campaigns")).toBe(false);
  });
  it("unlocks at the same band as progress", () => {
    expect(FEATURE_GATES.campaigns).toBe(FEATURE_GATES.progress);
  });
  it("is included for grandfathered users", () => {
    expect(unlockedFeatures({ totalPoints: 0, highestLevel: 0, unlockAll: true })).toContain("campaigns");
  });
});
```

Ensure the file's import line includes `FEATURE_GATES`, `isFeatureUnlocked`, and `unlockedFeatures`.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @workspace/api-server test -- feature-gates
```

Expected: FAIL — `"campaigns"` is not assignable to `FeatureKey` / `FEATURE_GATES.campaigns` is undefined.

- [ ] **Step 3: Add the key on the server**

In `artifacts/api-server/src/lib/feature-gates.ts`, replace the header comment's last sentence and the two constants:

```typescript
// Keys mostly equal the client's NavGroupKey values (home/quests are always-on
// and never listed). EXCEPTION since Act VI Quest Campaigns: `campaigns` gates a
// TAB inside the always-on quests group, not a nav group of its own — the client
// maps it explicitly rather than by key equality.
export const FEATURE_KEYS = ["focus", "hero", "progress", "allies", "rewards", "campaigns"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_GATES: Record<FeatureKey, number> = {
  focus: 2, hero: 3, progress: 4, allies: 5, rewards: 6, campaigns: 4,
};
```

- [ ] **Step 4: Run the server test to verify it passes**

```bash
pnpm --filter @workspace/api-server test -- feature-gates
```

Expected: PASS.

- [ ] **Step 5: Write the failing client test**

Append to `artifacts/focusquest/src/lib/feature-gates.test.ts`:

```typescript
describe("campaigns gate", () => {
  it("hides campaigns below L4", () => {
    expect(isUnlocked(["focus", "hero"], "campaigns")).toBe(false);
  });
  it("shows campaigns when the server lists it", () => {
    expect(isUnlocked(["focus", "hero", "progress", "campaigns"], "campaigns")).toBe(true);
  });
  it("fails open when the list is absent (offline shell)", () => {
    expect(isUnlocked(undefined, "campaigns")).toBe(true);
  });
  it("gates the campaign routes", () => {
    expect(routeFeature("/campaigns")).toBe("campaigns");
    expect(routeFeature("/campaigns/12")).toBe("campaigns");
  });
  it("labels the unlock celebration with a real word", () => {
    expect(featureLabel("campaigns")).toBe("Campaigns");
  });
});
```

Ensure the import line includes `routeFeature` and `featureLabel`.

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm --filter @workspace/focusquest test -- feature-gates
```

Expected: FAIL — `routeFeature("/campaigns")` returns null and `featureLabel` returns `"campaigns"`.

- [ ] **Step 7: Update the client mirror**

In `artifacts/focusquest/src/lib/feature-gates.ts`, make these three edits:

```typescript
export type FeatureKey = "focus" | "hero" | "progress" | "allies" | "rewards" | "campaigns";
```

```typescript
const ROUTE_FEATURES: ReadonlyArray<{ prefix: string; feature: FeatureKey }> = [
  { prefix: "/focus", feature: "focus" },
  { prefix: "/avatar", feature: "hero" },
  { prefix: "/progress", feature: "progress" },
  { prefix: "/insights", feature: "progress" },
  { prefix: "/partners", feature: "allies" },
  { prefix: "/leaderboard", feature: "allies" },
  { prefix: "/rewards", feature: "rewards" },
  { prefix: "/campaigns", feature: "campaigns" },
];
```

```typescript
// Labels for keys that are NOT nav groups (Quest Campaigns gates a tab inside
// the always-on quests group), falling back to the nav group's own label.
const EXTRA_LABELS: Record<string, string> = { campaigns: "Campaigns" };

/** Label for the unlock celebration — the same word the UI will show. */
export function featureLabel(key: string): string {
  return EXTRA_LABELS[key] ?? NAV_GROUPS.find((g) => g.key === key)?.label ?? key;
}
```

- [ ] **Step 8: Run the client test to verify it passes**

```bash
pnpm --filter @workspace/focusquest test -- feature-gates
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add artifacts/api-server/src/lib/feature-gates.ts artifacts/api-server/src/lib/feature-gates.test.ts artifacts/focusquest/src/lib/feature-gates.ts artifacts/focusquest/src/lib/feature-gates.test.ts
git commit -m "feat(campaigns): Gentle Door campaigns key at L4"
```

---

### Task 6: OpenAPI contract and generated clients

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Generated (do not hand-edit): `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`

**Interfaces:**
- Consumes: nothing.
- Produces: operations `getCampaigns`, `createCampaign`, `getCampaign`, `updateCampaign`, `deleteCampaign`, `reorderCampaignChapters`, `claimCampaign`, `suggestCampaignArc`; schemas `Campaign`, `CampaignChapter`, `CampaignDetail`, `CampaignInput`, `CampaignUpdate`, `CampaignChaptersInput`, `CampaignClaimResult`, `SuggestCampaignArcInput`, `SuggestedCampaignArc`; hooks `useGetCampaigns`, `useCreateCampaign`, `useGetCampaign`, `useUpdateCampaign`, `useDeleteCampaign`, `useReorderCampaignChapters`, `useClaimCampaign`, `useSuggestCampaignArc` + `getGetCampaignsQueryKey`, `getGetCampaignQueryKey`.

**Gotcha:** orval names an inline request-body zod const and its TS type identically → collision. Every request body below is a named `$ref`. Never inline one.

- [ ] **Step 1: Add the tag**

In `lib/api-spec/openapi.yaml`, after the `questlines` tag entry (~line 31):

```yaml
  - name: campaigns
    description: Long-horizon goals told as an ordered story arc over questlines
```

- [ ] **Step 2: Add the paths**

Insert immediately after the `/questlines/suggest-quests` block:

```yaml
  /campaigns:
    get:
      operationId: getCampaigns
      tags: [campaigns]
      summary: List the current user's campaigns with derived chapter progress
      responses:
        "200":
          description: Campaign list
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Campaign"
    post:
      operationId: createCampaign
      tags: [campaigns]
      summary: Create a campaign, atomically seeding its chapter questlines
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CampaignInput"
      responses:
        "201":
          description: Created campaign
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Campaign"
        "409":
          description: Another campaign is already running
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /campaigns/{id}:
    get:
      operationId: getCampaign
      tags: [campaigns]
      summary: Get one campaign with its ordered chapters
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Campaign with chapters
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CampaignDetail"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
    patch:
      operationId: updateCampaign
      tags: [campaigns]
      summary: Update a campaign's title/story, or set it aside / resume it
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CampaignUpdate"
      responses:
        "200":
          description: Updated campaign
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Campaign"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "409":
          description: Another campaign is already running
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
    delete:
      operationId: deleteCampaign
      tags: [campaigns]
      summary: Delete a campaign (its chapters are unlinked, never deleted)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted

  /campaigns/{id}/chapters:
    patch:
      operationId: reorderCampaignChapters
      tags: [campaigns]
      summary: Set the full ordered chapter list for a campaign
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CampaignChaptersInput"
      responses:
        "200":
          description: Campaign with reordered chapters
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CampaignDetail"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /campaigns/{id}/claim:
    post:
      operationId: claimCampaign
      tags: [campaigns]
      summary: Claim the reward for a campaign whose chapters are all complete
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Reward claimed
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CampaignClaimResult"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "409":
          description: Not ready to claim, or already completed
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /campaigns/suggest-arc:
    post:
      operationId: suggestCampaignArc
      tags: [campaigns]
      summary: Draft a story arc for a goal (AI, creates nothing)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SuggestCampaignArcInput"
      responses:
        "200":
          description: Drafted arc. Always returns an arc — curated when AI is unavailable.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuggestedCampaignArc"
        "429":
          description: Cooldown — a curated arc is returned instead by the client
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

- [ ] **Step 3: Add the schemas**

Insert immediately after the `QuestlineInput` schema block in `components.schemas`:

```yaml
    Campaign:
      type: object
      required: [id, userId, title, status, storySource, total, done, ready, createdAt]
      properties:
        id:
          type: integer
        userId:
          type: integer
        title:
          type: string
        arcPremise:
          type: ["string", "null"]
        endingBeat:
          type: ["string", "null"]
        storySource:
          type: string
          enum: [ai, curated]
        status:
          type: string
          enum: [running, set_aside, completed]
        total:
          type: integer
          description: Number of chapters
        done:
          type: integer
          description: Number of completed chapters
        ready:
          type: boolean
          description: True when running, non-empty, and every chapter is completed
        rewardXpAwarded:
          type: ["integer", "null"]
        completedAt:
          type: ["string", "null"]
        createdAt:
          type: string

    CampaignChapter:
      type: object
      required: [questlineId, title, status, total, done]
      properties:
        questlineId:
          type: integer
        title:
          type: string
        chapterOrder:
          type: ["integer", "null"]
        chapterBeat:
          type: ["string", "null"]
        status:
          type: string
          enum: [active, completed]
        total:
          type: integer
        done:
          type: integer

    CampaignDetail:
      type: object
      required: [campaign, chapters]
      properties:
        campaign:
          $ref: "#/components/schemas/Campaign"
        chapters:
          type: array
          items:
            $ref: "#/components/schemas/CampaignChapter"
        currentChapterId:
          type: ["integer", "null"]
          description: Questline id of the first incomplete chapter. Display only — chapters are never gated.

    CampaignInput:
      type: object
      required: [title]
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 120
        arcPremise:
          type: ["string", "null"]
        endingBeat:
          type: ["string", "null"]
        storySource:
          type: string
          enum: [ai, curated]
        chapters:
          type: array
          description: Chapter questlines to create atomically. Empty is legal (adopt-only path).
          items:
            type: object
            required: [title]
            properties:
              title:
                type: string
                maxLength: 120
              beat:
                type: ["string", "null"]
              questTitles:
                type: array
                items:
                  type: string

    CampaignUpdate:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 120
        arcPremise:
          type: ["string", "null"]
        endingBeat:
          type: ["string", "null"]
        status:
          type: string
          enum: [running, set_aside]

    CampaignChaptersInput:
      type: object
      required: [questlineIds]
      properties:
        questlineIds:
          type: array
          description: Full ordered chapter list. Anything omitted is detached.
          items:
            type: integer

    CampaignClaimResult:
      type: object
      required: [campaign, xpAwarded, totalPoints, currentLevel, levelName, leveledUp]
      properties:
        campaign:
          $ref: "#/components/schemas/Campaign"
        endingBeat:
          type: ["string", "null"]
        xpAwarded:
          type: integer
        totalPoints:
          type: integer
        currentLevel:
          type: integer
        levelName:
          type: string
        leveledUp:
          type: boolean
        newlyUnlocked:
          type: array
          items:
            $ref: "#/components/schemas/FeatureKey"

    SuggestCampaignArcInput:
      type: object
      required: [goal]
      properties:
        goal:
          type: string
          minLength: 1
          maxLength: 200

    SuggestedCampaignArc:
      type: object
      required: [arcPremise, endingBeat, chapters, source]
      properties:
        arcPremise:
          type: string
        endingBeat:
          type: string
        source:
          type: string
          enum: [ai, curated]
          description: Curated means the model was unavailable — creation still proceeds.
        chapters:
          type: array
          items:
            type: object
            required: [title, beat]
            properties:
              title:
                type: string
              beat:
                type: string
```

- [ ] **Step 4: Extend the two enums**

`FeatureKey` (~line 2669) — add `campaigns`:

```yaml
    FeatureKey:
      type: string
      description: Gentle Door progressive-unlock feature groups (campaigns gates a tab, not a nav group)
      enum: [focus, hero, progress, allies, rewards, campaigns]
```

`ActivityItem.type` (~line 3613) — append `campaign_complete`. Note `questline_complete` is missing today and is inserted here too, since the route already writes it. There is deliberately **no `campaign_chapter` value**: chapters ARE questlines, so a chapter clear already writes `questline_complete` — a second row would double-report the same work in the feed and fire ally cheers twice (controller ruling, 2026-07-22):

```yaml
          enum: [task_completed, badge_earned, level_up, streak_milestone, all_day_bonus, streak_freeze_bought, streak_freeze_used, gear_bought, gear_earned, focus_session, focus_complete, initiation, reflection, body_double, questline_complete, campaign_complete]
```

- [ ] **Step 5: Add chapter fields to the Questline schema**

In the `Questline` schema (~line 3097), add three optional properties after `createdAt`:

```yaml
        campaignId:
          type: ["integer", "null"]
        chapterOrder:
          type: ["integer", "null"]
        chapterBeat:
          type: ["string", "null"]
```

And in `QuestlineUpdate`, add:

```yaml
        campaignId:
          type: ["integer", "null"]
        chapterOrder:
          type: ["integer", "null"]
```

- [ ] **Step 6: Regenerate the clients**

```bash
pnpm --filter @workspace/api-spec codegen
```

Expected: new files under `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`, including `useGetCampaigns` and `campaign*` types.

- [ ] **Step 7: Verify the hooks exist**

```bash
grep -rl "useClaimCampaign\|useSuggestCampaignArc" lib/api-client-react/src/generated | head
```

Expected: at least one matching file.

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors (nothing consumes the new hooks yet).

- [ ] **Step 9: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(campaigns): OpenAPI contract + generated clients"
```

---

### Task 7: Campaign routes

**Files:**
- Create: `artifacts/api-server/src/routes/campaigns.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/lib/ally-milestones.ts`
- Read first: `artifacts/api-server/src/routes/questlines.ts` (the claim transaction being mirrored)

**Interfaces:**
- Consumes: `computeCampaignProgress`, `isCampaignReadyToClaim`, `computeCampaignRewardXp`, `nextChapter`, `renumber` (Task 2); `curatedArc`, `MIN_CHAPTERS`, `MAX_CHAPTERS` (Task 3); `suggestCampaignArc`, `CampaignArcParseError` (Task 4); `campaignsTable` (Task 1); existing `assignPoints`, `getLevelInfo`, `newlyUnlocked`, `isAiConfigured`, `generateJson`, `AiClientError`, `suggestCooldown`, `logger`.
- Produces: `formatCampaign(row, progress)`; default-exported router.

- [ ] **Step 1: Add the milestone type**

In `artifacts/api-server/src/lib/ally-milestones.ts`, add `"campaign_complete"` to `MILESTONE_TYPES` after `"questline_complete"`. Then run:

```bash
pnpm --filter @workspace/api-server test -- ally-milestones
```

Expected: PASS (existing tests are list-agnostic; if one asserts an exact length, update that number).

- [ ] **Step 2: Write the routes file**

```typescript
// artifacts/api-server/src/routes/campaigns.ts
// Act VI Quest Campaigns: the tier above questlines. Thin orchestration — every
// decision lives in lib/campaigns.ts, lib/campaign-arc.ts, lib/ai/campaign-arc.ts.
// Chapters are ORDERED BUT NEVER GATED: nothing here hides or blocks a quest.
import { Router, type IRouter } from "express";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import {
  db, campaignsTable, questlinesTable, tasksTable, usersTable, activityTable,
  type Campaign,
} from "@workspace/db";
import {
  computeCampaignProgress, isCampaignReadyToClaim, computeCampaignRewardXp,
  nextChapter, renumber,
} from "../lib/campaigns";
import { curatedArc, MIN_CHAPTERS, MAX_CHAPTERS } from "../lib/campaign-arc";
import { suggestCampaignArc, CampaignArcParseError } from "../lib/ai/campaign-arc";
import { computeProgress } from "../lib/questlines";
import { getLevelInfo } from "../lib/gamification";
import { newlyUnlocked, type FeatureKey } from "../lib/feature-gates";
import { assignPoints } from "../lib/auto-points";
import { isAiConfigured, generateJson, AiClientError } from "../lib/ai/client";
import { suggestCooldown } from "../lib/ai/suggest-cooldown";
import { sanitizeQuestTitles } from "../lib/ai/questline-quests";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Postgres unique-violation, walked through the driver's cause chain — the
 * same technique lib/rename.ts uses. Our only unique index is the
 * one-running-campaign-per-user partial index. */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e === "object" && (e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export function formatCampaign(row: Campaign, progress: { total: number; done: number }) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    arcPremise: row.arcPremise,
    endingBeat: row.endingBeat,
    storySource: row.storySource,
    status: row.status,
    total: progress.total,
    done: progress.done,
    ready: isCampaignReadyToClaim(row, progress),
    rewardXpAwarded: row.rewardXpAwarded ?? null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(s ?? "", 10);
  return isNaN(id) ? null : id;
}

/** Chapters of one campaign, ordered, with each chapter's own quest progress. */
async function loadChapters(campaignId: number, userId: number) {
  const rows = await db.select().from(questlinesTable)
    .where(and(eq(questlinesTable.campaignId, campaignId), eq(questlinesTable.userId, userId)))
    .orderBy(asc(questlinesTable.chapterOrder), asc(questlinesTable.id));

  const ids = rows.map((r) => r.id);
  const quests = ids.length
    ? await db.select({ questlineId: tasksTable.questlineId, completed: tasksTable.completed })
        .from(tasksTable).where(inArray(tasksTable.questlineId, ids))
    : [];

  const byQuestline = new Map<number, { completed: boolean }[]>();
  for (const q of quests) {
    if (q.questlineId == null) continue;
    const arr = byQuestline.get(q.questlineId) ?? [];
    arr.push({ completed: q.completed });
    byQuestline.set(q.questlineId, arr);
  }

  return rows.map((r) => {
    const p = computeProgress(byQuestline.get(r.id) ?? []);
    return {
      questlineId: r.id,
      title: r.title,
      chapterOrder: r.chapterOrder,
      chapterBeat: r.chapterBeat,
      status: r.status,
      total: p.total,
      done: p.done,
    };
  });
}

// List campaigns with derived chapter progress. One extra query pulls all
// chapters, then progress is grouped in-memory (no N+1).
router.get("/campaigns", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const rows = await db.select().from(campaignsTable)
    .where(eq(campaignsTable.userId, userId))
    .orderBy(desc(campaignsTable.createdAt));

  const ids = rows.map((r) => r.id);
  const chapters = ids.length
    ? await db.select({ campaignId: questlinesTable.campaignId, status: questlinesTable.status })
        .from(questlinesTable).where(inArray(questlinesTable.campaignId, ids))
    : [];

  const byCampaign = new Map<number, { status: string }[]>();
  for (const c of chapters) {
    if (c.campaignId == null) continue;
    const arr = byCampaign.get(c.campaignId) ?? [];
    arr.push({ status: c.status });
    byCampaign.set(c.campaignId, arr);
  }

  res.json(rows.map((r) => formatCampaign(r, computeCampaignProgress(byCampaign.get(r.id) ?? []))));
});

// Create a campaign and (optionally) its chapter questlines + quests, atomically.
// Zero chapters is legal: that is the adopt-only path.
router.post("/campaigns", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, arcPremise, endingBeat, storySource, chapters } = req.body as {
    title?: string; arcPremise?: string | null; endingBeat?: string | null;
    storySource?: string;
    chapters?: { title?: string; beat?: string | null; questTitles?: string[] }[];
  };
  if (!title || !title.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const cleanChapters = (Array.isArray(chapters) ? chapters : [])
    .map((c) => ({
      title: typeof c.title === "string" ? c.title.trim() : "",
      beat: typeof c.beat === "string" ? c.beat : null,
      questTitles: Array.isArray(c.questTitles) ? sanitizeQuestTitles(c.questTitles) : [],
    }))
    .filter((c) => c.title.length > 0)
    .slice(0, MAX_CHAPTERS);

  try {
    const created = await db.transaction(async (tx) => {
      // Only one campaign runs at a time: stand the current one down first.
      // The partial unique index is the real guard; this keeps it from firing.
      await tx.update(campaignsTable)
        .set({ status: "set_aside", setAsideAt: new Date() })
        .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running")));

      const [campaign] = await tx.insert(campaignsTable).values({
        userId,
        title: title.trim(),
        arcPremise: arcPremise ?? null,
        endingBeat: endingBeat ?? null,
        storySource: storySource === "ai" ? "ai" : "curated",
      }).returning();

      for (const [i, ch] of cleanChapters.entries()) {
        const [questline] = await tx.insert(questlinesTable).values({
          userId,
          title: ch.title,
          description: null,
          color: null,
          campaignId: campaign.id,
          chapterOrder: i,
          chapterBeat: ch.beat,
        }).returning();

        if (ch.questTitles.length) {
          await tx.insert(tasksTable).values(
            ch.questTitles.map((t) => {
              const ap = assignPoints(t, "medium");
              return {
                userId, title: t, points: ap.points, category: ap.category,
                priority: "medium", dueDate: null, isAnchored: true,
                questlineId: questline.id,
              };
            }),
          );
        }
      }

      return campaign;
    });

    res.status(201).json(formatCampaign(created, { total: cleanChapters.length, done: 0 }));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Another campaign is already running" });
      return;
    }
    throw err;
  }
});

// One campaign with its ordered chapters.
router.get("/campaigns/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)));
  if (!row) { res.status(404).json({ error: "Campaign not found" }); return; }

  const chapters = await loadChapters(id, userId);
  const current = nextChapter(chapters);

  res.json({
    campaign: formatCampaign(row, computeCampaignProgress(chapters)),
    chapters,
    currentChapterId: current ? current.questlineId : null,
  });
});

// Edit title/story, or move between running and set aside.
router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const { title, arcPremise, endingBeat, status } = req.body as {
    title?: string; arcPremise?: string | null; endingBeat?: string | null; status?: string;
  };
  if (status != null && status !== "running" && status !== "set_aside") {
    res.status(400).json({ error: "status must be running or set_aside" });
    return;
  }

  const updates: Partial<typeof campaignsTable.$inferInsert> = {};
  if (title != null) {
    if (!title.trim()) { res.status(400).json({ error: "title cannot be empty" }); return; }
    updates.title = title.trim();
  }
  if (arcPremise !== undefined) updates.arcPremise = arcPremise;
  if (endingBeat !== undefined) updates.endingBeat = endingBeat;
  if (status != null) {
    updates.status = status;
    updates.setAsideAt = status === "set_aside" ? new Date() : null;
  }

  try {
    const row = await db.transaction(async (tx) => {
      // Resuming stands down whatever else was running (one at a time).
      if (status === "running") {
        await tx.update(campaignsTable)
          .set({ status: "set_aside", setAsideAt: new Date() })
          .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running")));
      }
      const [updated] = await tx.update(campaignsTable).set(updates)
        .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
        .returning();
      return updated;
    });
    if (!row) { res.status(404).json({ error: "Campaign not found" }); return; }

    const chapters = await loadChapters(id, userId);
    res.json(formatCampaign(row, computeCampaignProgress(chapters)));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Another campaign is already running" });
      return;
    }
    throw err;
  }
});

// Delete a campaign; the FK's ON DELETE SET NULL unlinks its chapters.
// The questlines and all their quests survive.
router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.delete(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Campaign not found" }); return; }

  res.sendStatus(204);
});

// Set the full ordered chapter list. Omitted questlines are detached — one
// write per row, from one computed sequence, so nothing can disagree on order.
router.patch("/campaigns/:id/chapters", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const { questlineIds } = req.body as { questlineIds?: unknown };
  if (!Array.isArray(questlineIds) || questlineIds.some((q) => typeof q !== "number")) {
    res.status(400).json({ error: "questlineIds must be an array of integers" });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  // Only questlines this user actually owns may become chapters.
  const owned = questlineIds.length
    ? await db.select({ id: questlinesTable.id }).from(questlinesTable)
        .where(and(inArray(questlinesTable.id, questlineIds as number[]), eq(questlinesTable.userId, userId)))
    : [];
  const ownedIds = new Set(owned.map((o) => o.id));
  const ordered = renumber((questlineIds as number[]).filter((q) => ownedIds.has(q)));

  await db.transaction(async (tx) => {
    // Detach everything currently attached, then re-attach the new sequence.
    await tx.update(questlinesTable)
      .set({ campaignId: null, chapterOrder: null })
      .where(and(eq(questlinesTable.campaignId, id), eq(questlinesTable.userId, userId)));

    for (const { id: questlineId, chapterOrder } of ordered) {
      await tx.update(questlinesTable)
        .set({ campaignId: id, chapterOrder })
        .where(and(eq(questlinesTable.id, questlineId), eq(questlinesTable.userId, userId)));
    }
  });

  const chapters = await loadChapters(id, userId);
  const current = nextChapter(chapters);
  res.json({
    campaign: formatCampaign(campaign, computeCampaignProgress(chapters)),
    chapters,
    currentChapterId: current ? current.questlineId : null,
  });
});

// Claim the one-time reward for a campaign whose chapters are all complete.
// Same lock order as the questline claim: user row, then the campaign row.
router.post("/campaigns/:id/claim", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  type Outcome =
    | { status: "not_found" }
    | { status: "not_ready" }
    | { status: "ok"; row: Campaign; progress: { total: number; done: number }; xp: number;
        totalPoints: number; level: number; levelName: string; leveledUp: boolean;
        unlockedByAward: FeatureKey[] };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [row] = await tx.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
      .for("update");
    if (!row) return { status: "not_found" };

    const chapters = await tx.select({ status: questlinesTable.status }).from(questlinesTable)
      .where(and(eq(questlinesTable.campaignId, id), eq(questlinesTable.userId, userId)));
    const progress = computeCampaignProgress(chapters);

    if (!isCampaignReadyToClaim(row, progress)) return { status: "not_ready" };

    const xp = computeCampaignRewardXp(progress.total);
    const newTotal = user.totalPoints + xp;
    const beforeLevel = getLevelInfo(user.totalPoints).level;
    const afterLevel = getLevelInfo(newTotal);
    const unlockedByAward = newlyUnlocked(user, beforeLevel, afterLevel.level);

    await tx.update(usersTable).set({
      totalPoints: newTotal,
      weeklyPoints: user.weeklyPoints + xp,
      currentLevel: afterLevel.level,
    }).where(eq(usersTable.id, userId));

    const [updated] = await tx.update(campaignsTable).set({
      status: "completed",
      completedAt: new Date(),
      rewardXpAwarded: xp,
    }).where(eq(campaignsTable.id, id)).returning();

    await tx.insert(activityTable).values({
      userId,
      type: "campaign_complete",
      description: `Completed campaign · ${row.title}`,
      points: xp,
    });

    return {
      status: "ok", row: updated, progress, xp, totalPoints: newTotal,
      level: afterLevel.level, levelName: afterLevel.name,
      leveledUp: afterLevel.level > beforeLevel, unlockedByAward,
    };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Campaign not found" }); return; }
  if (outcome.status === "not_ready") { res.status(409).json({ error: "Campaign is not ready to claim" }); return; }

  res.status(200).json({
    campaign: formatCampaign(outcome.row, outcome.progress),
    endingBeat: outcome.row.endingBeat,
    xpAwarded: outcome.xp,
    totalPoints: outcome.totalPoints,
    currentLevel: outcome.level,
    levelName: outcome.levelName,
    leveledUp: outcome.leveledUp,
    newlyUnlocked: outcome.unlockedByAward,
  });
});

// Draft an arc for a goal. Side-effect-free, and it ALWAYS returns an arc:
// when the model is unavailable the curated fallback answers instead, so
// campaign creation can never be blocked by the AI.
router.post("/campaigns/suggest-arc", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!goal) { res.status(400).json({ error: "goal is required" }); return; }
  if (goal.length > 200) { res.status(400).json({ error: "goal is too long" }); return; }

  const fallback = () => {
    const arc = curatedArc(MIN_CHAPTERS, goal.length);
    res.json({
      arcPremise: arc.arcPremise,
      endingBeat: arc.endingBeat,
      source: "curated",
      chapters: arc.chapterBeats.map((beat) => ({ title: "", beat })),
    });
  };

  if (!isAiConfigured() || !suggestCooldown.tryAcquire(userId)) { fallback(); return; }

  try {
    const arc = await suggestCampaignArc(goal, generateJson);
    res.json({
      arcPremise: arc.arcPremise,
      endingBeat: arc.endingBeat,
      source: "ai",
      chapters: arc.chapters,
    });
  } catch (err) {
    if (err instanceof AiClientError || err instanceof CampaignArcParseError) {
      logger.warn({ err }, "campaign arc suggestion failed — serving curated arc");
      fallback();
      return;
    }
    throw err;
  }
});

export default router;
```

- [ ] **Step 3: Mount the router**

In `artifacts/api-server/src/routes/index.ts`, follow the existing import/`app.use` pattern for `questlines` and add the campaigns router alongside it (same prefix and auth middleware — copy the questlines line exactly, substituting `campaigns`).

- [ ] **Step 4: Typecheck and build**

```bash
pnpm typecheck && pnpm --filter @workspace/api-server build
```

Expected: no errors.

- [ ] **Step 5: Run the whole api-server suite**

```bash
pnpm --filter @workspace/api-server test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/campaigns.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/lib/ally-milestones.ts
git commit -m "feat(campaigns): campaign routes, claim tx, and arc drafting endpoint"
```

---

### Task 8: Questline chapter membership

**Files:**
- Modify: `artifacts/api-server/src/routes/questlines.ts`

**Interfaces:**
- Consumes: `renumber` (Task 2).
- Produces: `formatQuestline` output gains `campaignId`, `chapterOrder`, `chapterBeat`; `PATCH /questlines/:id` accepts `campaignId` and `chapterOrder`.

- [ ] **Step 1: Add the chapter fields to `formatQuestline`**

In `artifacts/api-server/src/routes/questlines.ts`, extend the returned object (after `createdAt`):

```typescript
    campaignId: row.campaignId ?? null,
    chapterOrder: row.chapterOrder ?? null,
    chapterBeat: row.chapterBeat ?? null,
```

- [ ] **Step 2: Accept membership changes in PATCH**

Replace the destructuring and update-building block in `router.patch("/questlines/:id", ...)` with:

```typescript
  const { title, description, color, campaignId, chapterOrder } = req.body as {
    title?: string; description?: string | null; color?: string | null;
    campaignId?: number | null; chapterOrder?: number | null;
  };
  const updates: Partial<typeof questlinesTable.$inferInsert> = {};
  if (title != null) {
    if (!title.trim()) { res.status(400).json({ error: "title cannot be empty" }); return; }
    updates.title = title.trim();
  }
  if (description !== undefined) updates.description = description;
  if (color !== undefined) updates.color = color;

  // Campaign membership (Act VI). Attaching an ALREADY-COMPLETED questline is
  // deliberately allowed: if the work is done, the chapter counts.
  if (campaignId !== undefined) {
    if (campaignId != null) {
      const [owned] = await db.select({ id: campaignsTable.id }).from(campaignsTable)
        .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
      if (!owned) { res.status(404).json({ error: "Campaign not found" }); return; }
      updates.campaignId = campaignId;
    } else {
      // Detaching clears the chapter's position too — a stray order on an
      // unattached questline would sort wrong if it were ever re-adopted.
      updates.campaignId = null;
      updates.chapterOrder = null;
      updates.chapterBeat = null;
    }
  }
  if (chapterOrder !== undefined) updates.chapterOrder = chapterOrder;
```

- [ ] **Step 3: Add the campaigns import**

Extend the `@workspace/db` import at the top of the file to include `campaignsTable`.

- [ ] **Step 4: Typecheck and test**

```bash
pnpm typecheck && pnpm --filter @workspace/api-server test
```

Expected: no errors, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/questlines.ts
git commit -m "feat(campaigns): questlines can join and leave a campaign as chapters"
```

---

### Task 9: Nav tab and route gating

**Files:**
- Modify: `artifacts/focusquest/src/lib/nav-groups.ts`, `artifacts/focusquest/src/components/page-tabs.tsx`, `artifacts/focusquest/src/App.tsx`
- Test: `artifacts/focusquest/src/lib/nav-groups.test.ts`

**Interfaces:**
- Consumes: `isUnlocked`, `FeatureKey` (Task 5).
- Produces: `NavTab` gains optional `feature?: FeatureKey`; `/campaigns` and `/campaigns/:id` routes gated by `withGate("campaigns", …)`.

- [ ] **Step 1: Write the failing nav test**

Append to `artifacts/focusquest/src/lib/nav-groups.test.ts`:

```typescript
describe("campaigns tab", () => {
  it("lives in the quests group", () => {
    const quests = NAV_GROUPS.find((g) => g.key === "quests");
    expect(quests?.tabs?.some((t) => t.href === "/campaigns")).toBe(true);
  });
  it("carries the campaigns feature key so it can be gated", () => {
    const quests = NAV_GROUPS.find((g) => g.key === "quests");
    const tab = quests?.tabs?.find((t) => t.href === "/campaigns");
    expect(tab?.feature).toBe("campaigns");
  });
  it("lights the Quests group for a campaign detail URL", () => {
    expect(activeGroupKey("/campaigns/7")).toBe("quests");
  });
  it("adds no new top-level nav entry", () => {
    expect(NAV_GROUPS).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @workspace/focusquest test -- nav-groups
```

Expected: FAIL — no `/campaigns` tab.

- [ ] **Step 3: Add the tab and the optional feature field**

In `artifacts/focusquest/src/lib/nav-groups.ts`:

```typescript
export interface NavTab {
  label: string;
  href: string;
  // Act VI Quest Campaigns: a tab inside an ALWAYS-ON group can still be
  // gated. Undefined means ungated (the common case).
  feature?: string;
}
```

and extend the quests group's tabs:

```typescript
    tabs: [
      { label: "Today", href: "/tasks" },
      { label: "Questlines", href: "/questlines" },
      { label: "Campaigns", href: "/campaigns", feature: "campaigns" },
      { label: "Recurring", href: "/recurring" },
    ],
```

- [ ] **Step 4: Make PageTabs gate-aware**

Replace `artifacts/focusquest/src/components/page-tabs.tsx` with:

```tsx
// Tabs-as-links (Act VII q2): grouped routes stay first-class pages joined by
// a link row, so deep links and old URLs never break. Styled after ui/tabs
// triggers; active state mirrors nav-groups' prefix rule for :id subroutes.
// A tab may carry a `feature` key (Act VI Quest Campaigns) — locked tabs are
// INVISIBLE, and an absent unlock list fails OPEN.
import { Link, useLocation } from "wouter";
import { useGetMyStats } from "@workspace/api-client-react";
import { NAV_GROUPS } from "@/lib/nav-groups";
import { isUnlocked, type FeatureKey } from "@/lib/feature-gates";
import { browserTimeZone } from "@/lib/timezone";

export function PageTabs({ group }: { group: "quests" | "progress" | "allies" | "rewards" }) {
  const [location] = useLocation();
  const { data: stats } = useGetMyStats({ tz: browserTimeZone() });
  const tabs = NAV_GROUPS.find((g) => g.key === group)?.tabs;
  if (!tabs) return null;

  const visible = tabs.filter(
    (t) => !t.feature || isUnlocked(stats?.unlockedFeatures, t.feature as FeatureKey),
  );

  return (
    <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground mb-2" role="tablist" aria-label={`${group} sections`}>
      {visible.map((t) => {
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

- [ ] **Step 5: Run the nav test to verify it passes**

```bash
pnpm --filter @workspace/focusquest test -- nav-groups
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/lib/nav-groups.ts artifacts/focusquest/src/lib/nav-groups.test.ts artifacts/focusquest/src/components/page-tabs.tsx
git commit -m "feat(campaigns): gated Campaigns tab in the Quests group"
```

---

### Task 10: Campaigns list page and creation flow

**Files:**
- Create: `artifacts/focusquest/src/pages/campaigns.tsx`
- Modify: `artifacts/focusquest/src/App.tsx`
- Read first: `artifacts/focusquest/src/pages/questlines.tsx` (the create-dialog pattern this mirrors)

**Interfaces:**
- Consumes: `useGetCampaigns`, `useCreateCampaign`, `useSuggestCampaignArc`, `getGetCampaignsQueryKey`, type `Campaign` (Task 6).
- Produces: default-exported `Campaigns` page at `/campaigns`.

- [ ] **Step 1: Write the page**

```tsx
// artifacts/focusquest/src/pages/campaigns.tsx
// Act VI Quest Campaigns: one running campaign, everything else set aside or
// finished. Anti-shame law: a set-aside campaign is a CHOICE, never a failure —
// no gap counts, no decay, no nagging anywhere on this page.
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, Plus, Trophy, ChevronRight, Sparkles, X } from "lucide-react";
import {
  Campaign,
  useGetCampaigns,
  useCreateCampaign,
  useSuggestCampaignArc,
  getGetCampaignsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { PageTabs } from "@/components/page-tabs";

function ChapterBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{done} / {total} chapters</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CampaignCard({ c, large }: { c: Campaign; large?: boolean }) {
  const completed = c.status === "completed";
  return (
    <Link
      href={`/campaigns/${c.id}`}
      className={`block rounded-xl border transition-all cursor-pointer ${large ? "p-6" : "p-5"} ${
        c.ready
          ? "border-primary bg-primary/5 shadow-[0_0_15px_rgba(0,255,255,0.15)]"
          : completed
            ? "border-muted bg-muted/20 opacity-75"
            : "border-border bg-card hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <MapIcon className="w-4 h-4 flex-shrink-0 text-primary" />
          <h3 className={`font-semibold truncate ${completed ? "text-muted-foreground" : "text-foreground"}`}>
            {c.title}
          </h3>
        </div>
        {c.ready && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-primary text-primary uppercase tracking-wider whitespace-nowrap">
            <Trophy className="w-3 h-3" /> Ready
          </span>
        )}
        {completed && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 uppercase tracking-wider">
            Done
          </span>
        )}
      </div>
      {c.arcPremise && <p className="text-sm text-muted-foreground mt-2 italic">{c.arcPremise}</p>}
      <ChapterBar done={c.done} total={c.total} />
      <div className="flex justify-end mt-2 text-xs text-muted-foreground">
        <ChevronRight className="w-4 h-4" />
      </div>
    </Link>
  );
}

export default function Campaigns() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: campaigns, isLoading } = useGetCampaigns();
  const createMutation = useCreateCampaign();
  const suggestMutation = useSuggestCampaignArc();
  const [, navigate] = useLocation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [arc, setArc] = useState<{ premise: string; ending: string; source: "ai" | "curated" } | null>(null);
  const [chapters, setChapters] = useState<{ id: string; title: string; beat: string }[]>([]);

  const running = (campaigns ?? []).filter((c) => c.status === "running");
  const setAside = (campaigns ?? []).filter((c) => c.status === "set_aside");
  const finished = (campaigns ?? []).filter((c) => c.status === "completed");

  const reset = () => {
    setTitle("");
    setArc(null);
    setChapters([]);
    setIsCreateOpen(false);
  };

  const handleDraft = () => {
    if (!title.trim()) return;
    suggestMutation.mutate({ data: { goal: title.trim() } }, {
      onSuccess: (res) => {
        setArc({ premise: res.arcPremise, ending: res.endingBeat, source: res.source });
        setChapters(res.chapters.map((c) => ({ id: crypto.randomUUID(), title: c.title, beat: c.beat })));
        if (res.source === "curated") {
          toast({ title: "Drafted a classic arc — name the chapters yourself." });
        }
      },
      onError: (err: any) => {
        toast({ title: apiErrorMessage(err, "Couldn't draft an arc — you can still name chapters yourself."), variant: "destructive" });
      },
    });
  };

  const handleCreate = () => {
    if (!title.trim()) return;
    const kept = chapters
      .filter((c) => c.title.trim())
      .map((c) => ({ title: c.title.trim(), beat: c.beat || null }));
    createMutation.mutate(
      {
        data: {
          title: title.trim(),
          arcPremise: arc?.premise ?? null,
          endingBeat: arc?.ending ?? null,
          storySource: arc?.source ?? "curated",
          ...(kept.length ? { chapters: kept } : {}),
        },
      },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getGetCampaignsQueryKey() });
          reset();
          toast({ title: "Campaign begun", className: "border-primary" });
          navigate(`/campaigns/${created.id}`);
        },
        onError: (err: any) => {
          toast({ title: apiErrorMessage(err, "Could not start campaign"), variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <PageTabs group="quests" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapIcon className="w-6 h-6 text-primary" /> Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">One long goal at a time, told in chapters.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-1">
          <Plus className="w-4 h-4" /> New
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (campaigns ?? []).length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <MapIcon className="w-10 h-10 mx-auto text-muted-foreground/50" />
          <p className="mt-3 text-muted-foreground">No campaign yet. Start one when you have a goal worth several weeks.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {running.map((c) => <CampaignCard key={c.id} c={c} large />)}

          {setAside.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Set aside</h2>
              <div className="space-y-3 opacity-80">
                {setAside.map((c) => <CampaignCard key={c.id} c={c} />)}
              </div>
            </div>
          )}

          {finished.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Chronicle</h2>
              <div className="space-y-3">
                {finished.map((c) => <CampaignCard key={c.id} c={c} />)}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={(o) => (o ? setIsCreateOpen(true) : reset())}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="The goal (e.g. Make the garage usable)" value={title} autoFocus
              onChange={(e) => setTitle(e.target.value)} />

            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" className="gap-1"
                onClick={handleDraft} disabled={!title.trim() || suggestMutation.isPending}>
                <Sparkles className="w-3.5 h-3.5" />
                {suggestMutation.isPending ? "Drafting…" : "Draft the arc"}
              </Button>
              {chapters.length > 0 && <span className="text-xs text-muted-foreground">Edit anything before starting</span>}
            </div>

            {arc?.premise && <p className="text-sm italic text-muted-foreground border-l-2 border-primary/40 pl-3">{arc.premise}</p>}

            {chapters.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {chapters.map((c, i) => (
                  <div key={c.id} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground pt-2.5 w-4 text-right">{i + 1}</span>
                    <div className="flex-1 space-y-1">
                      <Input value={c.title} placeholder={`Chapter ${i + 1} — what happens in it`}
                        onChange={(e) => setChapters((p) => p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                      {c.beat && <p className="text-xs text-muted-foreground italic pl-1">{c.beat}</p>}
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                      aria-label={`Remove chapter ${i + 1}`}
                      onClick={() => setChapters((p) => p.filter((_, j) => j !== i))}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {running.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Starting this sets “{running[0]!.title}” aside. Nothing is lost — you can pick it back up whenever.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!title.trim() || createMutation.isPending}>
                {createMutation.isPending ? "Starting…" : "Begin"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Register the gated route**

In `artifacts/focusquest/src/App.tsx`: import the page (`const Campaigns = lazy(...)` or a direct import, matching the file's existing style for `Questlines`), add the gated wrapper next to the others:

```tsx
const CampaignsGated = withGate("campaigns", Campaigns);
```

and add the route **above** the `/questlines` routes so ordering stays consistent with the tab order:

```tsx
        <Route path="/campaigns" component={CampaignsGated} />
```

- [ ] **Step 3: Typecheck and build**

```bash
pnpm typecheck && pnpm --filter @workspace/focusquest build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/pages/campaigns.tsx artifacts/focusquest/src/App.tsx
git commit -m "feat(campaigns): campaigns list page and arc-drafting creation flow"
```

---

### Task 11: Campaign detail page

**Files:**
- Create: `artifacts/focusquest/src/pages/campaign-detail.tsx`
- Modify: `artifacts/focusquest/src/App.tsx`
- Read first: `artifacts/focusquest/src/pages/questline-detail.tsx`

**Interfaces:**
- Consumes: `useGetCampaign`, `useUpdateCampaign`, `useClaimCampaign`, `useDeleteCampaign`, `getGetCampaignQueryKey`, `getGetCampaignsQueryKey` (Task 6).
- Produces: default-exported `CampaignDetail` page at `/campaigns/:id`.

- [ ] **Step 1: Write the page**

```tsx
// artifacts/focusquest/src/pages/campaign-detail.tsx
// Chapters render in story order with a "current chapter" pointer, but NOTHING
// here hides or blocks a later chapter — ordered, never gated. Every chapter
// links straight to its questline so the work stays one tap away.
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, Trophy, ChevronRight, Check, Pause, Play, Trash2 } from "lucide-react";
import {
  useGetCampaign, useUpdateCampaign, useClaimCampaign, useDeleteCampaign,
  getGetCampaignQueryKey, getGetCampaignsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";

export default function CampaignDetail() {
  const params = useParams();
  const id = parseInt(params.id ?? "", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data, isLoading } = useGetCampaign(id);
  const updateMutation = useUpdateCampaign();
  const claimMutation = useClaimCampaign();
  const deleteMutation = useDeleteCampaign();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetCampaignsQueryKey() });
  };

  if (isLoading) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Loading…</div>;
  if (!data) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Campaign not found.</div>;

  const { campaign, chapters, currentChapterId } = data;

  const handleClaim = () => {
    claimMutation.mutate({ id }, {
      onSuccess: (res) => {
        refresh();
        toast({
          title: `Campaign complete — ${res.xpAwarded} XP`,
          description: res.endingBeat ?? undefined,
          className: "border-primary",
        });
      },
      onError: (err: any) => {
        toast({ title: apiErrorMessage(err, "Could not claim reward"), variant: "destructive" });
      },
    });
  };

  const handleStatus = (status: "running" | "set_aside") => {
    updateMutation.mutate({ id, data: { status } }, {
      onSuccess: () => {
        refresh();
        toast({ title: status === "set_aside" ? "Set aside — it'll be here when you want it" : "Picked back up" });
      },
      onError: (err: any) => {
        toast({ title: apiErrorMessage(err, "Could not update campaign"), variant: "destructive" });
      },
    });
  };

  const handleDelete = () => {
    if (!confirm("Delete this campaign? Its chapters and quests stay — they just stop being chapters.")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignsQueryKey() });
        navigate("/campaigns");
        toast({ title: "Campaign deleted — your quests are untouched" });
      },
      onError: (err: any) => {
        toast({ title: apiErrorMessage(err, "Could not delete campaign"), variant: "destructive" });
      },
    });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link href="/campaigns" className="text-sm text-muted-foreground hover:text-foreground">← Campaigns</Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapIcon className="w-6 h-6 text-primary" /> {campaign.title}
        </h1>
        <div className="flex gap-1">
          {campaign.status === "running" && (
            <Button variant="ghost" size="icon" aria-label="Set aside" onClick={() => handleStatus("set_aside")}>
              <Pause className="w-4 h-4" />
            </Button>
          )}
          {campaign.status === "set_aside" && (
            <Button variant="ghost" size="icon" aria-label="Pick back up" onClick={() => handleStatus("running")}>
              <Play className="w-4 h-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label="Delete campaign" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {campaign.arcPremise && (
        <p className="mt-3 text-muted-foreground italic border-l-2 border-primary/40 pl-3">{campaign.arcPremise}</p>
      )}

      {campaign.status === "set_aside" && (
        <p className="mt-3 text-sm text-muted-foreground">
          Set aside. The story waited for you — pick it back up whenever you want.
        </p>
      )}

      <p className="mt-4 text-sm text-muted-foreground">{campaign.done} / {campaign.total} chapters</p>

      <div className="mt-4 space-y-3">
        {chapters.map((ch, i) => {
          const done = ch.status === "completed";
          const current = ch.questlineId === currentChapterId;
          return (
            <Link key={ch.questlineId} href={`/questlines/${ch.questlineId}`}
              className={`block p-4 rounded-xl border transition-all ${
                current ? "border-primary bg-primary/5" : done ? "border-muted bg-muted/20" : "border-border bg-card hover:border-primary/50"
              }`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Chapter {i + 1}</span>
                    {current && <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Current</span>}
                    {done && <Check className="w-3.5 h-3.5 text-emerald-400" aria-label="Chapter complete" />}
                  </div>
                  <h3 className={`font-semibold truncate ${done ? "text-muted-foreground" : "text-foreground"}`}>{ch.title}</h3>
                  {done && ch.chapterBeat && <p className="text-sm text-muted-foreground italic mt-1">{ch.chapterBeat}</p>}
                  <p className="text-xs text-muted-foreground mt-1">{ch.done} / {ch.total} quests</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </div>
            </Link>
          );
        })}

        {chapters.length === 0 && (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-6 text-center">
            No chapters yet. Open a questline and add it to this campaign.
          </p>
        )}
      </div>

      {campaign.ready && (
        <Button onClick={handleClaim} disabled={claimMutation.isPending} className="mt-6 w-full gap-1">
          <Trophy className="w-4 h-4" />
          {claimMutation.isPending ? "Claiming…" : "Claim reward"}
        </Button>
      )}

      {campaign.status === "completed" && (
        <div className="mt-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
          <p className="flex items-center gap-2 text-emerald-400 font-semibold">
            <Trophy className="w-4 h-4" /> Completed — {campaign.rewardXpAwarded} XP claimed
          </p>
          {campaign.endingBeat && <p className="text-sm text-muted-foreground italic mt-2">{campaign.endingBeat}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the gated route**

In `artifacts/focusquest/src/App.tsx`, matching the questline pattern (detail route **before** the list route):

```tsx
const CampaignDetailGated = withGate("campaigns", CampaignDetail);
```

```tsx
        <Route path="/campaigns/:id" component={CampaignDetailGated} />
        <Route path="/campaigns" component={CampaignsGated} />
```

- [ ] **Step 3: Typecheck and build**

```bash
pnpm typecheck && pnpm --filter @workspace/focusquest build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/pages/campaign-detail.tsx artifacts/focusquest/src/App.tsx
git commit -m "feat(campaigns): campaign detail with ordered chapters and claim"
```

---

### Task 12: Now-screen current-chapter line and the chapter beat on questline claim

**Files:**
- Create: `artifacts/focusquest/src/components/campaign-now-line.tsx`
- Modify: `artifacts/focusquest/src/pages/now.tsx`, `artifacts/focusquest/src/pages/questline-detail.tsx`

**Interfaces:**
- Consumes: `useGetCampaigns`, `useGetCampaign` (Task 6); `isUnlocked` (Task 5).
- Produces: `<CampaignNowLine />`.

- [ ] **Step 1: Write the component**

```tsx
// artifacts/focusquest/src/components/campaign-now-line.tsx
// One quiet line of context under the momentum suggestion: which chapter you're
// on. Renders NOTHING when there is no running campaign, when campaigns are
// locked, or when every chapter is done — it never nags and never competes
// with the suggestion above it.
import { Link } from "wouter";
import { Map as MapIcon } from "lucide-react";
import {
  useGetMyStats, useGetCampaigns, useGetCampaign,
  getGetCampaignQueryKey, getGetCampaignsQueryKey,
} from "@workspace/api-client-react";
import { isUnlocked } from "@/lib/feature-gates";
import { browserTimeZone } from "@/lib/timezone";

export function CampaignNowLine() {
  const { data: stats } = useGetMyStats({ tz: browserTimeZone() });
  const unlocked = isUnlocked(stats?.unlockedFeatures, "campaigns");

  const { data: campaigns } = useGetCampaigns({
    // Reuse the generated key — a bespoke key would open a SECOND cache entry
    // for the same request and refetch the list twice on every Now render.
    query: { enabled: unlocked, queryKey: getGetCampaignsQueryKey() },
  });
  const running = (campaigns ?? []).find((c) => c.status === "running");

  const { data: detail } = useGetCampaign(running?.id ?? 0, {
    query: { enabled: unlocked && !!running, queryKey: getGetCampaignQueryKey(running?.id ?? 0) },
  });

  if (!unlocked || !running || !detail) return null;

  const index = detail.chapters.findIndex((c) => c.questlineId === detail.currentChapterId);
  if (index < 0) return null;
  const chapter = detail.chapters[index]!;

  return (
    <Link href={`/campaigns/${running.id}`}
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
      <MapIcon className="w-3.5 h-3.5 text-primary/70" aria-hidden />
      <span className="truncate">
        Chapter {index + 1} of {detail.chapters.length} — {chapter.title}
      </span>
    </Link>
  );
}
```

**Note on the query options:** orval hooks with a path param take `(param, options)`, and TanStack Query v5 requires an explicit `queryKey` whenever query options are overridden — both are already reflected above.

- [ ] **Step 2: Mount it on the Now screen**

In `artifacts/focusquest/src/pages/now.tsx`, import the component and render it directly beneath the momentum suggestion block (above the task list section):

```tsx
      <CampaignNowLine />
```

- [ ] **Step 3: Show the chapter beat when a chapter clears**

In `artifacts/focusquest/src/pages/questline-detail.tsx`, inside the `claimMutation.mutate` `onSuccess` handler, pass the questline's `chapterBeat` as the toast description so a chapter clear reuses the celebration that already exists:

```tsx
        toast({
          title: `Questline complete — ${res.xpAwarded} XP`,
          description: questline.chapterBeat ?? undefined,
          className: "border-primary",
        });
```

Keep whatever level-up handling the existing `onSuccess` already performs — only the toast call changes.

- [ ] **Step 4: Typecheck, test, build**

```bash
pnpm typecheck && pnpm --filter @workspace/focusquest test && pnpm --filter @workspace/focusquest build
```

Expected: no errors, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/campaign-now-line.tsx artifacts/focusquest/src/pages/now.tsx artifacts/focusquest/src/pages/questline-detail.tsx
git commit -m "feat(campaigns): current-chapter line on Now, chapter beat on claim"
```

---

### Task 13: Full gate run, live migration, and PR

**Files:** none created; this is the verification and rollout task.

- [ ] **Step 1: Run every suite**

```bash
pnpm --filter @workspace/api-server test && pnpm --filter @workspace/focusquest test && pnpm --filter @workspace/quick-add test
```

Expected: all three PASS. Record the counts for the PR body.

- [ ] **Step 2: Full typecheck and build**

```bash
pnpm build
```

Expected: no errors.

- [ ] **Step 3: Apply the migration to live Neon**

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r')" && pnpm --filter @workspace/db migrate
```

Expected: `0006_quest_campaigns` applied. Then verify history:

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r')" && pnpm --filter @workspace/db check
```

Expected: no errors.

- [ ] **Step 4: Live authed drive**

Start the server and, signed in as a real account, walk: create a campaign with a drafted arc → confirm chapters exist as questlines → attach an existing questline via the questline PATCH → reorder → complete every chapter → claim → re-claim and confirm **409**. Also probe each new route unauthenticated and confirm **401**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/campaigns
```

Expected: `401`.

- [ ] **Step 5: Verify the single-running guard on live data**

Create a second campaign while one is running; confirm the first flips to `set_aside` and no error surfaces, then confirm exactly one running row exists:

```sql
SELECT status, count(*) FROM campaigns GROUP BY status;
```

Expected: at most one `running` row per user.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin feat/quest-campaigns
```

Then open the PR with `gh` (full path: `C:\Program Files\GitHub CLI\gh.exe`), titled `feat(campaigns): Quest Campaigns — a story arc over questlines (Act VI q3)`. The body must include: the spec link, test counts from Step 1, confirmation the migration is applied to Neon, and a post-deploy walkthrough checklist for Chad (draft an arc with AI, force the curated path by walking through with the key unset, adopt an existing questline, claim, confirm the L4 tab is absent on a fresh account).

- [ ] **Step 7: Post-merge (outside this plan's code changes)**

Refresh the campaign-map artifact to **36/38 = 95%** (Act VI 3/5), update the `project-feature-roadmap` memory, and write a new `project-quest-campaigns` memory.

---

## Self-Review

**Spec coverage:** data model → Task 1; pure logic → Task 2; curated arcs → Task 3; AI arc → Task 4; gate key → Task 5; API contract → Task 6; routes incl. claim/suggest/reorder/set-aside → Task 7; adopt/detach → Task 8; nav tab → Task 9; list + creation → Task 10; detail → Task 11; Now line + chapter beat → Task 12; testing/rollout → Task 13. The spec's `campaign_chapter` activity type is declared in the OpenAPI enum (Task 6) but is only *written* by the questline claim path, which this plan does not extend — the chapter beat is surfaced client-side in Task 12 instead. That is intentional: writing a second activity row per chapter would double-report the same work in the feed.

**Type consistency:** `computeCampaignProgress`/`isCampaignReadyToClaim`/`computeCampaignRewardXp`/`nextChapter`/`renumber` keep identical names and signatures across Tasks 2, 7, and 12. `formatCampaign` is defined once (Task 7). Client `FeatureKey` (Task 5) includes `campaigns` before Tasks 9–12 consume it. `chapterBeat` is spelled the same in schema (Task 1), API (Task 6), route (Tasks 7–8), and UI (Tasks 11–12).

**No placeholders:** every code step carries complete code; every command carries expected output.
