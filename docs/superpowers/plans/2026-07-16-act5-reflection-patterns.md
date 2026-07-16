# Act V Spine — End-of-Day AI Reflection + Pattern Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first Act V quest — an anti-shame end-of-day AI reflection (LLM-drafted question, chip answers, warm ack) plus the pure pattern-derivation substrate and a confidence-gated "Your rhythms" card.

**Architecture:** Pure-lib-first, matching the repo: all decision logic lives in tested pure functions (`patterns.ts`, `ai/reflection.ts`, `reflections.ts` server-side; three small libs client-side); Express routes and the cron scheduler stay thin and untested. One new table (`reflections`), one new users column, compute-on-read patterns (no rollup storage). LLM calls ride the existing Groq `generateJson` seam and are fallback-first — they never block or fail a request.

**Tech Stack:** Express 5 + Drizzle (Neon PG), OpenAPI → orval codegen (`@workspace/api-client-react` hooks + `@workspace/api-zod` types), React 19 + wouter + TanStack Query, vitest, web-push.

**Spec:** `docs/superpowers/specs/2026-07-16-act5-reflection-patterns-design.md` (approved). Two refinements made at planning time, both serving the spec's intent:
1. `GET /reflections/today` takes a `draft` query flag (default false). The dashboard card polls without drafting; only the reflection page drafts — keeps LLM calls lazy exactly as §6 requires even though the card fetches state.
2. The chip **grouping** is encoded as two OpenAPI enums (`ReflectionHelpedChip`, `ReflectionHinderedChip`) whose union is `ReflectionChip` — codegen makes the yaml the single source of truth for key→group on both client and server (spec §2's "one shared constant").

## Global Constraints

- **Anti-shame law (spec §8):** no unfinished/missed/overdue data anywhere in the reflection pipeline; banned guilt-words in LLM output ⇒ fallback; zero-signal days get no push; no reflection streaks/counters; reflection content never in the activity feed; rhythms card renders strengths only.
- LLM failures NEVER surface as request errors — every AI path has a static fallback (spec §4, §9).
- All hour/day bucketing via `src/lib/date-buckets.ts` helpers in the resolved tz (`users.timezone` ?? `tz` query param ?? UTC).
- Never hand-edit files under `*/src/generated` — regenerate with `pnpm --filter @workspace/api-spec codegen`.
- Commands run from repo root `C:\Users\Chadr\OneDrive\Documents\Quest-Companion` (Git Bash).
- Commit after every task; branch `feat/act5-reflection-patterns` (already exists, spec committed).
- XP for first answer of the day: exactly +5, activity `type: 'reflection'`, description `"Evening reflection"` (content-free).
- Window: pattern derivation uses the last **28 days**; evening push window is local hour **[19, 22)**; dashboard card window is local hour **[17, 24)**.

---

### Task 1: Schema — `reflections` table + `users.reflection_prompted_date`

**Files:**
- Create: `lib/db/src/schema/reflections.ts`
- Modify: `lib/db/src/schema/index.ts` (add export)
- Modify: `lib/db/src/schema/users.ts` (one column)

**Interfaces:**
- Produces: `reflectionsTable`, `type Reflection` (drizzle row: `{ id: number; userId: number; localDate: string; prompt: string; promptSource: string; chips: string[]; freeText: string | null; ack: string | null; answeredAt: Date | null; createdAt: Date }`), `usersTable.reflectionPromptedDate: string | null` — all exported from `@workspace/db`.

There is no test step: schema files are declarations, verified by `drizzle-kit push` + typecheck (matches every prior schema task in this repo).

- [ ] **Step 1: Create the table file**

```ts
// lib/db/src/schema/reflections.ts
import { pgTable, serial, integer, text, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One row per user per local day. Created when the evening question is first
// drafted; answering updates the row in place (drafted ≠ answered — see
// answeredAt). Reflection CONTENT never reaches the activity feed or any ally
// surface (anti-shame); the +5 XP grant writes a content-free activity row.
export const reflectionsTable = pgTable("reflections", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id),
  localDate:    text("local_date").notNull(),    // YYYY-MM-DD in the user's tz (UTC fallback)
  prompt:       text("prompt").notNull(),
  promptSource: text("prompt_source").notNull(), // 'ai' | 'fallback'
  // Selected chip keys. No column default — every insert passes chips: [].
  chips:        jsonb("chips").$type<string[]>().notNull(),
  freeText:     text("free_text"),
  ack:          text("ack"),
  answeredAt:   timestamp("answered_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // One reflection per local day; concurrent first-drafts converge on one row
  // via onConflictDoNothing + re-select.
  unique("reflections_user_day_unique").on(t.userId, t.localDate),
]);

export type Reflection = typeof reflectionsTable.$inferSelect;
```

- [ ] **Step 2: Export it and add the users column**

In `lib/db/src/schema/index.ts` append:

```ts
export * from "./reflections";
```

In `lib/db/src/schema/users.ts`, after the `coinBalance` line and before `createdAt`, add:

```ts
  // Local-date string (YYYY-MM-DD) of the last evening reflection push — the
  // once-per-day dedup gate for the cron pass (mirrors hyperfocus columns).
  reflectionPromptedDate: text("reflection_prompted_date"),
```

- [ ] **Step 3: Push to Neon**

All schema-bearing branches are merged as of plan time (main @ 2eb8092), so the shared-DB rule is satisfied. `drizzle.config.ts` does not load `.env` — export the URL first:

Run: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" && pnpm --filter @workspace/db push`
Expected: `[✓] Changes applied` (additive table + column, no destructive prompt). Do NOT re-run to "verify" — the first run is authoritative (auto-mode guardrail can block re-runs).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/reflections.ts lib/db/src/schema/index.ts lib/db/src/schema/users.ts
git commit -m "feat(db): reflections table + users.reflection_prompted_date (Act V)"
```

---

### Task 2: OpenAPI contract + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Generated (do not hand-edit): `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`

**Interfaces:**
- Produces (via codegen, used by every later task):
  - `@workspace/api-zod` / `@workspace/api-client-react`: `ReflectionHelpedChip` / `ReflectionHinderedChip` (const objects + union types), `type ReflectionChip`, `type Reflection`, `type PatternSummary` (+ sub-schemas), `type ReflectionAnswerRequest`, `type ReflectionAnswerResponse`, `type ReflectionResponse`.
  - `@workspace/api-client-react` hooks: `useGetMyPatterns`, `useGetTodayReflection`, `getGetTodayReflectionQueryKey`, `useAnswerTodayReflection`.

- [ ] **Step 1: Add paths**

In `lib/api-spec/openapi.yaml`, directly after the `/users/me/insights` path block (ends near line 303), insert:

```yaml
  /users/me/patterns:
    get:
      operationId: getMyPatterns
      tags: [users]
      summary: Derived 28-day pattern summary (power hours, durations, modes, chips)
      parameters:
        - name: tz
          in: query
          description: >-
            IANA timezone fallback used only when the user has no persisted
            timezone. Defaults to UTC when omitted or invalid.
          schema:
            type: string
      responses:
        "200":
          description: Pattern summary (always complete; confidence gates rendering)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PatternSummary"

  /reflections/today:
    get:
      operationId: getTodayReflection
      tags: [reflections]
      summary: Get today's reflection; drafts the question only when draft=true
      parameters:
        - name: tz
          in: query
          schema:
            type: string
        - name: draft
          in: query
          description: >-
            When true, drafts (and persists) today's question if none exists —
            the reflection page passes true; the dashboard card omits it so
            LLM drafting stays lazy.
          schema:
            type: boolean
            default: false
      responses:
        "200":
          description: Today's reflection, or null when none exists and draft=false
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ReflectionResponse"
    post:
      operationId: answerTodayReflection
      tags: [reflections]
      summary: Answer (or same-day re-answer) today's reflection
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ReflectionAnswerRequest"
      responses:
        "200":
          description: Saved answer with warm ack; xpAwarded is 5 on first answer, else 0
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ReflectionAnswerResponse"
        "400":
          description: Unknown chip, empty answer (no chips and no freeText), or freeText over 500 chars
```

- [ ] **Step 2: Add schemas**

In `components/schemas`, directly after the `InsightsResponse` schema block (ends near line 3317), insert:

```yaml
    ReflectionHelpedChip:
      type: string
      description: What-helped chip keys (grouping source of truth)
      enum: [timer, small_steps, body_double, right_time, low_stakes, treat_reward]

    ReflectionHinderedChip:
      type: string
      description: What-got-in-the-way chip keys (grouping source of truth)
      enum: [low_energy, too_many_switches, too_big, distractions, time_slipped, pressure]

    ReflectionChip:
      oneOf:
        - $ref: "#/components/schemas/ReflectionHelpedChip"
        - $ref: "#/components/schemas/ReflectionHinderedChip"

    Reflection:
      type: object
      required: [id, localDate, prompt, promptSource, chips, freeText, ack, answeredAt, createdAt]
      properties:
        id:
          type: integer
        localDate:
          type: string
        prompt:
          type: string
        promptSource:
          type: string
          enum: [ai, fallback]
        chips:
          type: array
          items:
            $ref: "#/components/schemas/ReflectionChip"
        freeText:
          type: string
          nullable: true
        ack:
          type: string
          nullable: true
        answeredAt:
          type: string
          nullable: true
        createdAt:
          type: string

    ReflectionResponse:
      type: object
      required: [reflection]
      properties:
        reflection:
          allOf:
            - $ref: "#/components/schemas/Reflection"
          nullable: true

    ReflectionAnswerRequest:
      type: object
      required: [chips]
      properties:
        chips:
          type: array
          items:
            $ref: "#/components/schemas/ReflectionChip"
        freeText:
          type: string
          maxLength: 500
        tz:
          type: string

    ReflectionAnswerResponse:
      type: object
      required: [reflection, xpAwarded]
      properties:
        reflection:
          $ref: "#/components/schemas/Reflection"
        xpAwarded:
          type: integer

    PatternSampleSize:
      type: object
      required: [completions, focusMinutes, checkins, reflections]
      properties:
        completions:
          type: integer
        focusMinutes:
          type: integer
        checkins:
          type: integer
        reflections:
          type: integer

    PatternPowerHour:
      type: object
      required: [hour, score]
      properties:
        hour:
          type: integer
        score:
          type: number

    PatternCategoryMinutes:
      type: object
      required: [category, medianActual, count]
      properties:
        category:
          type: string
        medianActual:
          type: integer
        count:
          type: integer

    PatternModeBlock:
      type: object
      required: [block, dominantMode]
      properties:
        block:
          type: string
          enum: [morning, afternoon, evening, night]
        dominantMode:
          type: string
          nullable: true

    PatternSummary:
      type: object
      required: [windowDays, sampleSize, confidence, powerHours, bestDay, medianQuestMinutes, categoryMinutes, modeByBlock, topHelpers, topBlockers]
      properties:
        windowDays:
          type: integer
        sampleSize:
          $ref: "#/components/schemas/PatternSampleSize"
        confidence:
          type: string
          enum: [none, low, ok]
        powerHours:
          type: array
          items:
            $ref: "#/components/schemas/PatternPowerHour"
        bestDay:
          type: integer
          nullable: true
          description: 0=Sun … 6=Sat
        medianQuestMinutes:
          type: integer
          nullable: true
        categoryMinutes:
          type: array
          items:
            $ref: "#/components/schemas/PatternCategoryMinutes"
        modeByBlock:
          type: array
          items:
            $ref: "#/components/schemas/PatternModeBlock"
        topHelpers:
          type: array
          items:
            $ref: "#/components/schemas/ReflectionChip"
        topBlockers:
          type: array
          items:
            $ref: "#/components/schemas/ReflectionChip"
```

- [ ] **Step 3: Regenerate clients**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: exits 0; new/changed files under `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` including `reflectionChip*.ts` / `patternSummary.ts` type files and the four hooks. Verify the two enum const objects exist:

Run: `grep -rn "export const ReflectionHelpedChip" lib/api-zod/src/generated lib/api-client-react/src/generated`
Expected: at least one hit per package (orval emits `{ timer: 'timer', ... } as const`).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): reflections + patterns contract, chip enums, codegen"
```

---

### Task 3: `derivePatterns` pure lib (server)

**Files:**
- Create: `artifacts/api-server/src/lib/patterns.ts`
- Test: `artifacts/api-server/src/lib/patterns.test.ts`

**Interfaces:**
- Consumes: `localHour`, `localDateKey` from `./date-buckets`; `ReflectionHelpedChip`, `ReflectionHinderedChip` from `@workspace/api-zod` (Task 2).
- Produces (Tasks 4, 6 import these):

```ts
export const PATTERN_WINDOW_DAYS = 28;
export type PatternConfidence = "none" | "low" | "ok";
export type DayBlock = "morning" | "afternoon" | "evening" | "night";
export interface PatternInputs {
  now: Date;
  timeZone: string;
  completions: { completedAt: Date; category: string; estimatedMinutes: number | null; actualMinutes: number | null }[];
  focusSessions: { startedAt: Date; focusedSeconds: number }[];
  checkins: { mode: string; createdAt: Date }[];
  reflections: { chips: string[] }[];
}
export interface PatternSummary {
  windowDays: number;
  sampleSize: { completions: number; focusMinutes: number; checkins: number; reflections: number };
  confidence: PatternConfidence;
  powerHours: { hour: number; score: number }[];
  bestDay: number | null;
  medianQuestMinutes: number | null;
  categoryMinutes: { category: string; medianActual: number; count: number }[];
  modeByBlock: { block: DayBlock; dominantMode: string | null }[];
  topHelpers: string[];
  topBlockers: string[];
}
export function derivePatterns(inputs: PatternInputs): PatternSummary;
export function blockOfHour(hour: number): DayBlock;
```

- [ ] **Step 1: Write the failing tests**

```ts
// artifacts/api-server/src/lib/patterns.test.ts
import { describe, it, expect } from "vitest";
import { derivePatterns, blockOfHour, type PatternInputs } from "./patterns";

const NOW = new Date("2026-07-16T20:00:00.000Z");

function inputs(over: Partial<PatternInputs> = {}): PatternInputs {
  return {
    now: NOW,
    timeZone: "UTC",
    completions: [],
    focusSessions: [],
    checkins: [],
    reflections: [],
    ...over,
  };
}

/** n completions at the given UTC hour on distinct recent days. */
function completionsAt(hourUtc: number, n: number, category = "default", actualMinutes: number | null = null) {
  return Array.from({ length: n }, (_, i) => ({
    completedAt: new Date(Date.UTC(2026, 6, 15 - i, hourUtc, 30)),
    category,
    estimatedMinutes: null,
    actualMinutes,
  }));
}

describe("derivePatterns", () => {
  it("returns a complete empty-safe summary on no data", () => {
    const s = derivePatterns(inputs());
    expect(s.windowDays).toBe(28);
    expect(s.confidence).toBe("none");
    expect(s.powerHours).toEqual([]);
    expect(s.bestDay).toBeNull();
    expect(s.medianQuestMinutes).toBeNull();
    expect(s.categoryMinutes).toEqual([]);
    expect(s.topHelpers).toEqual([]);
    expect(s.topBlockers).toEqual([]);
    expect(s.modeByBlock).toHaveLength(4);
    expect(s.modeByBlock.every((m) => m.dominantMode === null)).toBe(true);
  });

  it("confidence tiers: none <5, low <15, ok >=15 completions", () => {
    expect(derivePatterns(inputs({ completions: completionsAt(10, 4) })).confidence).toBe("none");
    expect(derivePatterns(inputs({ completions: completionsAt(10, 5) })).confidence).toBe("low");
    expect(derivePatterns(inputs({ completions: completionsAt(10, 15) })).confidence).toBe("ok");
  });

  it("drops rows older than the 28-day window", () => {
    const old = [{ completedAt: new Date("2026-06-01T10:00:00Z"), category: "default", estimatedMinutes: null, actualMinutes: null }];
    const s = derivePatterns(inputs({ completions: old }));
    expect(s.sampleSize.completions).toBe(0);
  });

  it("powerHours scores completions + focus minutes/25, top 3, earlier-hour tiebreak", () => {
    const s = derivePatterns(inputs({
      completions: [...completionsAt(9, 3), ...completionsAt(14, 3), ...completionsAt(20, 1)],
      // 50 focused minutes at hour 14 → +2 score there
      focusSessions: [{ startedAt: new Date("2026-07-14T14:05:00Z"), focusedSeconds: 3000 }],
    }));
    expect(s.powerHours[0]).toEqual({ hour: 14, score: 5 });
    expect(s.powerHours[1]).toEqual({ hour: 9, score: 3 });
    expect(s.powerHours[2]).toEqual({ hour: 20, score: 1 });
  });

  it("powerHours ties break toward the earlier hour", () => {
    const s = derivePatterns(inputs({ completions: [...completionsAt(15, 2), ...completionsAt(8, 2)] }));
    expect(s.powerHours[0]!.hour).toBe(8);
  });

  it("buckets hours in the user's timezone", () => {
    // 2026-07-15T02:30Z = 22:30 on Jul 14 in America/New_York (EDT, UTC-4)
    const s = derivePatterns(inputs({
      timeZone: "America/New_York",
      completions: [
        { completedAt: new Date("2026-07-15T02:30:00Z"), category: "default", estimatedMinutes: null, actualMinutes: null },
      ],
    }));
    expect(s.powerHours[0]!.hour).toBe(22);
  });

  it("bestDay requires confidence >= low and a strict max", () => {
    // 4 completions → confidence none → null even with a clear winner
    expect(derivePatterns(inputs({ completions: completionsAt(10, 4) })).bestDay).toBeNull();
    // 15 spread with a strict winner
    const wed = Array.from({ length: 8 }, (_, i) => ({
      completedAt: new Date(Date.UTC(2026, 6, 15 - i * 7, 10)), // Jul 15 2026 is a Wednesday
      category: "default", estimatedMinutes: null, actualMinutes: null,
    }));
    const s = derivePatterns(inputs({ completions: [...wed, ...completionsAt(9, 7)] }));
    expect(s.bestDay).toBe(3);
  });

  it("medianQuestMinutes needs >=3 samples with actualMinutes", () => {
    expect(derivePatterns(inputs({ completions: completionsAt(10, 5, "default", 20) })).medianQuestMinutes).toBe(20);
    expect(derivePatterns(inputs({
      completions: [...completionsAt(10, 2, "default", 20), ...completionsAt(11, 5, "default", null)],
    })).medianQuestMinutes).toBeNull();
  });

  it("categoryMinutes computes per-category medians over actualMinutes rows only", () => {
    const s = derivePatterns(inputs({
      completions: [
        ...completionsAt(9, 3, "chores", 10),
        ...completionsAt(10, 2, "fitness", 40),
        ...completionsAt(11, 2, "fitness", null), // no actualMinutes — excluded
      ],
    }));
    expect(s.categoryMinutes).toEqual([
      { category: "chores", medianActual: 10, count: 3 },
      { category: "fitness", medianActual: 40, count: 2 },
    ]);
  });

  it("modeByBlock needs >=2 checkins in a block; ties yield null", () => {
    const at = (h: number, mode: string) => ({ mode, createdAt: new Date(Date.UTC(2026, 6, 15, h)) });
    const s = derivePatterns(inputs({
      checkins: [at(9, "focused"), at(10, "focused"), at(14, "frozen"), at(19, "focused"), at(20, "distracted")],
    }));
    const by = Object.fromEntries(s.modeByBlock.map((m) => [m.block, m.dominantMode]));
    expect(by.morning).toBe("focused");   // 2 focused
    expect(by.afternoon).toBeNull();      // only 1 checkin
    expect(by.evening).toBeNull();        // 1–1 tie
  });

  it("topHelpers/topBlockers split by generated chip groups, top 3 by count", () => {
    const s = derivePatterns(inputs({
      reflections: [
        { chips: ["timer", "small_steps", "low_energy"] },
        { chips: ["timer", "too_big"] },
        { chips: ["timer", "small_steps", "low_energy", "body_double", "right_time"] },
      ],
    }));
    expect(s.topHelpers).toEqual(["timer", "small_steps", "body_double"]);
    expect(s.topBlockers).toEqual(["low_energy", "too_big"]);
    expect(s.sampleSize.reflections).toBe(3);
  });
});

describe("blockOfHour", () => {
  it("maps hours to the insights period buckets", () => {
    expect(blockOfHour(6)).toBe("morning");
    expect(blockOfHour(11)).toBe("morning");
    expect(blockOfHour(12)).toBe("afternoon");
    expect(blockOfHour(16)).toBe("afternoon");
    expect(blockOfHour(17)).toBe("evening");
    expect(blockOfHour(20)).toBe("evening");
    expect(blockOfHour(21)).toBe("night");
    expect(blockOfHour(2)).toBe("night");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- patterns`
Expected: FAIL — cannot resolve `./patterns`.

- [ ] **Step 3: Implement**

```ts
// artifacts/api-server/src/lib/patterns.ts
import { localHour, localDateKey } from "./date-buckets";
import { ReflectionHelpedChip, ReflectionHinderedChip } from "@workspace/api-zod";

export const PATTERN_WINDOW_DAYS = 28;

export type PatternConfidence = "none" | "low" | "ok";
export type DayBlock = "morning" | "afternoon" | "evening" | "night";

export interface PatternInputs {
  now: Date;
  timeZone: string;
  completions: { completedAt: Date; category: string; estimatedMinutes: number | null; actualMinutes: number | null }[];
  focusSessions: { startedAt: Date; focusedSeconds: number }[];
  checkins: { mode: string; createdAt: Date }[];
  reflections: { chips: string[] }[];
}

export interface PatternSummary {
  windowDays: number;
  sampleSize: { completions: number; focusMinutes: number; checkins: number; reflections: number };
  confidence: PatternConfidence;
  powerHours: { hour: number; score: number }[];
  bestDay: number | null;
  medianQuestMinutes: number | null;
  categoryMinutes: { category: string; medianActual: number; count: number }[];
  modeByBlock: { block: DayBlock; dominantMode: string | null }[];
  topHelpers: string[];
  topBlockers: string[];
}

const BLOCKS: { block: DayBlock; hours: number[] }[] = [
  { block: "morning",   hours: [6, 7, 8, 9, 10, 11] },
  { block: "afternoon", hours: [12, 13, 14, 15, 16] },
  { block: "evening",   hours: [17, 18, 19, 20] },
  { block: "night",     hours: [21, 22, 23, 0, 1, 2, 3, 4, 5] },
];

export function blockOfHour(hour: number): DayBlock {
  return BLOCKS.find((b) => b.hours.includes(hour))!.block;
}

const HELPED = new Set<string>(Object.values(ReflectionHelpedChip));
const HINDERED = new Set<string>(Object.values(ReflectionHinderedChip));

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Top-N keys by count desc, then key asc — deterministic. */
function topCounts<K extends string>(counts: Map<K, number>, n: number): K[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([k]) => k);
}

export function derivePatterns(inputs: PatternInputs): PatternSummary {
  const { now, timeZone } = inputs;
  const cutoff = new Date(now.getTime() - PATTERN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const completions = inputs.completions.filter((c) => c.completedAt >= cutoff && c.completedAt <= now);
  const focusSessions = inputs.focusSessions.filter((f) => f.startedAt >= cutoff && f.startedAt <= now);
  const checkins = inputs.checkins.filter((c) => c.createdAt >= cutoff && c.createdAt <= now);
  const reflections = inputs.reflections;

  const focusMinutes = Math.round(focusSessions.reduce((s, f) => s + f.focusedSeconds, 0) / 60);

  const confidence: PatternConfidence =
    completions.length < 5 ? "none" : completions.length < 15 ? "low" : "ok";

  // Power hours: completions weigh 1, a completed pomodoro's worth of focus (~25 min) weighs 1.
  const hourScore = new Map<number, number>();
  for (const c of completions) {
    const h = localHour(c.completedAt, timeZone);
    hourScore.set(h, (hourScore.get(h) ?? 0) + 1);
  }
  for (const f of focusSessions) {
    const h = localHour(f.startedAt, timeZone);
    hourScore.set(h, (hourScore.get(h) ?? 0) + f.focusedSeconds / 60 / 25);
  }
  const powerHours = [...hourScore.entries()]
    .map(([hour, score]) => ({ hour, score: Math.round(score * 100) / 100 }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.hour - b.hour)
    .slice(0, 3);

  // Best weekday: strict max, only past the 'none' tier.
  let bestDay: number | null = null;
  if (confidence !== "none") {
    const dayCounts = new Array<number>(7).fill(0);
    for (const c of completions) {
      const dow = new Date(localDateKey(c.completedAt, timeZone) + "T12:00:00Z").getUTCDay();
      dayCounts[dow]!++;
    }
    const max = Math.max(...dayCounts);
    const winners = dayCounts.flatMap((n, d) => (n === max && n > 0 ? [d] : []));
    bestDay = winners.length === 1 ? winners[0]! : null;
  }

  // Durations: only rows that actually recorded actualMinutes.
  const timed = completions.filter((c) => c.actualMinutes != null);
  const medianQuestMinutes =
    timed.length >= 3 ? median(timed.map((c) => c.actualMinutes!).sort((a, b) => a - b)) : null;

  const byCategory = new Map<string, number[]>();
  for (const c of timed) {
    byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c.actualMinutes!]);
  }
  const categoryMinutes = [...byCategory.entries()]
    .map(([category, mins]) => ({
      category,
      medianActual: median(mins.sort((a, b) => a - b)),
      count: mins.length,
    }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));

  // Dominant brain mode per day-block: >=2 checkins in the block, strict winner.
  const modeByBlock = BLOCKS.map(({ block }) => {
    const inBlock = checkins.filter((c) => blockOfHour(localHour(c.createdAt, timeZone)) === block);
    if (inBlock.length < 2) return { block, dominantMode: null };
    const counts = new Map<string, number>();
    for (const c of inBlock) counts.set(c.mode, (counts.get(c.mode) ?? 0) + 1);
    const max = Math.max(...counts.values());
    const winners = [...counts.entries()].filter(([, n]) => n === max);
    return { block, dominantMode: winners.length === 1 ? winners[0]![0] : null };
  });

  const helperCounts = new Map<string, number>();
  const blockerCounts = new Map<string, number>();
  for (const r of reflections) {
    for (const chip of r.chips) {
      if (HELPED.has(chip)) helperCounts.set(chip, (helperCounts.get(chip) ?? 0) + 1);
      if (HINDERED.has(chip)) blockerCounts.set(chip, (blockerCounts.get(chip) ?? 0) + 1);
    }
  }

  return {
    windowDays: PATTERN_WINDOW_DAYS,
    sampleSize: {
      completions: completions.length,
      focusMinutes,
      checkins: checkins.length,
      reflections: reflections.length,
    },
    confidence,
    powerHours,
    bestDay,
    medianQuestMinutes,
    categoryMinutes,
    modeByBlock,
    topHelpers: topCounts(helperCounts, 3),
    topBlockers: topCounts(blockerCounts, 3),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- patterns`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/patterns.ts artifacts/api-server/src/lib/patterns.test.ts
git commit -m "feat(api): derivePatterns pure lib — 28d power hours, durations, modes, chips"
```

---

### Task 4: AI reflection module — question/ack builders, guards, fallbacks

**Files:**
- Create: `artifacts/api-server/src/lib/ai/reflection.ts`
- Test: `artifacts/api-server/src/lib/ai/reflection.test.ts`

**Interfaces:**
- Consumes: `type PatternSummary`, `blockOfHour` from `../patterns` (Task 3); `type GenerateJson = (prompt: string) => Promise<unknown>` (same seam shape as `task-breakdown.ts`); `localHour` from `../date-buckets`.
- Produces (Task 6/7 import these):

```ts
export interface DaySummary {
  completedQuests: { title: string; category: string }[]; // capped at 6
  focusMinutes: number;
  modesSeen: { mode: string; block: DayBlock }[];
  rescueCount: number;
  streakDays: number;
}
export function buildDaySummary(input: {
  completedToday: { title: string; category: string; completedAt: Date }[];
  focusSecondsToday: number;
  checkinsToday: { mode: string; createdAt: Date }[];
  rescueCountToday: number;
  streakDays: number;
  timeZone: string;
}): DaySummary;
export function containsGuiltLanguage(text: string): boolean;
export async function draftQuestion(day: DaySummary, patterns: PatternSummary, userId: number, localDate: string, generate: GenerateJson | null): Promise<{ question: string; source: "ai" | "fallback" }>;
export async function draftAck(chips: string[], freeText: string | null, userId: number, localDate: string, generate: GenerateJson | null): Promise<string>;
export function fallbackQuestion(userId: number, localDate: string): string;
export function fallbackAck(userId: number, localDate: string): string;
```

`generate: null` means AI is unconfigured — go straight to fallback (route passes `isAiConfigured() ? generateJson : null`).

- [ ] **Step 1: Write the failing tests**

```ts
// artifacts/api-server/src/lib/ai/reflection.test.ts
import { describe, it, expect } from "vitest";
import {
  buildDaySummary, containsGuiltLanguage, draftQuestion, draftAck,
  fallbackQuestion, fallbackAck, buildReflectionQuestionPrompt,
  MAX_QUESTION_LENGTH, FALLBACK_QUESTIONS,
} from "./reflection";
import type { PatternSummary } from "../patterns";

const EMPTY_PATTERNS: PatternSummary = {
  windowDays: 28,
  sampleSize: { completions: 0, focusMinutes: 0, checkins: 0, reflections: 0 },
  confidence: "none",
  powerHours: [], bestDay: null, medianQuestMinutes: null,
  categoryMinutes: [], modeByBlock: [
    { block: "morning", dominantMode: null }, { block: "afternoon", dominantMode: null },
    { block: "evening", dominantMode: null }, { block: "night", dominantMode: null },
  ],
  topHelpers: [], topBlockers: [],
};

const DAY = buildDaySummary({
  completedToday: [
    { title: "Fold laundry", category: "chores", completedAt: new Date("2026-07-16T14:00:00Z") },
  ],
  focusSecondsToday: 1500,
  checkinsToday: [{ mode: "focused", createdAt: new Date("2026-07-16T09:30:00Z") }],
  rescueCountToday: 1,
  streakDays: 4,
  timeZone: "UTC",
});

describe("buildDaySummary", () => {
  it("assembles only positive/neutral facts and caps quests at 6", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `q${i}`, category: "default", completedAt: new Date("2026-07-16T10:00:00Z"),
    }));
    const s = buildDaySummary({
      completedToday: many, focusSecondsToday: 0, checkinsToday: [],
      rescueCountToday: 0, streakDays: 0, timeZone: "UTC",
    });
    expect(s.completedQuests).toHaveLength(6);
    // Anti-shame: the summary's shape has no channel for unfinished work.
    expect(Object.keys(s).sort()).toEqual(
      ["completedQuests", "focusMinutes", "modesSeen", "rescueCount", "streakDays"].sort(),
    );
  });

  it("maps checkins to day blocks and rounds focus minutes", () => {
    expect(DAY.focusMinutes).toBe(25);
    expect(DAY.modesSeen).toEqual([{ mode: "focused", block: "morning" }]);
  });
});

describe("containsGuiltLanguage", () => {
  it("flags guilt phrases case-insensitively, including curly apostrophes", () => {
    expect(containsGuiltLanguage("You should have started earlier")).toBe(true);
    expect(containsGuiltLanguage("Why didn't you finish?")).toBe(true);
    expect(containsGuiltLanguage("Why didn’t you finish?")).toBe(true);
    expect(containsGuiltLanguage("You missed the deadline")).toBe(true);
    expect(containsGuiltLanguage("You failed today")).toBe(true);
    expect(containsGuiltLanguage("You're falling behind")).toBe(true);
    expect(containsGuiltLanguage("You only did one thing")).toBe(true);
    expect(containsGuiltLanguage("It was just one quest")).toBe(true);
  });
  it("passes warm copy", () => {
    expect(containsGuiltLanguage("What made the morning flow?")).toBe(false);
    expect(containsGuiltLanguage("Adjusted for readability")).toBe(false); // 'just' inside a word
  });
});

describe("buildReflectionQuestionPrompt", () => {
  it("grounds the prompt in day facts and bans unfinished-work talk", () => {
    const p = buildReflectionQuestionPrompt(DAY, EMPTY_PATTERNS);
    expect(p).toContain("Fold laundry");
    expect(p).toContain("25");
    expect(p.toLowerCase()).toContain("never");         // hard rules present
    expect(p.toLowerCase()).toContain("unfinished");    // explicit prohibition
    expect(p).toContain('{"question"');                 // JSON contract
  });
});

describe("draftQuestion", () => {
  it("uses the model answer when valid", async () => {
    const gen = async () => ({ question: "What made the morning flow so well?" });
    const r = await draftQuestion(DAY, EMPTY_PATTERNS, 1, "2026-07-16", gen);
    expect(r).toEqual({ question: "What made the morning flow so well?", source: "ai" });
  });

  it.each([
    ["model throws", async () => { throw new Error("down"); }],
    ["bad shape", async () => ({ nope: true })],
    ["too long", async () => ({ question: "x".repeat(MAX_QUESTION_LENGTH + 1) })],
    ["guilt language", async () => ({ question: "Why didn't you do more?" })],
    ["empty", async () => ({ question: "  " })],
  ])("falls back when %s", async (_name, gen) => {
    const r = await draftQuestion(DAY, EMPTY_PATTERNS, 1, "2026-07-16", gen as never);
    expect(r.source).toBe("fallback");
    expect(FALLBACK_QUESTIONS).toContain(r.question);
  });

  it("goes straight to fallback when generate is null (AI unconfigured)", async () => {
    const r = await draftQuestion(DAY, EMPTY_PATTERNS, 1, "2026-07-16", null);
    expect(r.source).toBe("fallback");
  });
});

describe("fallbacks", () => {
  it("are deterministic per (userId, localDate) and vary across days", () => {
    expect(fallbackQuestion(1, "2026-07-16")).toBe(fallbackQuestion(1, "2026-07-16"));
    const days = Array.from({ length: 12 }, (_, i) =>
      fallbackQuestion(1, `2026-07-${String(i + 1).padStart(2, "0")}`));
    expect(new Set(days).size).toBeGreaterThan(1);
    expect(fallbackAck(1, "2026-07-16")).toBe(fallbackAck(1, "2026-07-16"));
  });
  it("fallback pool itself contains no guilt language", () => {
    for (const q of FALLBACK_QUESTIONS) expect(containsGuiltLanguage(q)).toBe(false);
  });
});

describe("draftAck", () => {
  it("uses a valid model ack and falls back otherwise", async () => {
    const good = await draftAck(["timer"], null, 1, "2026-07-16", async () => ({ ack: "Timers it is — noted for your rhythms." }));
    expect(good).toBe("Timers it is — noted for your rhythms.");
    const bad = await draftAck(["timer"], null, 1, "2026-07-16", async () => ({ ack: "You only picked one thing." }));
    expect(containsGuiltLanguage(bad)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- ai/reflection`
Expected: FAIL — cannot resolve `./reflection`.

- [ ] **Step 3: Implement**

```ts
// artifacts/api-server/src/lib/ai/reflection.ts
import { localHour } from "../date-buckets";
import { blockOfHour, type DayBlock, type PatternSummary } from "../patterns";

export const MAX_QUESTION_LENGTH = 140;
export const MAX_ACK_LENGTH = 120;

// The same provider-agnostic seam as task-breakdown.ts.
export type GenerateJson = (prompt: string) => Promise<unknown>;

export interface DaySummary {
  completedQuests: { title: string; category: string }[];
  focusMinutes: number;
  modesSeen: { mode: string; block: DayBlock }[];
  rescueCount: number;
  streakDays: number;
}

/**
 * Anti-shame at the data boundary: this shape has NO channel for unfinished,
 * missed, or overdue work — callers pass completed rows only, so no prompt
 * mistake downstream can leak guilt fuel into the LLM context.
 */
export function buildDaySummary(input: {
  completedToday: { title: string; category: string; completedAt: Date }[];
  focusSecondsToday: number;
  checkinsToday: { mode: string; createdAt: Date }[];
  rescueCountToday: number;
  streakDays: number;
  timeZone: string;
}): DaySummary {
  return {
    completedQuests: input.completedToday.slice(0, 6).map((t) => ({ title: t.title, category: t.category })),
    focusMinutes: Math.round(input.focusSecondsToday / 60),
    modesSeen: input.checkinsToday.map((c) => ({
      mode: c.mode,
      block: blockOfHour(localHour(c.createdAt, input.timeZone)),
    })),
    rescueCount: input.rescueCountToday,
    streakDays: input.streakDays,
  };
}

// Word-boundary regex; curly apostrophes normalized first. Deliberately
// conservative — a false positive just means a curated fallback line.
const GUILT_RE = /\b(should have|didn't|missed|failed|behind|only|just)\b/i;

export function containsGuiltLanguage(text: string): boolean {
  return GUILT_RE.test(text.replace(/’/g, "'"));
}

export const FALLBACK_QUESTIONS: readonly string[] = [
  "What made starting easier today?",
  "When did today feel lightest?",
  "What's one thing that worked in your favor today?",
  "Which moment today would you like more of tomorrow?",
  "What helped you get moving when you did?",
  "What did your energy want to do today?",
  "If today had a soundtrack, when was it in a groove?",
  "What small thing quietly helped today?",
  "When did time feel like it was on your side?",
  "What would past-you be glad you did today?",
  "Which win today felt bigger than it looked?",
  "What's worth remembering about how today went?",
];

const FALLBACK_ACKS: readonly string[] = [
  "Noted for your rhythms — rest well 🌙",
  "Logged. Your future self says thanks.",
  "Got it — every note teaches the map of you.",
  "Saved. That's useful signal, not homework.",
  "Noted. Tomorrow gets a slightly smarter app.",
  "Thanks for the read on today — sleep easy.",
];

/** djb2 — stable tiny hash for deterministic per-day rotation. */
function hashSeed(userId: number, localDate: string): number {
  const s = `${userId}:${localDate}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function fallbackQuestion(userId: number, localDate: string): string {
  return FALLBACK_QUESTIONS[hashSeed(userId, localDate) % FALLBACK_QUESTIONS.length]!;
}

export function fallbackAck(userId: number, localDate: string): string {
  return FALLBACK_ACKS[hashSeed(userId, localDate) % FALLBACK_ACKS.length]!;
}

export function buildReflectionQuestionPrompt(day: DaySummary, patterns: PatternSummary): string {
  const facts: string[] = [];
  if (day.completedQuests.length > 0) {
    facts.push(`Quests completed today: ${day.completedQuests.map((q) => `"${q.title}" (${q.category})`).join(", ")}`);
  }
  if (day.focusMinutes > 0) facts.push(`Focused minutes today: ${day.focusMinutes}`);
  if (day.modesSeen.length > 0) {
    facts.push(`Brain check-ins today: ${day.modesSeen.map((m) => `${m.mode} in the ${m.block}`).join(", ")}`);
  }
  if (day.rescueCount > 0) facts.push(`They unblocked themselves ${day.rescueCount} time(s) using a rescue tool.`);
  if (day.streakDays > 0) facts.push(`Current streak: ${day.streakDays} day(s).`);
  if (patterns.confidence !== "none" && patterns.powerHours.length > 0) {
    facts.push(`Historically strong hours (24h local): ${patterns.powerHours.map((p) => p.hour).join(", ")}`);
  }
  if (patterns.topHelpers.length > 0) facts.push(`Things that usually help them: ${patterns.topHelpers.join(", ")}`);

  return `You write ONE short end-of-day reflection question for a person with ADHD, based on today's wins below.

Hard rules — every one is mandatory:
- Ask about PROCESS (what helped, what got in the way, how it felt) — NEVER about output, productivity, or amounts.
- NEVER mention unfinished, remaining, missed, or planned work. You only know about what they DID.
- Warm and curious, zero pressure, no advice, no praise inflation.
- One single question, at most ${MAX_QUESTION_LENGTH} characters, ends with a question mark.
- Never use guilt words (should, didn't, missed, failed, behind, only, just).

Today's facts:
${facts.length > 0 ? facts.join("\n") : "A quiet day — no logged events."}

Respond with JSON only, in this exact shape: {"question": "..."}`;
}

function buildAckPrompt(chips: string[], freeText: string | null): string {
  return `A person with ADHD just answered an end-of-day reflection. They tapped: ${chips.length > 0 ? chips.join(", ") : "(none)"}${freeText ? `; and wrote: "${freeText}"` : ""}.

Write ONE warm closing line (max ${MAX_ACK_LENGTH} characters) acknowledging what they shared. No advice, no questions, no praise inflation, no guilt words (should, didn't, missed, failed, behind, only, just).

Respond with JSON only, in this exact shape: {"ack": "..."}`;
}

function parseLine(raw: unknown, key: "question" | "ack", maxLen: number): string {
  const val = (raw as Record<string, unknown> | null)?.[key];
  if (typeof val !== "string") throw new Error(`Model output missing string "${key}"`);
  const text = val.trim();
  if (text.length === 0 || text.length > maxLen) throw new Error(`"${key}" empty or over ${maxLen} chars`);
  if (containsGuiltLanguage(text)) throw new Error(`"${key}" contains guilt language`);
  return text;
}

export async function draftQuestion(
  day: DaySummary, patterns: PatternSummary,
  userId: number, localDate: string,
  generate: GenerateJson | null,
): Promise<{ question: string; source: "ai" | "fallback" }> {
  if (generate) {
    try {
      const raw = await generate(buildReflectionQuestionPrompt(day, patterns));
      return { question: parseLine(raw, "question", MAX_QUESTION_LENGTH), source: "ai" };
    } catch {
      // fall through — the flow never blocks on the model
    }
  }
  return { question: fallbackQuestion(userId, localDate), source: "fallback" };
}

export async function draftAck(
  chips: string[], freeText: string | null,
  userId: number, localDate: string,
  generate: GenerateJson | null,
): Promise<string> {
  if (generate) {
    try {
      return parseLine(await generate(buildAckPrompt(chips, freeText)), "ack", MAX_ACK_LENGTH);
    } catch {
      // fall through
    }
  }
  return fallbackAck(userId, localDate);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- ai/reflection`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/ai/reflection.ts artifacts/api-server/src/lib/ai/reflection.test.ts
git commit -m "feat(api): reflection question/ack drafting — anti-shame guards, deterministic fallbacks"
```

---

### Task 5: Server reflection helpers — answer validation + cron decision

**Files:**
- Create: `artifacts/api-server/src/lib/reflections.ts`
- Test: `artifacts/api-server/src/lib/reflections.test.ts`

**Interfaces:**
- Consumes: `ReflectionHelpedChip`, `ReflectionHinderedChip` from `@workspace/api-zod` (Task 2).
- Produces (Tasks 6, 7 import these):

```ts
export const REFLECTION_XP = 5;
export const MAX_FREE_TEXT = 500;
export function isReflectionChip(x: unknown): boolean;
export type AnswerValidation =
  | { ok: true; chips: string[]; freeText: string | null }
  | { ok: false; error: string };
export function validateAnswer(body: unknown): AnswerValidation;
export function shouldPromptReflection(i: {
  localHour: number;
  promptedToday: boolean;   // reflection_prompted_date === localToday
  answeredToday: boolean;
  hadSignalToday: boolean;
  hasTimezone: boolean;
}): boolean;
```

- [ ] **Step 1: Write the failing tests**

```ts
// artifacts/api-server/src/lib/reflections.test.ts
import { describe, it, expect } from "vitest";
import { isReflectionChip, validateAnswer, shouldPromptReflection, MAX_FREE_TEXT } from "./reflections";

describe("isReflectionChip", () => {
  it("accepts keys from both generated enums, rejects everything else", () => {
    expect(isReflectionChip("timer")).toBe(true);       // helped
    expect(isReflectionChip("low_energy")).toBe(true);  // hindered
    expect(isReflectionChip("procrastinated")).toBe(false);
    expect(isReflectionChip(42)).toBe(false);
  });
});

describe("validateAnswer", () => {
  it("accepts chips-only, text-only, and both", () => {
    expect(validateAnswer({ chips: ["timer"] })).toEqual({ ok: true, chips: ["timer"], freeText: null });
    expect(validateAnswer({ chips: [], freeText: "long day" })).toEqual({ ok: true, chips: [], freeText: "long day" });
    expect(validateAnswer({ chips: ["too_big"], freeText: " hi " })).toEqual({ ok: true, chips: ["too_big"], freeText: "hi" });
  });
  it("rejects unknown chips, empty answers, non-arrays, and oversize text", () => {
    expect(validateAnswer({ chips: ["nope"] }).ok).toBe(false);
    expect(validateAnswer({ chips: [] }).ok).toBe(false);
    expect(validateAnswer({ chips: [], freeText: "   " }).ok).toBe(false);
    expect(validateAnswer({ chips: "timer" }).ok).toBe(false);
    expect(validateAnswer({}).ok).toBe(false);
    expect(validateAnswer({ chips: [], freeText: "x".repeat(MAX_FREE_TEXT + 1) }).ok).toBe(false);
  });
  it("de-duplicates repeated chips", () => {
    expect(validateAnswer({ chips: ["timer", "timer"] })).toEqual({ ok: true, chips: ["timer"], freeText: null });
  });
});

describe("shouldPromptReflection", () => {
  const base = { localHour: 20, promptedToday: false, answeredToday: false, hadSignalToday: true, hasTimezone: true };
  it("fires inside the [19,22) window with all gates open", () => {
    expect(shouldPromptReflection(base)).toBe(true);
    expect(shouldPromptReflection({ ...base, localHour: 19 })).toBe(true);
    expect(shouldPromptReflection({ ...base, localHour: 21 })).toBe(true);
  });
  it("stays silent outside the window", () => {
    expect(shouldPromptReflection({ ...base, localHour: 18 })).toBe(false);
    expect(shouldPromptReflection({ ...base, localHour: 22 })).toBe(false);
  });
  it("dedups, skips answered days, skips zero-signal days (anti-shame), skips no-tz users", () => {
    expect(shouldPromptReflection({ ...base, promptedToday: true })).toBe(false);
    expect(shouldPromptReflection({ ...base, answeredToday: true })).toBe(false);
    expect(shouldPromptReflection({ ...base, hadSignalToday: false })).toBe(false);
    expect(shouldPromptReflection({ ...base, hasTimezone: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- lib/reflections`
Expected: FAIL — cannot resolve `./reflections`.

- [ ] **Step 3: Implement**

```ts
// artifacts/api-server/src/lib/reflections.ts
import { ReflectionHelpedChip, ReflectionHinderedChip } from "@workspace/api-zod";

export const REFLECTION_XP = 5;
export const MAX_FREE_TEXT = 500;

const ALL_CHIPS = new Set<string>([
  ...Object.values(ReflectionHelpedChip),
  ...Object.values(ReflectionHinderedChip),
]);

export function isReflectionChip(x: unknown): boolean {
  return typeof x === "string" && ALL_CHIPS.has(x);
}

export type AnswerValidation =
  | { ok: true; chips: string[]; freeText: string | null }
  | { ok: false; error: string };

export function validateAnswer(body: unknown): AnswerValidation {
  const chips = (body as { chips?: unknown } | null)?.chips;
  if (!Array.isArray(chips)) return { ok: false, error: "chips must be an array" };
  for (const c of chips) {
    if (!isReflectionChip(c)) return { ok: false, error: `Unknown chip: ${String(c)}` };
  }
  const rawText = (body as { freeText?: unknown }).freeText;
  if (rawText != null && typeof rawText !== "string") return { ok: false, error: "freeText must be a string" };
  const trimmed = typeof rawText === "string" ? rawText.trim() : "";
  if (trimmed.length > MAX_FREE_TEXT) return { ok: false, error: `freeText over ${MAX_FREE_TEXT} chars` };

  const unique = [...new Set(chips as string[])];
  const freeText = trimmed.length > 0 ? trimmed : null;
  if (unique.length === 0 && freeText === null) return { ok: false, error: "Empty answer" };
  return { ok: true, chips: unique, freeText };
}

/**
 * The whole evening-push decision, pure. The scheduler may pre-gate on the
 * cheap fields to skip queries, but this function is the authority (and the
 * only place the rules are tested).
 */
export function shouldPromptReflection(i: {
  localHour: number;
  promptedToday: boolean;
  answeredToday: boolean;
  hadSignalToday: boolean;
  hasTimezone: boolean;
}): boolean {
  return (
    i.hasTimezone &&
    i.localHour >= 19 && i.localHour < 22 &&
    !i.promptedToday &&
    !i.answeredToday &&
    i.hadSignalToday // zero-signal day ⇒ silence (anti-shame)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- lib/reflections`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/reflections.ts artifacts/api-server/src/lib/reflections.test.ts
git commit -m "feat(api): reflection answer validation + evening-push decision (pure)"
```

---

### Task 6: Routes — `/reflections/today` (GET/POST) + `/users/me/patterns`

**Files:**
- Create: `artifacts/api-server/src/routes/reflections.ts`
- Create: `artifacts/api-server/src/routes/patterns.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (mount both)

**Interfaces:**
- Consumes: `derivePatterns`, `PATTERN_WINDOW_DAYS` (Task 3); `buildDaySummary`, `draftQuestion`, `draftAck`, `fallbackQuestion` (Task 4); `validateAnswer`, `REFLECTION_XP` (Task 5); `generateJson`, `isAiConfigured` from `../lib/ai/client`; `getLevelInfo` from `../lib/gamification`; `resolveTimeZone`, `localDateKey`, `localDayStartUtc` from `../lib/date-buckets`; `reflectionsTable`, `tasksTable`, `focusSessionsTable`, `brainCheckinsTable`, `rescueEventsTable`, `usersTable`, `activityTable` from `@workspace/db`.
- Produces: the three wire endpoints of Task 2. No route tests (repo convention: routes thin, logic tested in libs).

Routes are auth-guarded exactly like `brain.ts`: `if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }` then `const userId = req.gameUserId!;`.

- [ ] **Step 1: Shared patterns-input loader + patterns route**

```ts
// artifacts/api-server/src/routes/patterns.ts
import { Router, type IRouter } from "express";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import {
  db, tasksTable, focusSessionsTable, brainCheckinsTable, reflectionsTable, usersTable,
} from "@workspace/db";
import { derivePatterns, PATTERN_WINDOW_DAYS, type PatternInputs } from "../lib/patterns";
import { resolveTimeZone } from "../lib/date-buckets";

const router: IRouter = Router();

/** Load the four 28-day row sets derivePatterns needs. Exported for reflections.ts. */
export async function loadPatternInputs(userId: number, timeZone: string, now: Date): Promise<PatternInputs> {
  const cutoff = new Date(now.getTime() - PATTERN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const completions = await db
    .select({
      completedAt: tasksTable.completedAt,
      category: tasksTable.category,
      estimatedMinutes: tasksTable.estimatedMinutes,
      actualMinutes: tasksTable.actualMinutes,
    })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.userId, userId),
      eq(tasksTable.completed, true),
      isNotNull(tasksTable.completedAt),
      gte(tasksTable.completedAt, cutoff),
    ));

  const focusSessions = await db
    .select({ startedAt: focusSessionsTable.startedAt, focusedSeconds: focusSessionsTable.focusedSeconds })
    .from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, userId), gte(focusSessionsTable.startedAt, cutoff)));

  const checkins = await db
    .select({ mode: brainCheckinsTable.mode, createdAt: brainCheckinsTable.createdAt })
    .from(brainCheckinsTable)
    .where(and(eq(brainCheckinsTable.userId, userId), gte(brainCheckinsTable.createdAt, cutoff)));

  const answered = await db
    .select({ chips: reflectionsTable.chips })
    .from(reflectionsTable)
    .where(and(
      eq(reflectionsTable.userId, userId),
      isNotNull(reflectionsTable.answeredAt),
      gte(reflectionsTable.createdAt, cutoff),
    ));

  return {
    now,
    timeZone,
    completions: completions.map((c) => ({ ...c, completedAt: c.completedAt! })),
    focusSessions,
    checkins,
    reflections: answered.map((r) => ({ chips: r.chips })),
  };
}

/** users.timezone beats the query param beats UTC (spec §3). */
export async function resolveUserTimeZone(userId: number, queryTz: unknown): Promise<string> {
  const [u] = await db.select({ tz: usersTable.timezone }).from(usersTable).where(eq(usersTable.id, userId));
  return resolveTimeZone(u?.tz ?? (typeof queryTz === "string" ? queryTz : undefined));
}

router.get("/users/me/patterns", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const timeZone = await resolveUserTimeZone(userId, req.query.tz);
  const inputs = await loadPatternInputs(userId, timeZone, new Date());
  res.json(derivePatterns(inputs));
});

export default router;
```

- [ ] **Step 2: Reflections route**

```ts
// artifacts/api-server/src/routes/reflections.ts
import { Router, type IRouter } from "express";
import { and, eq, gte, isNull } from "drizzle-orm";
import {
  db, reflectionsTable, tasksTable, focusSessionsTable, brainCheckinsTable,
  rescueEventsTable, usersTable, activityTable, type Reflection,
} from "@workspace/db";
import { localDateKey, localDayStartUtc } from "../lib/date-buckets";
import { derivePatterns } from "../lib/patterns";
import { buildDaySummary, draftQuestion, draftAck, fallbackQuestion } from "../lib/ai/reflection";
import { validateAnswer, REFLECTION_XP } from "../lib/reflections";
import { generateJson, isAiConfigured } from "../lib/ai/client";
import { getLevelInfo } from "../lib/gamification";
import { loadPatternInputs, resolveUserTimeZone } from "./patterns";

const router: IRouter = Router();

function serialize(r: Reflection) {
  return {
    id: r.id,
    localDate: r.localDate,
    prompt: r.prompt,
    promptSource: r.promptSource,
    chips: r.chips,
    freeText: r.freeText,
    ack: r.ack,
    answeredAt: r.answeredAt ? r.answeredAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function todayRow(userId: number, localDate: string): Promise<Reflection | undefined> {
  const [row] = await db.select().from(reflectionsTable)
    .where(and(eq(reflectionsTable.userId, userId), eq(reflectionsTable.localDate, localDate)));
  return row;
}

/** Draft today's question and insert the row; race-safe via the unique constraint. */
async function draftToday(userId: number, timeZone: string, localDate: string, now: Date): Promise<Reflection> {
  const dayStart = localDayStartUtc(localDate, timeZone);

  const completedToday = await db
    .select({ title: tasksTable.title, category: tasksTable.category, completedAt: tasksTable.completedAt })
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, true), gte(tasksTable.completedAt, dayStart)));

  const focusToday = await db
    .select({ focusedSeconds: focusSessionsTable.focusedSeconds })
    .from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, userId), gte(focusSessionsTable.startedAt, dayStart)));

  const checkinsToday = await db
    .select({ mode: brainCheckinsTable.mode, createdAt: brainCheckinsTable.createdAt })
    .from(brainCheckinsTable)
    .where(and(eq(brainCheckinsTable.userId, userId), gte(brainCheckinsTable.createdAt, dayStart)));

  const rescuesToday = await db
    .select({ id: rescueEventsTable.id })
    .from(rescueEventsTable)
    .where(and(eq(rescueEventsTable.userId, userId), gte(rescueEventsTable.createdAt, dayStart)));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  const day = buildDaySummary({
    completedToday: completedToday.map((t) => ({ ...t, completedAt: t.completedAt! })),
    focusSecondsToday: focusToday.reduce((s, f) => s + f.focusedSeconds, 0),
    checkinsToday,
    rescueCountToday: rescuesToday.length,
    streakDays: user?.streakDays ?? 0,
    timeZone,
  });
  const patterns = derivePatterns(await loadPatternInputs(userId, timeZone, now));

  const { question, source } = await draftQuestion(
    day, patterns, userId, localDate,
    isAiConfigured() ? generateJson : null,
  );

  const [inserted] = await db.insert(reflectionsTable)
    .values({ userId, localDate, prompt: question, promptSource: source, chips: [] })
    .onConflictDoNothing()
    .returning();
  // Lost the race to a concurrent first-open — the winner's row is today's row.
  return inserted ?? (await todayRow(userId, localDate))!;
}

router.get("/reflections/today", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const now = new Date();
  const timeZone = await resolveUserTimeZone(userId, req.query.tz);
  const localDate = localDateKey(now, timeZone);

  const existing = await todayRow(userId, localDate);
  if (existing) { res.json({ reflection: serialize(existing) }); return; }

  if (String(req.query.draft ?? "") !== "true") {
    res.json({ reflection: null });
    return;
  }
  res.json({ reflection: serialize(await draftToday(userId, timeZone, localDate, now)) });
});

router.post("/reflections/today", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const v = validateAnswer(req.body);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }

  const now = new Date();
  const timeZone = await resolveUserTimeZone(userId, req.body?.tz);
  const localDate = localDateKey(now, timeZone);

  let row = await todayRow(userId, localDate);
  if (!row) {
    const [inserted] = await db.insert(reflectionsTable)
      .values({ userId, localDate, prompt: fallbackQuestion(userId, localDate), promptSource: "fallback", chips: [] })
      .onConflictDoNothing()
      .returning();
    row = inserted ?? (await todayRow(userId, localDate))!;
  }
  const rowId = row.id;

  let xpAwarded = 0;
  await db.transaction(async (tx) => {
    // First-answer claim: atomic via the answered_at IS NULL predicate.
    const claimed = await tx.update(reflectionsTable)
      .set({ answeredAt: now })
      .where(and(eq(reflectionsTable.id, rowId), isNull(reflectionsTable.answeredAt)))
      .returning({ id: reflectionsTable.id });

    await tx.update(reflectionsTable)
      .set({ chips: v.chips, freeText: v.freeText })
      .where(eq(reflectionsTable.id, rowId));

    if (claimed.length > 0) {
      // Content-free activity row — the fact of reflecting is shame-safe; the
      // content never leaves the reflections table (spec §1).
      await tx.insert(activityTable).values({
        userId, type: "reflection", description: "Evening reflection", points: REFLECTION_XP,
      });
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
      if (user) {
        const newTotal = user.totalPoints + REFLECTION_XP;
        await tx.update(usersTable).set({
          totalPoints: newTotal,
          weeklyPoints: user.weeklyPoints + REFLECTION_XP,
          currentLevel: getLevelInfo(newTotal).level,
        }).where(eq(usersTable.id, userId));
      }
      xpAwarded = REFLECTION_XP;
    }
  });

  // Ack AFTER the commit; on model failure the fallback is stored (spec §4).
  const ack = await draftAck(v.chips, v.freeText, userId, localDate, isAiConfigured() ? generateJson : null);
  await db.update(reflectionsTable).set({ ack }).where(eq(reflectionsTable.id, rowId));

  const final = (await todayRow(userId, localDate))!;
  res.json({ reflection: serialize(final), xpAwarded });
});

export default router;
```

Notes on the POST body: the `isNull(reflectionsTable.answeredAt)` predicate makes the
first-answer claim atomic (drizzle's `eq(col, null)` does NOT emit `IS NULL`); the
answer + XP commit BEFORE any LLM call so the ack can never hold locks or block the
save (spec §4); the chips/freeText update runs unconditionally so same-day re-answers
save without re-paying XP.

- [ ] **Step 3: Mount the routers**

In `artifacts/api-server/src/routes/index.ts` add imports and mounts (after `statPerksRouter` lines, matching style):

```ts
import patternsRouter from "./patterns";
import reflectionsRouter from "./reflections";
// …
router.use(patternsRouter);
router.use(reflectionsRouter);
```

- [ ] **Step 4: Typecheck + full server suite**

Run: `pnpm typecheck && pnpm --filter @workspace/api-server test`
Expected: both exit 0 (routes are exercised indirectly; the suite guards against import/type breakage).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/patterns.ts artifacts/api-server/src/routes/reflections.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): reflections today GET/POST + /users/me/patterns routes"
```

---

### Task 7: Cron evening push + push deep link

**Files:**
- Modify: `artifacts/api-server/src/lib/notification-scheduler.ts`
- Modify: `artifacts/focusquest/public/sw.js` (notificationclick deep link)

**Interfaces:**
- Consumes: `shouldPromptReflection` (Task 5), `reflectionsTable` (Task 1), existing `notify`/`localDateKey`/`localHour`/`localDayStartUtc`/`resolveTimeZone`.
- Produces: `checkReflectionPrompts()` registered in `tick()` as `"reflection-prompts"`; `notify()` gains an optional `data` param; sw.js opens `payload.data.url`.

The decision logic is already fully unit-tested in Task 5 (repo convention: the scheduler wiring itself is not unit-tested, same as the hyperfocus and hero-care passes).

- [ ] **Step 1: Extend `notify` with a data payload**

In `notification-scheduler.ts`, change `notify` to:

```ts
async function notify(userId: number, title: string, body: string, tag: string, data?: Record<string, unknown>) {
  const subs = await getSubscriptions(userId);
  for (const sub of subs) {
    const ok = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title, body, tag, ...(data ? { data } : {}) },
    );
    if (!ok) {
      await removeSubscription(sub.endpoint);
    }
  }
}
```

(All existing call sites are unaffected — the param is optional.)

- [ ] **Step 2: Add the reflection pass**

Add these imports to the existing import block in `notification-scheduler.ts`:

```ts
import { reflectionsTable, rescueEventsTable } from "@workspace/db"; // merge into the existing @workspace/db import
import { localDayStartUtc } from "./date-buckets";                  // merge into the existing date-buckets import
import { shouldPromptReflection } from "./reflections";
import { gte, isNotNull } from "drizzle-orm";                       // merge into the existing drizzle-orm import
```

Then add the pass (after `checkHyperfocusProtection`):

```ts
async function checkReflectionPrompts() {
  const now = new Date();
  const users = await db.select().from(usersTable);
  for (const user of users) {
    try {
      // Cheap pre-gates to skip per-user queries; shouldPromptReflection stays
      // the tested authority on the full rule set.
      if (!user.timezone) continue; // no tz ⇒ can't compute a local evening (spec §6)
      const tz = resolveTimeZone(user.timezone);
      const hour = localHour(now, tz);
      const localToday = localDateKey(now, tz);
      if (hour < 19 || hour >= 22 || user.reflectionPromptedDate === localToday) continue;

      const dayStart = localDayStartUtc(localToday, tz);

      const [todayReflection] = await db.select({ answeredAt: reflectionsTable.answeredAt })
        .from(reflectionsTable)
        .where(and(eq(reflectionsTable.userId, user.id), eq(reflectionsTable.localDate, localToday)));

      const [completion] = await db.select({ id: tasksTable.id }).from(tasksTable)
        .where(and(
          eq(tasksTable.userId, user.id), eq(tasksTable.completed, true),
          isNotNull(tasksTable.completedAt), gte(tasksTable.completedAt, dayStart),
        )).limit(1);
      const [focus] = await db.select({ id: focusSessionsTable.id }).from(focusSessionsTable)
        .where(and(
          eq(focusSessionsTable.userId, user.id),
          gte(focusSessionsTable.startedAt, dayStart),
          gte(focusSessionsTable.completedIntervals, 1),
        )).limit(1);
      const [checkin] = await db.select({ id: brainCheckinsTable.id }).from(brainCheckinsTable)
        .where(and(eq(brainCheckinsTable.userId, user.id), gte(brainCheckinsTable.createdAt, dayStart)))
        .limit(1);

      const should = shouldPromptReflection({
        localHour: hour,
        promptedToday: user.reflectionPromptedDate === localToday,
        answeredToday: todayReflection?.answeredAt != null,
        hadSignalToday: Boolean(completion || focus || checkin),
        hasTimezone: true,
      });
      if (!should) continue;

      await notify(
        user.id,
        "🌙 How did today feel?",
        "1-minute reflection — what worked today?",
        "reflection-prompt",
        { url: "/reflection" },
      );
      await db.update(usersTable)
        .set({ reflectionPromptedDate: localToday })
        .where(eq(usersTable.id, user.id));
    } catch (err) {
      logger.error({ err, userId: user.id }, "Reflection-prompt pass failed for user");
    }
  }
}
```

And register it in `tick()` before the `return ran;`:

```ts
  await checkReflectionPrompts();
  ran.push("reflection-prompts");
```

- [ ] **Step 3: Deep link in the service worker**

In `artifacts/focusquest/public/sw.js`, replace the `notificationclick` handler body with:

```js
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
        if (url !== "/" && clients[0].navigate) {
          return clients[0].navigate(url);
        }
      } else {
        return self.clients.openWindow(url);
      }
    })
  );
});
```

- [ ] **Step 4: Typecheck + server suite**

Run: `pnpm typecheck && pnpm --filter @workspace/api-server test`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/notification-scheduler.ts artifacts/focusquest/public/sw.js
git commit -m "feat(api): evening reflection push in cron tick + push deep links"
```

---

### Task 8: Client pure libs — chips, evening window, rhythms

**Files:**
- Create: `artifacts/focusquest/src/lib/reflection-chips.ts` + `reflection-chips.test.ts`
- Create: `artifacts/focusquest/src/lib/reflection-window.ts` + `reflection-window.test.ts`
- Create: `artifacts/focusquest/src/lib/rhythms.ts` + `rhythms.test.ts`

**Interfaces:**
- Consumes: `ReflectionHelpedChip`, `ReflectionHinderedChip`, `type ReflectionChip`, `type PatternSummary` from `@workspace/api-client-react` (Task 2 codegen — verify export names in `lib/api-client-react/src/generated/api.schemas.ts`; if the const objects are only exported from `@workspace/api-zod`, import from there instead and note it).
- Produces (Task 9/10 import these):

```ts
// reflection-chips.ts
export const HELPED_CHIPS: ReflectionChip[];
export const HINDERED_CHIPS: ReflectionChip[];
export const CHIP_LABELS: Record<ReflectionChip, string>;
// reflection-window.ts
export function eveningCardVisible(now: Date, answeredToday: boolean): boolean;
// rhythms.ts
export type RhythmsState = "empty" | "early" | "full";
export function rhythmsState(s: PatternSummary): RhythmsState;
export function formatPowerHours(powerHours: { hour: number }[]): string;
export function rhythmsLines(s: PatternSummary): string[];
```

- [ ] **Step 1: Write the failing tests**

```ts
// artifacts/focusquest/src/lib/reflection-chips.test.ts
import { describe, it, expect } from "vitest";
import { HELPED_CHIPS, HINDERED_CHIPS, CHIP_LABELS } from "./reflection-chips";

describe("reflection chips", () => {
  it("groups don't overlap and every chip has a label", () => {
    const overlap = HELPED_CHIPS.filter((c) => (HINDERED_CHIPS as string[]).includes(c));
    expect(overlap).toEqual([]);
    for (const c of [...HELPED_CHIPS, ...HINDERED_CHIPS]) {
      expect(CHIP_LABELS[c]).toBeTruthy();
    }
  });
});
```

```ts
// artifacts/focusquest/src/lib/reflection-window.test.ts
import { describe, it, expect } from "vitest";
import { eveningCardVisible } from "./reflection-window";

const at = (h: number) => new Date(2026, 6, 16, h, 30);

describe("eveningCardVisible", () => {
  it("shows from 17:00 local through midnight while unanswered", () => {
    expect(eveningCardVisible(at(16), false)).toBe(false);
    expect(eveningCardVisible(at(17), false)).toBe(true);
    expect(eveningCardVisible(at(23), false)).toBe(true);
    expect(eveningCardVisible(at(0), false)).toBe(false);
  });
  it("hides once answered", () => {
    expect(eveningCardVisible(at(20), true)).toBe(false);
  });
});
```

```ts
// artifacts/focusquest/src/lib/rhythms.test.ts
import { describe, it, expect } from "vitest";
import { rhythmsState, formatPowerHours, rhythmsLines } from "./rhythms";
import type { PatternSummary } from "@workspace/api-client-react";

function summary(over: Partial<PatternSummary> = {}): PatternSummary {
  return {
    windowDays: 28,
    sampleSize: { completions: 20, focusMinutes: 100, checkins: 5, reflections: 3 },
    confidence: "ok",
    powerHours: [{ hour: 9, score: 5 }, { hour: 10, score: 4 }],
    bestDay: 2,
    medianQuestMinutes: 20,
    categoryMinutes: [],
    modeByBlock: [],
    topHelpers: ["small_steps"],
    topBlockers: ["low_energy"],
    ...over,
  } as PatternSummary;
}

describe("rhythmsState", () => {
  it("maps confidence to card state", () => {
    expect(rhythmsState(summary({ confidence: "none" }))).toBe("empty");
    expect(rhythmsState(summary({ confidence: "low" }))).toBe("early");
    expect(rhythmsState(summary({ confidence: "ok" }))).toBe("full");
  });
});

describe("formatPowerHours", () => {
  it("renders a contiguous run as a range (end exclusive)", () => {
    expect(formatPowerHours([{ hour: 9 }, { hour: 10 }])).toBe("9–11am");
  });
  it("renders separate hours as a list and handles noon/midnight", () => {
    expect(formatPowerHours([{ hour: 9 }, { hour: 14 }])).toBe("9–10am, 2–3pm");
    expect(formatPowerHours([{ hour: 0 }])).toBe("12–1am");
    expect(formatPowerHours([{ hour: 11 }, { hour: 12 }])).toBe("11am–1pm");
    expect(formatPowerHours([{ hour: 23 }])).toBe("11pm–12am");
  });
  it("is empty-safe", () => {
    expect(formatPowerHours([])).toBe("");
  });
});

describe("rhythmsLines", () => {
  it("emits only positive framings and skips missing facts", () => {
    const lines = rhythmsLines(summary());
    expect(lines.some((l) => l.includes("9–11am"))).toBe(true);
    expect(lines.some((l) => l.includes("Tuesday"))).toBe(true);
    expect(lines.some((l) => l.includes("~20 min"))).toBe(true);
    expect(lines.some((l) => l.includes("Small steps"))).toBe(true);
    // Blockers feed the LLM, never this card (spec §7).
    expect(lines.join(" ")).not.toMatch(/low energy/i);
  });
  it("drops null facts", () => {
    const lines = rhythmsLines(summary({ bestDay: null, medianQuestMinutes: null, topHelpers: [] }));
    expect(lines).toHaveLength(1); // just power hours
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/focusquest test -- reflection`
then: `pnpm --filter @workspace/focusquest test -- rhythms`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three libs**

```ts
// artifacts/focusquest/src/lib/reflection-chips.ts
import {
  ReflectionHelpedChip, ReflectionHinderedChip, type ReflectionChip,
} from "@workspace/api-client-react";

export const HELPED_CHIPS = Object.values(ReflectionHelpedChip) as ReflectionChip[];
export const HINDERED_CHIPS = Object.values(ReflectionHinderedChip) as ReflectionChip[];

// Record<ReflectionChip, string> is exhaustive — a new enum key without a
// label is a compile error, keeping client copy in lockstep with the contract.
export const CHIP_LABELS: Record<ReflectionChip, string> = {
  timer: "A timer",
  small_steps: "Small steps",
  body_double: "Someone with me",
  right_time: "Right time of day",
  low_stakes: "Low stakes",
  treat_reward: "A reward waiting",
  low_energy: "Low energy",
  too_many_switches: "Too much switching",
  too_big: "Too big to start",
  distractions: "Distractions",
  time_slipped: "Time slipped away",
  pressure: "Pressure",
};
```

```ts
// artifacts/focusquest/src/lib/reflection-window.ts
/** Dashboard evening-card visibility: local 17:00 → midnight, unanswered only.
 * An unanswered day simply disappears at midnight — no badge, no backlog
 * (anti-shame). */
export function eveningCardVisible(now: Date, answeredToday: boolean): boolean {
  return !answeredToday && now.getHours() >= 17;
}
```

```ts
// artifacts/focusquest/src/lib/rhythms.ts
import type { PatternSummary } from "@workspace/api-client-react";
import { CHIP_LABELS } from "./reflection-chips";

export type RhythmsState = "empty" | "early" | "full";

export function rhythmsState(s: PatternSummary): RhythmsState {
  if (s.confidence === "none") return "empty";
  if (s.confidence === "low") return "early";
  return "full";
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourLabel(h: number): string {
  const norm = ((h % 24) + 24) % 24;
  if (norm === 0) return "12am";
  if (norm < 12) return `${norm}am`;
  if (norm === 12) return "12pm";
  return `${norm - 12}pm`;
}

/** "9–11am" style ranges: sort, merge contiguous hours, end is exclusive.
 * Shared am/pm suffix collapses ("9–11am"), mixed keeps both ("11am–1pm"). */
export function formatPowerHours(powerHours: { hour: number }[]): string {
  if (powerHours.length === 0) return "";
  const hours = [...new Set(powerHours.map((p) => p.hour))].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const h of hours) {
    const last = runs[runs.length - 1];
    if (last && h === last[1]) last[1] = h + 1;
    else runs.push([h, h + 1]);
  }
  return runs
    .map(([start, endEx]) => {
      const a = hourLabel(start);
      const b = hourLabel(endEx);
      const aSuffix = a.slice(-2);
      const bSuffix = b.slice(-2);
      return aSuffix === bSuffix ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`;
    })
    .join(", ");
}

/** Positive framings only — blockers never render here (spec §7). */
export function rhythmsLines(s: PatternSummary): string[] {
  const lines: string[] = [];
  if (s.powerHours.length > 0) lines.push(`You're strongest ${formatPowerHours(s.powerHours)}`);
  if (s.bestDay != null) lines.push(`${DAY_NAMES[s.bestDay]}s are your day`);
  if (s.medianQuestMinutes != null) lines.push(`Most quests take you ~${s.medianQuestMinutes} min`);
  const topHelper = s.topHelpers[0];
  if (topHelper) lines.push(`"${CHIP_LABELS[topHelper]}" helps you most`);
  return lines;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test -- reflection` and `pnpm --filter @workspace/focusquest test -- rhythms`
Expected: PASS (all). If `ReflectionHelpedChip` isn't exported from `@workspace/api-client-react`, check `lib/api-client-react/src/generated/api.schemas.ts` for the actual export and adjust the import — never edit generated files.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/reflection-chips.ts artifacts/focusquest/src/lib/reflection-chips.test.ts artifacts/focusquest/src/lib/reflection-window.ts artifacts/focusquest/src/lib/reflection-window.test.ts artifacts/focusquest/src/lib/rhythms.ts artifacts/focusquest/src/lib/rhythms.test.ts
git commit -m "feat(web): reflection chip/window/rhythms libs (pure, tested)"
```

---

### Task 9: Reflection page + dashboard evening card

**Files:**
- Create: `artifacts/focusquest/src/pages/reflection.tsx`
- Create: `artifacts/focusquest/src/components/evening-reflection-card.tsx`
- Modify: `artifacts/focusquest/src/App.tsx` (route)
- Modify: `artifacts/focusquest/src/pages/dashboard.tsx` (mount card)

**Interfaces:**
- Consumes: `useGetTodayReflection`, `getGetTodayReflectionQueryKey`, `useAnswerTodayReflection`, `getGetMyStatsQueryKey` from `@workspace/api-client-react`; `HELPED_CHIPS`, `HINDERED_CHIPS`, `CHIP_LABELS` and `eveningCardVisible` (Task 8); `browserTimeZone` from `@/lib/timezone`; shadcn `Card`/`Button`/`Textarea`; wouter `Link`.
- Produces: route `/reflection`; `<EveningReflectionCard />` mounted on the dashboard.

Component conventions to follow: function components, TanStack Query invalidation after mutations (see `dashboard.tsx` freeze purchase), lucide icons, Tailwind classes matching the neon-dark theme.

- [ ] **Step 1: Reflection page**

```tsx
// artifacts/focusquest/src/pages/reflection.tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTodayReflection, getGetTodayReflectionQueryKey,
  useAnswerTodayReflection, getGetMyStatsQueryKey,
  type ReflectionChip,
} from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { HELPED_CHIPS, HINDERED_CHIPS, CHIP_LABELS } from "@/lib/reflection-chips";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Moon, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";

function ChipGroup({ title, chips, selected, onToggle }: {
  title: string;
  chips: ReflectionChip[];
  selected: Set<ReflectionChip>;
  onToggle: (chip: ReflectionChip) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const active = selected.has(chip);
          return (
            <button
              key={chip}
              type="button"
              onClick={() => onToggle(chip)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card text-foreground hover:border-primary/40"
              }`}
            >
              {CHIP_LABELS[chip]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Reflection() {
  const tz = browserTimeZone();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetTodayReflection({ tz, draft: true });
  const answer = useAnswerTodayReflection();
  const [selected, setSelected] = useState<Set<ReflectionChip>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [editing, setEditing] = useState(false);

  const reflection = data?.reflection ?? null;
  const answered = reflection?.answeredAt != null && !editing;

  function toggle(chip: ReflectionChip) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  }

  async function submit() {
    try {
      await answer.mutateAsync({ data: { chips: [...selected], freeText: freeText.trim() || undefined, tz } });
      // Both cache keys: the page fetches with draft=true, the dashboard card
      // without — invalidate each so the evening card hides after answering.
      await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz, draft: true }) });
      await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz }) });
      await qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
      setEditing(false);
    } catch (err) {
      toast({ title: "Couldn't save", description: apiErrorMessage(err), variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-xl mx-auto py-10 text-center text-muted-foreground" aria-busy="true">
        <Moon className="w-6 h-6 mx-auto mb-2 animate-pulse text-primary" />
        Setting up tonight's reflection…
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Moon className="w-5 h-5 text-primary" />
            Evening reflection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-base">{reflection?.prompt}</p>

          {answered ? (
            <div className="space-y-4">
              {reflection!.chips.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {reflection!.chips.map((chip) => (
                    <span key={chip} className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary">
                      {CHIP_LABELS[chip as ReflectionChip] ?? chip}
                    </span>
                  ))}
                </div>
              )}
              {reflection!.freeText && (
                <p className="text-sm text-muted-foreground italic">"{reflection!.freeText}"</p>
              )}
              {reflection!.ack && (
                <p className="flex items-start gap-2 text-sm text-primary">
                  <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {reflection!.ack}
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelected(new Set(reflection!.chips as ReflectionChip[]));
                  setFreeText(reflection!.freeText ?? "");
                  setEditing(true);
                }}
              >
                Edit tonight's answer
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <ChipGroup title="What helped?" chips={HELPED_CHIPS} selected={selected} onToggle={toggle} />
              <ChipGroup title="What got in the way?" chips={HINDERED_CHIPS} selected={selected} onToggle={toggle} />
              <Textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                maxLength={500}
                placeholder="Anything else? (optional)"
                rows={3}
              />
              <Button
                className="w-full"
                disabled={answer.isPending || (selected.size === 0 && freeText.trim().length === 0)}
                onClick={submit}
              >
                {answer.isPending ? "Saving…" : "Done"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Evening card**

```tsx
// artifacts/focusquest/src/components/evening-reflection-card.tsx
import { Link } from "wouter";
import { useGetTodayReflection } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { eveningCardVisible } from "@/lib/reflection-window";
import { Card, CardContent } from "@/components/ui/card";
import { Moon, ChevronRight } from "lucide-react";

/** Dashboard CTA, 17:00 → midnight local while tonight is unanswered.
 * Deliberately fetches WITHOUT draft — seeing the dashboard never spends an
 * LLM call; only opening /reflection drafts the question. */
export function EveningReflectionCard() {
  const now = new Date();
  const inWindow = now.getHours() >= 17;
  const { data } = useGetTodayReflection(
    { tz: browserTimeZone() },
    { query: { enabled: inWindow } },
  );

  const answered = data?.reflection?.answeredAt != null;
  if (!inWindow || data === undefined || !eveningCardVisible(now, answered)) return null;

  return (
    <Link href="/reflection">
      <Card className="cursor-pointer border-primary/30 hover:border-primary/60 transition-colors">
        <CardContent className="flex items-center gap-3 py-4">
          <Moon className="w-5 h-5 text-primary flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-sm">Evening reflection</p>
            <p className="text-xs text-muted-foreground">1 minute — what worked today?</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 3: Wire route and dashboard**

In `artifacts/focusquest/src/App.tsx`: add `import Reflection from "@/pages/reflection";` beside the other page imports, and inside the `<Switch>` (next to `/focus`) add:

```tsx
        <Route path="/reflection" component={Reflection} />
```

In `artifacts/focusquest/src/pages/dashboard.tsx`: add `import { EveningReflectionCard } from "@/components/evening-reflection-card";` and render `<EveningReflectionCard />` directly after the `<BrainCheckinPrompt />` element in the main dashboard return (search for `<BrainCheckinPrompt` — keep it adjacent so evening surfaces cluster).

- [ ] **Step 4: Typecheck + web suite**

Run: `pnpm typecheck && pnpm --filter @workspace/focusquest test`
Expected: both exit 0. If orval generated the hook's options differently (e.g. no second `options` arg), check the generated signature in `lib/api-client-react/src/generated/api.ts` and adapt the `enabled` usage.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/pages/reflection.tsx artifacts/focusquest/src/components/evening-reflection-card.tsx artifacts/focusquest/src/App.tsx artifacts/focusquest/src/pages/dashboard.tsx
git commit -m "feat(web): reflection page + dashboard evening card"
```

---

### Task 10: "Your rhythms" card on the insights page

**Files:**
- Create: `artifacts/focusquest/src/components/rhythms-card.tsx`
- Modify: `artifacts/focusquest/src/pages/insights.tsx` (mount at top)

**Interfaces:**
- Consumes: `useGetMyPatterns` from `@workspace/api-client-react`; `rhythmsState`, `rhythmsLines` (Task 8); `browserTimeZone`.
- Produces: `<RhythmsCard />` rendered above the existing insights charts.

- [ ] **Step 1: Component**

```tsx
// artifacts/focusquest/src/components/rhythms-card.tsx
import { useGetMyPatterns } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { rhythmsState, rhythmsLines } from "@/lib/rhythms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Waves, Sparkles } from "lucide-react";

/** Confidence-gated strengths card. Positive framings only — blockers feed
 * the reflection LLM, never this surface (anti-shame). */
export function RhythmsCard() {
  const { data, isLoading } = useGetMyPatterns({ tz: browserTimeZone() });
  if (isLoading || !data) return null;

  const state = rhythmsState(data);
  const lines = rhythmsLines(data);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Waves className="w-4 h-4 text-primary" />
          Your rhythms
          {state === "early" && (
            <span className="text-xs font-normal text-muted-foreground">early read</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state === "empty" || lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Still learning your rhythms — a few more days of quests will unlock this.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {(state === "early" ? lines.slice(0, 1) : lines).map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm">
                <Sparkles className="w-3.5 h-3.5 mt-0.5 text-primary flex-shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

(`state === "early"` renders only the power-hours line per spec §7 — `rhythmsLines` puts it first.)

- [ ] **Step 2: Mount it**

In `artifacts/focusquest/src/pages/insights.tsx`: add `import { RhythmsCard } from "@/components/rhythms-card";` and render `<RhythmsCard />` as the first child of the page's top-level container (before the time-range selector / first chart card).

- [ ] **Step 3: Typecheck + web suite**

Run: `pnpm typecheck && pnpm --filter @workspace/focusquest test`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/components/rhythms-card.tsx artifacts/focusquest/src/pages/insights.tsx
git commit -m "feat(web): confidence-gated Your rhythms card on insights"
```

---

### Task 11: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

Run: `pnpm typecheck && pnpm --filter @workspace/api-server test && pnpm --filter @workspace/focusquest test && pnpm --filter @workspace/quick-add test`
Expected: all exit 0.

- [ ] **Step 2: Manual browser pass (dev server)**

Start the dev servers via the browser-preview launch config (or the repo's usual dev scripts) and verify:
1. `/reflection` loads, shows a question (fallback if `GROQ_API_KEY` unset locally), chips toggle, submit shows an ack, XP toast/stats bump once; re-answer via "Edit tonight's answer" gives `xpAwarded: 0` (watch the network response).
2. Dashboard after 17:00 local shows the evening card (temporarily adjust the system clock or spot-check `eveningCardVisible` behavior via the card's absence before 17:00); the card issues `GET /reflections/today` WITHOUT `draft=true` (network tab) and no reflection row is created for a fresh day.
3. `/insights` shows the rhythms card (warm empty state if under 5 completions in 28d).
4. `POST /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` returns `ran` including `"reflection-prompts"`.

- [ ] **Step 3: Push branch and open the PR**

```bash
git push -u origin feat/act5-reflection-patterns
"C:\Program Files\GitHub CLI\gh.exe" pr create --title "feat: Act V spine — end-of-day AI reflection + pattern substrate" --body "$(cat <<'EOF'
Opens Act V (The App That Learns You): anti-shame end-of-day reflection (LLM question grounded in the day's wins, chip + free-text answers, warm ack, fallback-first) + pure 28-day pattern substrate (power hours, durations, mode-by-block, chip aggregates) + confidence-gated "Your rhythms" card + evening cron push with deep link.

Spec: docs/superpowers/specs/2026-07-16-act5-reflection-patterns-design.md
Plan: docs/superpowers/plans/2026-07-16-act5-reflection-patterns.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.
