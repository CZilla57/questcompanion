# Adaptive Difficulty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every quest a reversible easy/medium/hard difficulty ladder — re-scoped by the LLM — with manual controls plus a silent, anti-shame "want a smaller version?" offer that fires when a quest keeps sliding.

**Architecture:** A `difficulty` rung + a lazily-drafted JSON `difficulty_variants` ladder live on `tasksTable`. The LLM (existing Groq seam) drafts only the `easy` and `hard` rungs; `medium` is a snapshot of the user's own quest, so climbing back restores their exact wording. A silent `struggle_score` (persisted, incremented by forward reschedules and rescue events) plus derived ambient signals (days past due, skipped-off-board) feed a pure `evaluateDifficultyOffer`; when it crosses a soft threshold the server sets a `difficultyOfferable` flag on the serialized task. Applying a rung swaps the quest's title/estimate/steps in one transaction and resets the score.

**Tech Stack:** TypeScript, Express (`@workspace/api-server`), Drizzle ORM + Postgres (`@workspace/db`), Groq `llama-3.3-70b-versatile` JSON mode (existing `generateJson` seam), OpenAPI + orval codegen (`@workspace/api-spec` → `@workspace/api-client-react`), React + TanStack Query + Vite (`@workspace/focusquest`), Vitest.

## Global Constraints

- **Anti-shame law:** `struggle_score` never leaves the server and is never rendered as a count anywhere. Offer copy is invitational, never accusatory. Difficulty changes never write `activityTable` / ally feeds. `easy` is a floor — no offer once a quest is at `easy`.
- **Momentum-key invalidation (Act III invariant):** a rung change is a task mutation. Every client mutation success MUST invalidate BOTH `getGetTasksQueryKey()` AND `getGetTasksMomentumQueryKey()` (`refetchOnWindowFocus:false` means staleness never self-heals).
- **LLM seam:** reuse `generateJson` / `isAiConfigured` / `AiClientError` from `artifacts/api-server/src/lib/ai/client.ts`. Route guard order matches breakdown exactly: ownership 404 → `isAiConfigured()` 503 → per-user cooldown 429 → generate → parse-fail 502 → transactional persist.
- **Local-day correctness:** past-due / skipped comparisons use the caller's tz via `localDateKey(now, tz)` (`lib/date-buckets.ts`), never UTC. Anchored quests (`isAnchored`, null `dueDate`) are excluded from the past-due signal.
- **Invariant:** `difficulty_variants IS NULL` ⇒ `difficulty = 'medium'` (a never-laddered quest is its own medium baseline). Preserve this everywhere (generation, ladder invalidation on edit).
- **Free infra:** single Render instance; cooldowns are in-memory best-effort (`createCooldown`). Groq model overridable via `GROQ_MODEL`.
- **Types are owned by `@workspace/db`:** `DifficultyLevel`, `RungContent`, `VariantLadder` are declared in `lib/db/src/schema/tasks.ts` and flow through the package barrel; import them from `@workspace/db`.

**Test commands** (run from repo root):
- api-server: `pnpm --filter @workspace/api-server test <name-filter>` (whole suite: drop the filter)
- api-server typecheck: `pnpm --filter @workspace/api-server typecheck`
- focusquest: `pnpm --filter @workspace/focusquest test <name-filter>`
- codegen: `pnpm --filter @workspace/api-spec codegen`
- schema push: `pnpm --filter @workspace/db push` (⚠ requires `DATABASE_URL` exported into the env first — see `reference-dev-commands` memory; the shared Neon DB already has the Act III schema merged, so there's no unmerged-schema conflict to defer behind)

---

## File Structure

**Create:**
- `artifacts/api-server/src/lib/ai/difficulty-variants.ts` — pure prompt/parse/orchestrate for the LLM easy+hard drafts.
- `artifacts/api-server/src/lib/ai/difficulty-variants.test.ts`
- `artifacts/api-server/src/lib/ai/variants-cooldown.ts` — per-user generation rate guard (mirrors `parse-cooldown.ts`).
- `artifacts/api-server/src/lib/difficulty.ts` — pure ladder assembly + `evaluateDifficultyOffer` + constants/types.
- `artifacts/api-server/src/lib/difficulty.test.ts`
- `artifacts/api-server/src/routes/difficulty.test.ts` — route integration tests for apply/snooze/struggle.
- `artifacts/focusquest/src/hooks/use-difficulty.ts` — client hook wrapping apply/snooze + dual invalidation.
- `artifacts/focusquest/src/components/difficulty-controls.tsx` — easier/harder control + offer chip.
- `artifacts/focusquest/src/components/difficulty-controls.test.tsx`

**Modify:**
- `lib/db/src/schema/tasks.ts` — 4 columns + shared types.
- `artifacts/api-server/src/routes/tasks.ts` — `formatTask` fields; `GET /tasks` offer computation (tz-gated); `PATCH /tasks/:id` struggle increment + ladder invalidation; new `POST /tasks/:id/difficulty` and `POST /tasks/:id/difficulty/snooze`.
- `artifacts/api-server/src/routes/rescue.ts` — struggle increment on `taskId`.
- `artifacts/api-server/src/routes/momentum.ts` — thread `difficultyOfferable` onto suggestions.
- `lib/api-spec/openapi.yaml` — `Task` fields; two new operations; `tz` query on `GET /tasks`.
- `artifacts/focusquest/src/components/task-item.tsx` — mount `<DifficultyControls>`.

---

## Task 1: Schema — difficulty columns + shared types

**Files:**
- Modify: `lib/db/src/schema/tasks.ts`

**Interfaces:**
- Produces (imported from `@workspace/db` by later tasks):
  - `type DifficultyLevel = "easy" | "medium" | "hard"`
  - `interface RungContent { title: string; estimatedMinutes: number | null; steps: string[] }`
  - `interface VariantLadder { easy: RungContent; medium: RungContent; hard: RungContent }`
  - New columns on `tasksTable`: `difficulty` (`DifficultyLevel`, default `"medium"`), `difficultyVariants` (`VariantLadder | null`), `struggleScore` (`number`, default `0`), `difficultyOfferSnoozedAt` (`Date | null`).

- [ ] **Step 1: Add `jsonb` to the pg-core import**

In `lib/db/src/schema/tasks.ts` line 1, add `jsonb` to the import list:

```ts
import { pgTable, serial, text, integer, boolean, timestamp, date, unique, jsonb } from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Declare the shared types above `tasksTable`**

Insert after the imports (before `export const tasksTable`):

```ts
export type DifficultyLevel = "easy" | "medium" | "hard";

/** One rung of the difficulty ladder. `estimatedMinutes` may be null when the
 * medium snapshot came from a quest with no estimate. */
export interface RungContent {
  title: string;
  estimatedMinutes: number | null;
  steps: string[];
}

/** The lazily-drafted ladder. `medium` is a snapshot of the user's own quest;
 * `easy`/`hard` are LLM re-scopes. Null until first generated. */
export interface VariantLadder {
  easy: RungContent;
  medium: RungContent;
  hard: RungContent;
}
```

- [ ] **Step 3: Add the four columns**

In the `tasksTable` definition, after the `category` column (line 41) and before `createdAt`:

```ts
  // Adaptive difficulty. INVARIANT: difficultyVariants IS NULL ⇒ difficulty = 'medium'.
  difficulty: text("difficulty").notNull().default("medium").$type<DifficultyLevel>(),
  difficultyVariants: jsonb("difficulty_variants").$type<VariantLadder>(),
  // Silent struggle accumulator (never shown to the user). Reset to 0 on any rung change.
  struggleScore: integer("struggle_score").notNull().default(0),
  difficultyOfferSnoozedAt: timestamp("difficulty_offer_snoozed_at"),
```

- [ ] **Step 4: Typecheck the db package's consumers**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: PASS (no references yet; confirms the schema still compiles and `$type` usage is valid).

- [ ] **Step 5: Push the schema to the shared Neon DB**

Ensure `DATABASE_URL` is exported (see `reference-dev-commands` memory), then run: `pnpm --filter @workspace/db push`
Expected: drizzle-kit reports 4 added columns on `tasks` and applies them with no data loss.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/tasks.ts
git commit -m "feat(db): adaptive-difficulty columns + ladder types on tasks"
```

---

## Task 2: Pure — LLM easy/hard variant drafting

**Files:**
- Create: `artifacts/api-server/src/lib/ai/difficulty-variants.ts`
- Test: `artifacts/api-server/src/lib/ai/difficulty-variants.test.ts`

**Interfaces:**
- Consumes: `RungContent` from `@workspace/db` (for shape reference only); `GenerateJson` type shape `(prompt: string) => Promise<unknown>` (re-declared locally like `task-breakdown.ts` does).
- Produces:
  - `class VariantsParseError extends Error`
  - `interface VariantInput { title: string; description?: string | null; category?: string | null; estimatedMinutes?: number | null; steps?: string[] }`
  - `interface VariantDraft { title: string; estimatedMinutes: number; steps: string[] }`
  - `interface VariantsResult { easy: VariantDraft; hard: VariantDraft }`
  - `const MAX_VARIANT_STEPS = 6`, `const MAX_VARIANT_STEP_LENGTH = 120`
  - `buildVariantsPrompt(input: VariantInput): string`
  - `parseVariants(raw: unknown): VariantsResult`
  - `generateVariants(input: VariantInput, generate: GenerateJson): Promise<VariantsResult>`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/ai/difficulty-variants.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  buildVariantsPrompt,
  parseVariants,
  generateVariants,
  VariantsParseError,
  MAX_VARIANT_STEPS,
  MAX_VARIANT_STEP_LENGTH,
} from "./difficulty-variants";

const ok = {
  easy: { title: "Clear the counters", estimatedMinutes: 5, steps: ["Clear items", "Wipe down"] },
  hard: { title: "Deep-clean the kitchen", estimatedMinutes: 40, steps: ["Counters", "Dishes", "Floor", "Fridge"] },
};

describe("buildVariantsPrompt", () => {
  it("includes the quest and asks for smaller easy + bigger hard as JSON", () => {
    const p = buildVariantsPrompt({ title: "Clean the kitchen", estimatedMinutes: 15 });
    expect(p).toContain("Clean the kitchen");
    expect(p.toLowerCase()).toContain("smaller");
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain('"easy"');
    expect(p).toContain('"hard"');
  });

  it("includes description, category, estimate, and existing steps when present", () => {
    const p = buildVariantsPrompt({
      title: "X", description: "the big one", category: "household",
      estimatedMinutes: 90, steps: ["a", "b"],
    });
    expect(p).toContain("the big one");
    expect(p).toContain("household");
    expect(p).toContain("90");
  });
});

describe("parseVariants", () => {
  it("returns trimmed, validated easy + hard drafts", () => {
    expect(parseVariants(ok)).toEqual(ok);
  });

  it("rounds estimates and drops empty steps", () => {
    const r = parseVariants({
      easy: { title: " a ", estimatedMinutes: 4.6, steps: ["s1", "  ", ""] },
      hard: { title: "b", estimatedMinutes: 30, steps: ["x"] },
    });
    expect(r.easy.title).toBe("a");
    expect(r.easy.estimatedMinutes).toBe(5);
    expect(r.easy.steps).toEqual(["s1"]);
  });

  it("clamps steps to MAX_VARIANT_STEPS and truncates long steps", () => {
    const many = Array.from({ length: MAX_VARIANT_STEPS + 3 }, (_, i) => `step ${i}`);
    const longStep = "y".repeat(MAX_VARIANT_STEP_LENGTH + 20);
    const r = parseVariants({
      easy: { title: "a", estimatedMinutes: 5, steps: [longStep] },
      hard: { title: "b", estimatedMinutes: 30, steps: many },
    });
    expect(r.hard.steps).toHaveLength(MAX_VARIANT_STEPS);
    expect(r.easy.steps[0]!.length).toBe(MAX_VARIANT_STEP_LENGTH);
  });

  it("throws when easy is not strictly smaller than hard", () => {
    expect(() => parseVariants({
      easy: { title: "a", estimatedMinutes: 30, steps: [] },
      hard: { title: "b", estimatedMinutes: 20, steps: [] },
    })).toThrow(VariantsParseError);
  });

  it("throws on missing rungs, empty titles, or non-positive estimates", () => {
    expect(() => parseVariants({ easy: ok.easy })).toThrow(VariantsParseError);
    expect(() => parseVariants({ easy: { title: "", estimatedMinutes: 5, steps: [] }, hard: ok.hard })).toThrow(VariantsParseError);
    expect(() => parseVariants({ easy: { title: "a", estimatedMinutes: 0, steps: [] }, hard: ok.hard })).toThrow(VariantsParseError);
    expect(() => parseVariants(null)).toThrow(VariantsParseError);
  });
});

describe("generateVariants", () => {
  it("passes the built prompt to generate and returns parsed drafts", async () => {
    const generate = vi.fn(async () => ok);
    const result = await generateVariants({ title: "Clean the kitchen" }, generate);
    expect(result).toEqual(ok);
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("Clean the kitchen"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/api-server test difficulty-variants`
Expected: FAIL — `Cannot find module './difficulty-variants'`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/ai/difficulty-variants.ts`:

```ts
export const MAX_VARIANT_STEPS = 6;
export const MAX_VARIANT_STEP_LENGTH = 120;

export class VariantsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariantsParseError";
  }
}

export interface VariantInput {
  title: string;
  description?: string | null;
  category?: string | null;
  estimatedMinutes?: number | null;
  steps?: string[];
}

export interface VariantDraft {
  title: string;
  estimatedMinutes: number;
  steps: string[];
}

export interface VariantsResult {
  easy: VariantDraft;
  hard: VariantDraft;
}

// Same provider-agnostic seam as task-breakdown: the prompt states the JSON shape.
export type GenerateJson = (prompt: string) => Promise<unknown>;

export function buildVariantsPrompt(input: VariantInput): string {
  const context: string[] = [`Quest: ${input.title}`];
  if (input.description) context.push(`Details: ${input.description}`);
  if (input.category && input.category !== "default") context.push(`Category: ${input.category}`);
  if (input.estimatedMinutes) context.push(`Current estimate: ${input.estimatedMinutes} minutes`);
  if (input.steps && input.steps.length) context.push(`Current steps: ${input.steps.join("; ")}`);

  return `You help people with ADHD by re-scoping a quest into a genuinely SMALLER version and a fuller BIGGER version, so they can pick the size that fits their energy right now.

Rules:
- "easy" is a legitimately SMALLER slice of the SAME quest that still counts as real progress — lower activation cost, roughly a third of the time, fewer steps. It is NOT "do it worse", NOT a warm-up, and NOT the same quest with more sub-steps. Example: "Clean the kitchen" -> "Clear and wipe the counters".
- "hard" is the fuller, more thorough version of the same intent.
- Keep every title a short present-tense imperative in the user's own voice.
- easy.estimatedMinutes MUST be a positive integer strictly LESS than hard.estimatedMinutes.
- Each rung may include 0 to ${MAX_VARIANT_STEPS} concrete steps (short phrases), or an empty list.
- Encouraging tone, never patronizing. Never imply the user failed.

${context.join("\n")}

Respond with JSON only, in this exact shape: {"easy":{"title":"...","estimatedMinutes":5,"steps":["..."]},"hard":{"title":"...","estimatedMinutes":40,"steps":["..."]}}`;
}

function parseDraft(raw: unknown, rung: string): VariantDraft {
  if (!raw || typeof raw !== "object") {
    throw new VariantsParseError(`Missing "${rung}" rung`);
  }
  const r = raw as { title?: unknown; estimatedMinutes?: unknown; steps?: unknown };

  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) throw new VariantsParseError(`"${rung}" has an empty title`);

  const est = typeof r.estimatedMinutes === "number" ? Math.round(r.estimatedMinutes) : NaN;
  if (!Number.isFinite(est) || est <= 0) {
    throw new VariantsParseError(`"${rung}" needs a positive estimatedMinutes`);
  }

  const steps = Array.isArray(r.steps)
    ? r.steps
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => (s.length > MAX_VARIANT_STEP_LENGTH ? s.slice(0, MAX_VARIANT_STEP_LENGTH) : s))
        .slice(0, MAX_VARIANT_STEPS)
    : [];

  return { title, estimatedMinutes: est, steps };
}

export function parseVariants(raw: unknown): VariantsResult {
  if (!raw || typeof raw !== "object") {
    throw new VariantsParseError("Model output was not an object");
  }
  const obj = raw as { easy?: unknown; hard?: unknown };
  const easy = parseDraft(obj.easy, "easy");
  const hard = parseDraft(obj.hard, "hard");
  if (!(easy.estimatedMinutes < hard.estimatedMinutes)) {
    throw new VariantsParseError("easy estimate must be strictly smaller than hard");
  }
  return { easy, hard };
}

export async function generateVariants(
  input: VariantInput,
  generate: GenerateJson,
): Promise<VariantsResult> {
  const prompt = buildVariantsPrompt(input);
  const raw = await generate(prompt);
  return parseVariants(raw);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/api-server test difficulty-variants`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/ai/difficulty-variants.ts artifacts/api-server/src/lib/ai/difficulty-variants.test.ts
git commit -m "feat(ai): pure LLM difficulty-variant drafting (easy/hard re-scope)"
```

---

## Task 3: Pure — ladder assembly + offer evaluator

**Files:**
- Create: `artifacts/api-server/src/lib/difficulty.ts`
- Test: `artifacts/api-server/src/lib/difficulty.test.ts`

**Interfaces:**
- Consumes: `RungContent`, `VariantLadder` from `@workspace/db`; `VariantsResult` from `./ai/difficulty-variants`; `BrainMode` from `./brain-mode`.
- Produces:
  - `const OFFER_THRESHOLD = 3`, `FROZEN_OFFER_THRESHOLD = 2`, `PAST_DUE_CAP = 3`, `SNOOZE_WINDOW_MS = 3 * 86_400_000`
  - `assembleLadder(medium: RungContent, drafts: VariantsResult): VariantLadder`
  - `snapshotMedium(task: { title: string; estimatedMinutes: number | null }, stepTexts: string[]): RungContent`
  - `interface OfferInput { completed: boolean; difficulty: string; struggleScore: number; dueDate: string | null; isAnchored: boolean; isDailyFocus: boolean; focusDate: string | null; difficultyOfferSnoozedAt: Date | null }`
  - `interface OfferContext { now: Date; todayStr: string; mode: BrainMode }`
  - `evaluateDifficultyOffer(input: OfferInput, ctx: OfferContext): boolean`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/difficulty.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  assembleLadder,
  snapshotMedium,
  evaluateDifficultyOffer,
  OFFER_THRESHOLD,
  type OfferInput,
  type OfferContext,
} from "./difficulty";

const NOW = new Date("2026-07-14T19:00:00Z");
const TODAY = "2026-07-14";

function offer(overrides: Partial<OfferInput> = {}): OfferInput {
  return {
    completed: false,
    difficulty: "medium",
    struggleScore: 0,
    dueDate: null,
    isAnchored: false,
    isDailyFocus: false,
    focusDate: null,
    difficultyOfferSnoozedAt: null,
    ...overrides,
  };
}
function ctx(overrides: Partial<OfferContext> = {}): OfferContext {
  return { now: NOW, todayStr: TODAY, mode: "neutral", ...overrides };
}

describe("assembleLadder", () => {
  it("keeps medium as the snapshot and slots in the drafts", () => {
    const medium = { title: "Clean the kitchen", estimatedMinutes: 15, steps: ["a"] };
    const drafts = {
      easy: { title: "Wipe counters", estimatedMinutes: 5, steps: [] },
      hard: { title: "Deep clean", estimatedMinutes: 40, steps: ["x", "y"] },
    };
    expect(assembleLadder(medium, drafts)).toEqual({ easy: drafts.easy, medium, hard: drafts.hard });
  });
});

describe("snapshotMedium", () => {
  it("captures the quest's current title/estimate and step texts", () => {
    expect(snapshotMedium({ title: "T", estimatedMinutes: null }, ["s1", "s2"]))
      .toEqual({ title: "T", estimatedMinutes: null, steps: ["s1", "s2"] });
  });
});

describe("evaluateDifficultyOffer", () => {
  it("fires when persisted struggle reaches the threshold", () => {
    expect(evaluateDifficultyOffer(offer({ struggleScore: OFFER_THRESHOLD }), ctx())).toBe(true);
    expect(evaluateDifficultyOffer(offer({ struggleScore: OFFER_THRESHOLD - 1 }), ctx())).toBe(false);
  });

  it("adds capped days-past-due, excluding anchored quests", () => {
    // 5 days past due -> capped at +3, meets threshold on its own
    expect(evaluateDifficultyOffer(offer({ dueDate: "2026-07-09" }), ctx())).toBe(true);
    // anchored quest ignores the date entirely
    expect(evaluateDifficultyOffer(offer({ dueDate: "2026-07-09", isAnchored: true }), ctx())).toBe(false);
  });

  it("adds a point for a quest skipped off a past daily board", () => {
    expect(evaluateDifficultyOffer(
      offer({ struggleScore: 2, isDailyFocus: true, focusDate: "2026-07-13" }), ctx(),
    )).toBe(true);
  });

  it("never offers at the easy floor or for completed quests", () => {
    expect(evaluateDifficultyOffer(offer({ struggleScore: 9, difficulty: "easy" }), ctx())).toBe(false);
    expect(evaluateDifficultyOffer(offer({ struggleScore: 9, completed: true }), ctx())).toBe(false);
  });

  it("respects a recent snooze but not an expired one", () => {
    const recent = new Date(NOW.getTime() - 86_400_000); // 1 day ago
    const old = new Date(NOW.getTime() - 5 * 86_400_000); // 5 days ago
    expect(evaluateDifficultyOffer(offer({ struggleScore: 9, difficultyOfferSnoozedAt: recent }), ctx())).toBe(false);
    expect(evaluateDifficultyOffer(offer({ struggleScore: 9, difficultyOfferSnoozedAt: old }), ctx())).toBe(true);
  });

  it("lowers the threshold in frozen mode", () => {
    expect(evaluateDifficultyOffer(offer({ struggleScore: 2 }), ctx())).toBe(false);
    expect(evaluateDifficultyOffer(offer({ struggleScore: 2 }), ctx({ mode: "frozen" }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/api-server test difficulty.test`
Expected: FAIL — `Cannot find module './difficulty'`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/difficulty.ts`:

```ts
import type { RungContent, VariantLadder } from "@workspace/db";
import type { VariantsResult } from "./ai/difficulty-variants";
import type { BrainMode } from "./brain-mode";

export const OFFER_THRESHOLD = 3;
export const FROZEN_OFFER_THRESHOLD = 2;
export const PAST_DUE_CAP = 3;
export const SNOOZE_WINDOW_MS = 3 * 86_400_000;

/** Merge the user's medium snapshot with the LLM easy/hard drafts. */
export function assembleLadder(medium: RungContent, drafts: VariantsResult): VariantLadder {
  return { easy: drafts.easy, medium, hard: drafts.hard };
}

/** Capture the quest as-is as the medium rung (its own baseline). */
export function snapshotMedium(
  task: { title: string; estimatedMinutes: number | null },
  stepTexts: string[],
): RungContent {
  return { title: task.title, estimatedMinutes: task.estimatedMinutes, steps: stepTexts };
}

export interface OfferInput {
  completed: boolean;
  difficulty: string;
  struggleScore: number;
  dueDate: string | null;
  isAnchored: boolean;
  isDailyFocus: boolean;
  focusDate: string | null;
  difficultyOfferSnoozedAt: Date | null;
}

export interface OfferContext {
  now: Date;
  todayStr: string;
  mode: BrainMode;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.floor((Date.parse(toYmd) - Date.parse(fromYmd)) / 86_400_000);
}

/**
 * Should the app gently offer a smaller version of this quest? Pure and silent:
 * combines the persisted struggle score with derived ambient signals. Never a
 * shame signal — easy is a floor, completed quests never qualify, and a recent
 * snooze suppresses it.
 */
export function evaluateDifficultyOffer(input: OfferInput, ctx: OfferContext): boolean {
  if (input.completed) return false;
  if (input.difficulty === "easy") return false;
  if (
    input.difficultyOfferSnoozedAt &&
    ctx.now.getTime() - input.difficultyOfferSnoozedAt.getTime() < SNOOZE_WINDOW_MS
  ) {
    return false;
  }

  let ambient = 0;
  if (input.dueDate && !input.isAnchored && input.dueDate < ctx.todayStr) {
    ambient += Math.min(daysBetween(input.dueDate, ctx.todayStr), PAST_DUE_CAP);
  }
  if (input.isDailyFocus && input.focusDate && input.focusDate < ctx.todayStr) {
    ambient += 1;
  }

  const threshold = ctx.mode === "frozen" ? FROZEN_OFFER_THRESHOLD : OFFER_THRESHOLD;
  return input.struggleScore + ambient >= threshold;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/api-server test difficulty.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/difficulty.ts artifacts/api-server/src/lib/difficulty.test.ts
git commit -m "feat(api): pure ladder assembly + anti-shame difficulty-offer evaluator"
```

---

## Task 4: Apply/snooze routes (generate-on-first-use + swap)

**Files:**
- Create: `artifacts/api-server/src/lib/ai/variants-cooldown.ts`
- Modify: `artifacts/api-server/src/routes/tasks.ts` (imports; add two routes after the `/tasks/:id/breakdown` route, ~line 1026)
- Test: `artifacts/api-server/src/routes/difficulty.test.ts`

**Interfaces:**
- Consumes: `generateVariants`, `VariantsParseError` (`./ai/difficulty-variants`); `assembleLadder`, `snapshotMedium` (`../lib/difficulty`); `generateJson`, `isAiConfigured`, `AiClientError` (`../lib/ai/client`); `variantsCooldown` (`../lib/ai/variants-cooldown`); `db`, `tasksTable`, `taskStepsTable`, `VariantLadder`, `DifficultyLevel` (`@workspace/db`); existing `formatTask`.
- Produces:
  - `POST /tasks/:id/difficulty` body `{ level: DifficultyLevel }` → 200 `Task`; errors 400/404/409/429/502/503.
  - `POST /tasks/:id/difficulty/snooze` → 200 `{ ok: true }`; 404.

- [ ] **Step 1: Create the generation cooldown**

Create `artifacts/api-server/src/lib/ai/variants-cooldown.ts` (mirrors `parse-cooldown.ts`):

```ts
import { createCooldown } from "./breakdown-cooldown";

export const VARIANTS_COOLDOWN_MS = 3000;
export const variantsCooldown = createCooldown(VARIANTS_COOLDOWN_MS);
```

- [ ] **Step 2: Write the failing route tests**

Create `artifacts/api-server/src/routes/difficulty.test.ts`. Follow the existing route-test harness in this folder (import the same test app/agent helper the other `routes/*.test.ts` files use — check `routes/tasks.test.ts` for the exact `makeAgent`/`seedUser` utilities and mirror them). The behaviors to pin:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
// import the shared route-test harness the same way routes/tasks.test.ts does:
import { agentFor, seedTask, resetDb } from "./__test__/harness"; // <- match the real path used by sibling tests
import * as aiClient from "../lib/ai/client";

beforeEach(async () => { await resetDb(); });

describe("POST /tasks/:id/difficulty", () => {
  it("400s on an invalid level", async () => {
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, { title: "Clean the kitchen", estimatedMinutes: 15 });
    const res = await agent.post(`/tasks/${task.id}/difficulty`).send({ level: "medium-ish" });
    expect(res.status).toBe(400);
  });

  it("503s when AI is not configured and the ladder must be generated", async () => {
    vi.spyOn(aiClient, "isAiConfigured").mockReturnValue(false);
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, { title: "Clean the kitchen", estimatedMinutes: 15 });
    const res = await agent.post(`/tasks/${task.id}/difficulty`).send({ level: "easy" });
    expect(res.status).toBe(503);
  });

  it("generates the ladder on first use, swaps to easy, resets struggle, snoozes", async () => {
    vi.spyOn(aiClient, "isAiConfigured").mockReturnValue(true);
    vi.spyOn(aiClient, "generateJson").mockResolvedValue({
      easy: { title: "Wipe the counters", estimatedMinutes: 5, steps: ["Clear items", "Wipe"] },
      hard: { title: "Deep-clean the kitchen", estimatedMinutes: 40, steps: ["Counters", "Fridge"] },
    });
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, { title: "Clean the kitchen", estimatedMinutes: 15, struggleScore: 4 });

    const res = await agent.post(`/tasks/${task.id}/difficulty`).send({ level: "easy" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Wipe the counters");
    expect(res.body.estimatedMinutes).toBe(5);
    expect(res.body.difficulty).toBe("easy");
    expect(res.body.steps.map((s: { text: string }) => s.text)).toEqual(["Clear items", "Wipe"]);
    expect(res.body.difficultyOfferable).toBe(false); // easy floor
  });

  it("climbs back to medium from the stored snapshot without a new AI call", async () => {
    const generate = vi.spyOn(aiClient, "generateJson").mockResolvedValue({
      easy: { title: "Wipe the counters", estimatedMinutes: 5, steps: [] },
      hard: { title: "Deep-clean", estimatedMinutes: 40, steps: [] },
    });
    vi.spyOn(aiClient, "isAiConfigured").mockReturnValue(true);
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, { title: "Clean the kitchen", estimatedMinutes: 15 });

    await agent.post(`/tasks/${task.id}/difficulty`).send({ level: "easy" });   // generates
    generate.mockClear();
    const back = await agent.post(`/tasks/${task.id}/difficulty`).send({ level: "medium" }); // no AI
    expect(back.body.title).toBe("Clean the kitchen");
    expect(back.body.estimatedMinutes).toBe(15);
    expect(generate).not.toHaveBeenCalled();
  });

  it("502s when the model output can't be parsed", async () => {
    vi.spyOn(aiClient, "isAiConfigured").mockReturnValue(true);
    vi.spyOn(aiClient, "generateJson").mockResolvedValue({ nonsense: true });
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, { title: "Clean the kitchen" });
    const res = await agent.post(`/tasks/${task.id}/difficulty`).send({ level: "easy" });
    expect(res.status).toBe(502);
  });

  it("404s for a quest the user doesn't own", async () => {
    const { agent } = await agentFor();
    const res = await agent.post(`/tasks/999999/difficulty`).send({ level: "easy" });
    expect(res.status).toBe(404);
  });
});

describe("POST /tasks/:id/difficulty/snooze", () => {
  it("records a snooze and 200s", async () => {
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, { title: "Clean the kitchen" });
    const res = await agent.post(`/tasks/${task.id}/difficulty/snooze`).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

> Note for the implementer: if `seedTask` doesn't yet accept `struggleScore`, extend the shared harness's insert helper to pass it through — it maps directly to the `struggle_score` column.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test routes/difficulty`
Expected: FAIL — routes return 404 (not yet mounted) / module import errors.

- [ ] **Step 4: Add imports to `routes/tasks.ts`**

Near the existing AI imports at the top of `artifacts/api-server/src/routes/tasks.ts` (beside the `breakdownCooldown` / `generateJson` imports), add:

```ts
import { generateVariants, VariantsParseError } from "../lib/ai/difficulty-variants";
import { variantsCooldown } from "../lib/ai/variants-cooldown";
import { assembleLadder, snapshotMedium } from "../lib/difficulty";
import type { DifficultyLevel, VariantLadder } from "@workspace/db";
```

(Confirm `taskStepsTable`, `isAiConfigured`, `generateJson`, `AiClientError` are already imported — they are used by the breakdown route in this file. Add any that are missing.)

- [ ] **Step 5: Implement the two routes**

Immediately after the `/tasks/:id/breakdown` route (ends ~line 1026), add:

```ts
const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = ["easy", "medium", "hard"] as const;

router.post("/tasks/:id/difficulty", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const level = (req.body as { level?: unknown }).level;
  if (typeof level !== "string" || !DIFFICULTY_LEVELS.includes(level as DifficultyLevel)) {
    res.status(400).json({ error: "level must be easy, medium, or hard" });
    return;
  }
  const target = level as DifficultyLevel;

  const [task] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (task.completed) { res.status(409).json({ error: "Can't change difficulty of a completed quest" }); return; }

  // A never-laddered quest already IS its medium baseline — moving to medium is a no-op.
  if (!task.difficultyVariants && target === "medium") {
    const steps = await db.select().from(taskStepsTable)
      .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
    res.json(formatTask(task, steps));
    return;
  }

  // Generate the ladder on first use (guards mirror /breakdown exactly).
  let ladder: VariantLadder;
  if (task.difficultyVariants) {
    ladder = task.difficultyVariants;
  } else {
    if (!isAiConfigured()) { res.status(503).json({ error: "AI difficulty is not configured" }); return; }
    if (!variantsCooldown.tryAcquire(userId)) {
      res.status(429).json({ error: "Slow down a moment before resizing another quest." });
      return;
    }
    const currentSteps = await db.select().from(taskStepsTable)
      .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
    const stepTexts = currentSteps.slice().sort((a, b) => a.position - b.position).map((s) => s.text);
    try {
      const drafts = await generateVariants(
        { title: task.title, description: task.description, category: task.category, estimatedMinutes: task.estimatedMinutes, steps: stepTexts },
        generateJson,
      );
      ladder = assembleLadder(snapshotMedium(task, stepTexts), drafts);
    } catch (err) {
      if (err instanceof AiClientError || err instanceof VariantsParseError) {
        logger.warn({ err, taskId: id }, "difficulty variant generation failed");
        res.status(502).json({ error: "Couldn't resize that quest, try again." });
        return;
      }
      throw err;
    }
  }

  const rung = ladder[target];

  // Swap title/estimate/steps + persist the ladder, reset struggle, snooze — atomically.
  const { updated, steps } = await db.transaction(async (tx) => {
    const [row] = await tx.update(tasksTable)
      .set({
        title: rung.title,
        estimatedMinutes: rung.estimatedMinutes,
        difficulty: target,
        difficultyVariants: ladder,
        struggleScore: 0,
        difficultyOfferSnoozedAt: new Date(),
      })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .returning();
    await tx.delete(taskStepsTable)
      .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
    const inserted = rung.steps.length
      ? await tx.insert(taskStepsTable)
          .values(rung.steps.map((text, i) => ({ taskId: id, userId, text, position: i })))
          .returning()
      : [];
    return { updated: row!, steps: inserted };
  });

  res.json(formatTask(updated, steps));
});

router.post("/tasks/:id/difficulty/snooze", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [updated] = await db.update(tasksTable)
    .set({ difficultyOfferSnoozedAt: new Date() })
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
    .returning({ id: tasksTable.id });
  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

  res.json({ ok: true });
});
```

> `formatTask` gains its `difficulty` / `difficultyOfferable` fields in Task 6; until then the route tests asserting those fields will fail on the missing keys. That's expected — Task 6 completes the serializer. If you're running strictly task-by-task, the two field assertions (`res.body.difficulty` / `res.body.difficultyOfferable`) can be marked `.skip` here and un-skipped after Task 6. All other assertions pass now.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test routes/difficulty`
Expected: PASS (aside from the two serializer-field assertions noted above, which pass after Task 6).

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/ai/variants-cooldown.ts artifacts/api-server/src/routes/tasks.ts artifacts/api-server/src/routes/difficulty.test.ts
git commit -m "feat(api): apply/snooze difficulty routes with generate-on-first-use swap"
```

---

## Task 5: Struggle increments in PATCH + rescue

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` (`PATCH /tasks/:id`, ~lines 373–409)
- Modify: `artifacts/api-server/src/routes/rescue.ts`
- Test: append to `artifacts/api-server/src/routes/difficulty.test.ts`

**Interfaces:**
- Consumes: existing `existing` task row in PATCH; `parsed.value` (`taskId`, `blocker`) in rescue.
- Produces: side-effect increments to `tasks.struggle_score`; ladder/difficulty reset on title/description edit.

- [ ] **Step 1: Write the failing tests (append)**

Append to `artifacts/api-server/src/routes/difficulty.test.ts`:

```ts
import { db, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function struggleOf(id: number): Promise<number> {
  const [row] = await db.select({ s: tasksTable.struggleScore }).from(tasksTable).where(eq(tasksTable.id, id));
  return row!.s;
}

describe("struggle accrual", () => {
  it("increments on a forward reschedule of an incomplete quest", async () => {
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, { title: "T", dueDate: "2026-07-14" });
    await agent.patch(`/tasks/${task.id}`).send({ dueDate: "2026-07-20" });
    expect(await struggleOf(task.id)).toBe(1);
  });

  it("does not increment when moving the date earlier", async () => {
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, { title: "T", dueDate: "2026-07-14" });
    await agent.patch(`/tasks/${task.id}`).send({ dueDate: "2026-07-10" });
    expect(await struggleOf(task.id)).toBe(0);
  });

  it("clears the ladder and resets difficulty to medium on a title edit", async () => {
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, {
      title: "T", difficulty: "easy",
      difficultyVariants: { easy: { title: "T", estimatedMinutes: 5, steps: [] }, medium: { title: "T", estimatedMinutes: 15, steps: [] }, hard: { title: "T", estimatedMinutes: 40, steps: [] } },
    });
    await agent.patch(`/tasks/${task.id}`).send({ title: "T renamed" });
    const [row] = await db.select().from(tasksTable).where(eq(tasksTable.id, task.id));
    expect(row!.difficultyVariants).toBeNull();
    expect(row!.difficulty).toBe("medium");
  });

  it("increments on a rescue event for this quest, +2 when too_big", async () => {
    const { agent, userId } = await agentFor();
    const task = await seedTask(userId, { title: "T" });
    await agent.post(`/rescue/events`).send({ taskId: task.id, blocker: "too_big", intervention: "breakdown" });
    expect(await struggleOf(task.id)).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workspace/api-server test routes/difficulty`
Expected: FAIL — struggle stays 0; ladder not cleared.

- [ ] **Step 3: Add struggle logic to PATCH `/tasks/:id`**

In `artifacts/api-server/src/routes/tasks.ts`, inside the incomplete-task edit block (after line 375 where `description` is handled, before the `dueDate` block), add ladder invalidation; and within the `dueDate` block add the forward-reschedule increment. Concretely:

Replace the title/description lines (374–375):

```ts
  if (title != null) updates.title = title;
  if (description != null) updates.description = description;
```

with:

```ts
  if (title != null) updates.title = title;
  if (description != null) updates.description = description;
  // A re-worded quest is a new baseline: drop the stale ladder and return to medium.
  if (title != null || description != null) {
    updates.difficultyVariants = null;
    updates.difficulty = "medium";
  }
```

Then replace the `dueDate` block (376–381):

```ts
  if (dueDate != null) {
    updates.dueDate = dueDate;
    if (isAnchored !== true) updates.isAnchored = false;
  }
```

with:

```ts
  if (dueDate != null) {
    updates.dueDate = dueDate;
    if (isAnchored !== true) updates.isAnchored = false;
    // Pushing an incomplete quest to a later day is a silent "I keep avoiding this".
    if (existing.dueDate && dueDate > existing.dueDate) {
      updates.struggleScore = existing.struggleScore + 1;
    }
  }
```

- [ ] **Step 4: Add struggle logic to `POST /rescue/events`**

In `artifacts/api-server/src/routes/rescue.ts`, after the ownership check (inside the `if (taskId !== null)` block, after confirming the task exists), increment the owning quest's struggle score. Replace lines 19–23:

```ts
  if (taskId !== null) {
    const [task] = await db.select({ id: tasksTable.id }).from(tasksTable)
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  }
```

with:

```ts
  if (taskId !== null) {
    const [task] = await db.select({ id: tasksTable.id, struggleScore: tasksTable.struggleScore })
      .from(tasksTable)
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    // "Too big" is direct evidence the quest needs resizing; weight it heavier.
    const delta = blocker === "too_big" ? 2 : 1;
    await db.update(tasksTable)
      .set({ struggleScore: task.struggleScore + delta })
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @workspace/api-server test routes/difficulty`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts artifacts/api-server/src/routes/rescue.ts artifacts/api-server/src/routes/difficulty.test.ts
git commit -m "feat(api): accrue silent struggle score on reschedule + rescue; invalidate ladder on edit"
```

---

## Task 6: Serializer + offer surfacing (GET /tasks, momentum)

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` (`formatTask` ~43–72; `GET /tasks` ~101+)
- Modify: `artifacts/api-server/src/routes/momentum.ts`
- Test: append to `artifacts/api-server/src/routes/difficulty.test.ts`

**Interfaces:**
- Consumes: `evaluateDifficultyOffer`, `OfferContext` (`../lib/difficulty`); `deriveBrainState` (`../lib/brain-mode`); `resolveTimeZone`, `localDateKey`, `localHour` (`../lib/date-buckets`); `brainCheckinsTable`, `isAiConfigured`.
- Produces: `formatTask(task, steps, opts?)` now emits `difficulty` and `difficultyOfferable`. `GET /tasks?tz=` computes offers; momentum suggestions carry `difficultyOfferable` on their `task`.

- [ ] **Step 1: Write the failing test (append)**

Append to `artifacts/api-server/src/routes/difficulty.test.ts`:

```ts
describe("difficultyOfferable on GET /tasks", () => {
  it("is true for a struggling non-easy quest when tz is provided and AI is configured", async () => {
    vi.spyOn(aiClient, "isAiConfigured").mockReturnValue(true);
    const { agent, userId } = await agentFor();
    await seedTask(userId, { title: "Big one", struggleScore: 4 });
    const res = await agent.get(`/tasks?tz=America/Chicago`);
    expect(res.status).toBe(200);
    const t = res.body.find((x: { title: string }) => x.title === "Big one");
    expect(t.difficulty).toBe("medium");
    expect(t.difficultyOfferable).toBe(true);
  });

  it("defaults difficultyOfferable to false when tz is absent", async () => {
    const { agent, userId } = await agentFor();
    await seedTask(userId, { title: "Big one", struggleScore: 9 });
    const res = await agent.get(`/tasks`);
    const t = res.body.find((x: { title: string }) => x.title === "Big one");
    expect(t.difficultyOfferable).toBe(false);
    expect(t.difficulty).toBe("medium");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workspace/api-server test routes/difficulty`
Expected: FAIL — `difficultyOfferable` / `difficulty` undefined on the serialized task.

- [ ] **Step 3: Extend `formatTask`**

In `artifacts/api-server/src/routes/tasks.ts`, change the signature and add two fields. Replace the function header (43–46):

```ts
export function formatTask(
  task: typeof tasksTable.$inferSelect,
  steps: (typeof taskStepsTable.$inferSelect)[] = [],
) {
  return {
```

with:

```ts
export function formatTask(
  task: typeof tasksTable.$inferSelect,
  steps: (typeof taskStepsTable.$inferSelect)[] = [],
  opts: { difficultyOfferable?: boolean } = {},
) {
  return {
```

and add these two properties inside the returned object (e.g. right after the `questlineId` line, 66):

```ts
    difficulty: task.difficulty,
    difficultyOfferable: opts.difficultyOfferable ?? false,
```

- [ ] **Step 4: Compute offers in `GET /tasks`**

Add the imports at the top of `routes/tasks.ts` if not present:

```ts
import { desc } from "drizzle-orm";
import { brainCheckinsTable } from "@workspace/db";
import { deriveBrainState } from "../lib/brain-mode";
import { resolveTimeZone, localDateKey } from "../lib/date-buckets";
import { evaluateDifficultyOffer } from "../lib/difficulty";
```

In the `GET /tasks` handler, after the task rows are fetched and before they're serialized, build an offer map when `tz` is supplied. Locate where the handler maps rows to `formatTask(...)` and wrap it:

```ts
  // Adaptive-difficulty offers are opt-in per request (client sends tz). Without
  // tz we can't do local-day math, so offers default off and only the manual
  // controls (driven by `difficulty`) show.
  const tzRaw = req.query.tz;
  let offerFor: (t: typeof tasksTable.$inferSelect) => boolean = () => false;
  if (typeof tzRaw === "string" && tzRaw && isAiConfigured()) {
    const tz = resolveTimeZone(tzRaw);
    const now = new Date();
    const todayStr = localDateKey(now, tz);
    const [latest] = await db.select().from(brainCheckinsTable)
      .where(eq(brainCheckinsTable.userId, userId))
      .orderBy(desc(brainCheckinsTable.createdAt), desc(brainCheckinsTable.id))
      .limit(1);
    const mode = deriveBrainState(latest, now, tz).mode;
    offerFor = (t) => evaluateDifficultyOffer(
      {
        completed: t.completed, difficulty: t.difficulty, struggleScore: t.struggleScore,
        dueDate: t.dueDate, isAnchored: t.isAnchored, isDailyFocus: t.isDailyFocus,
        focusDate: t.focusDate, difficultyOfferSnoozedAt: t.difficultyOfferSnoozedAt,
      },
      { now, todayStr, mode },
    );
  }
```

Then pass it into serialization. Wherever the handler currently calls `formatTask(t, stepsForT)` for the list, change it to `formatTask(t, stepsForT, { difficultyOfferable: offerFor(t) })`.

> If `GET /tasks` currently serializes without per-task steps, keep that behavior — `offerFor` needs only the task row, not steps. Match the handler's existing steps-loading approach; do not add a steps query solely for offers.

- [ ] **Step 5: Thread the offer through momentum**

In `artifacts/api-server/src/routes/momentum.ts`, the handler already has `state.mode`, `now`, `todayStr`, and the raw open rows in `byId`. Add the import:

```ts
import { evaluateDifficultyOffer } from "../lib/difficulty";
import { isAiConfigured } from "../lib/ai/client";
```

Then change the `suggestions` mapping (lines 85–89) so each suggestion's task carries the flag:

```ts
  const canOffer = isAiConfigured();
  const suggestions = ranked.slice(0, 3).map((s, i) => {
    const row = byId.get(s.taskId)!;
    const offerable = canOffer && evaluateDifficultyOffer(
      {
        completed: row.completed, difficulty: row.difficulty, struggleScore: row.struggleScore,
        dueDate: row.dueDate, isAnchored: row.isAnchored, isDailyFocus: row.isDailyFocus,
        focusDate: row.focusDate, difficultyOfferSnoozedAt: row.difficultyOfferSnoozedAt,
      },
      { now, todayStr, mode: state.mode },
    );
    return {
      task: formatTask(row, stepsByTask.get(s.taskId) ?? [], { difficultyOfferable: offerable }),
      reason: s.reason,
      kind: i === 0 ? "primary" : "alternate",
    };
  });
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @workspace/api-server test routes/difficulty` then the whole suite `pnpm --filter @workspace/api-server test`
Expected: PASS (including the Task 4 assertions on `difficulty` / `difficultyOfferable` — un-skip them if you skipped earlier).

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts artifacts/api-server/src/routes/momentum.ts artifacts/api-server/src/routes/difficulty.test.ts
git commit -m "feat(api): serialize difficulty + surface anti-shame offer on tasks & momentum"
```

---

## Task 7: OpenAPI contract + client codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (`Task` schema ~1881–1937; new paths near the `/tasks/{id}/breakdown` block ~776–811; `GET /tasks` params)

**Interfaces:**
- Produces (generated into `@workspace/api-client-react`): `useApplyDifficulty`, `useSnoozeDifficultyOffer` hooks; `Task.difficulty`, `Task.difficultyOfferable` typed fields.

- [ ] **Step 1: Add the two fields to the `Task` schema**

In `lib/api-spec/openapi.yaml`, in the `Task` schema `properties` (after `questlineId`, ~line 1936), add:

```yaml
        difficulty:
          type: string
          enum: [easy, medium, hard]
          description: Current difficulty rung of the quest
        difficultyOfferable:
          type: boolean
          description: True when the app is gently offering a smaller version (never a shame signal; never a count)
```

And add both to the `Task` `required` list (line 1883):

```yaml
      required: [id, userId, title, points, completed, dueDate, priority, createdAt, category, categoryLabel, steps, difficulty, difficultyOfferable]
```

- [ ] **Step 2: Add a `tz` query param to `GET /tasks`**

Find the `GET /tasks` operation in `openapi.yaml`. Add to its `parameters` list (alongside the existing `date` / `completed` / `category` query params):

```yaml
        - name: tz
          in: query
          required: false
          description: IANA timezone; enables local-day adaptive-difficulty offer flags on returned quests
          schema:
            type: string
```

- [ ] **Step 3: Add the two new operations**

After the `/tasks/{id}/breakdown` operation block (ends ~line 811, before `/tasks/{id}/steps/{stepId}`), add:

```yaml
  /tasks/{id}/difficulty:
    post:
      operationId: applyDifficulty
      tags: [tasks]
      summary: Move a quest to an easy/medium/hard rung (drafts the ladder on first use)
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
              type: object
              required: [level]
              properties:
                level:
                  type: string
                  enum: [easy, medium, hard]
      responses:
        "200":
          description: The quest at its new rung
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Task"
        "400":
          description: Invalid level
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "409":
          description: Quest is completed
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "429":
          description: Cooldown — too many resize requests
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "502":
          description: Model or parse failure
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "503":
          description: AI difficulty not configured
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /tasks/{id}/difficulty/snooze:
    post:
      operationId: snoozeDifficultyOffer
      tags: [tasks]
      summary: Dismiss the "smaller version" offer for this quest for a few days
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Snooze recorded
          content:
            application/json:
              schema:
                type: object
                required: [ok]
                properties:
                  ok:
                    type: boolean
        "404":
          description: Quest not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

- [ ] **Step 4: Run codegen and typecheck the libs**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: PASS — orval regenerates `@workspace/api-zod` + `@workspace/api-client-react`; the trailing `typecheck:libs` succeeds. Confirm the new symbols exist:

Run: `pnpm --filter @workspace/api-server test difficulty` (sanity — server untouched) and verify generation by grepping the generated client for `useApplyDifficulty` and `useSnoozeDifficultyOffer`.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api-spec): difficulty apply/snooze operations + Task difficulty fields; regen client"
```

---

## Task 8: Client hook — apply/snooze with dual invalidation

**Files:**
- Create: `artifacts/focusquest/src/hooks/use-difficulty.ts`

**Interfaces:**
- Consumes: `useApplyDifficulty`, `useSnoozeDifficultyOffer`, `getGetTasksQueryKey`, `getGetTasksMomentumQueryKey`, `Task` (`@workspace/api-client-react`); `useToast`; `apiErrorMessage`.
- Produces: `useDifficulty(task: Task | null)` → `{ apply(level): void; snooze(): void; isBusy: boolean; canEasier: boolean; canHarder: boolean }`.

- [ ] **Step 1: Implement the hook**

Create `artifacts/focusquest/src/hooks/use-difficulty.ts` (mirrors the invalidation pattern in `hooks/use-micro-step.ts`):

```ts
import { useQueryClient } from "@tanstack/react-query";
import {
  Task, useApplyDifficulty, useSnoozeDifficultyOffer,
  getGetTasksQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";

type Level = "easy" | "medium" | "hard";

/**
 * Manual easier/harder controls + offer actions for one quest. Any success is a
 * task mutation, so it invalidates BOTH the tasks and momentum query keys
 * (momentum never refetches on focus — Act III invariant).
 */
export function useDifficulty(task: Task | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const apply = useApplyDifficulty();
  const snooze = useSnoozeDifficultyOffer();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
  };

  const current = (task?.difficulty ?? "medium") as Level;

  const applyLevel = (level: Level) => {
    if (!task) return;
    apply.mutate(
      { id: task.id, data: { level } },
      {
        onSuccess: () => invalidate(),
        onError: (err) => toast({ description: apiErrorMessage(err), variant: "destructive" }),
      },
    );
  };

  const snoozeOffer = () => {
    if (!task) return;
    snooze.mutate(
      { id: task.id },
      { onSuccess: () => invalidate(), onError: () => invalidate() },
    );
  };

  return {
    apply: applyLevel,
    snooze: snoozeOffer,
    isBusy: apply.isPending || snooze.isPending,
    canEasier: current !== "easy",
    canHarder: current !== "hard",
  };
}
```

> Verify the generated mutation argument shape (`{ id, data: { level } }`) against the emitted `useApplyDifficulty` signature from Task 7 and adjust the call to match orval's output exactly (some orval configs use `{ id, data }`, others flatten). This is the only spot the exact generated shape matters.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/focusquest/src/hooks/use-difficulty.ts
git commit -m "feat(web): useDifficulty hook — apply/snooze with tasks+momentum invalidation"
```

---

## Task 9: Client UI — difficulty controls + offer chip

**Files:**
- Create: `artifacts/focusquest/src/components/difficulty-controls.tsx`
- Create (test): `artifacts/focusquest/src/components/difficulty-controls.test.tsx`
- Modify: `artifacts/focusquest/src/components/task-item.tsx` (render `<DifficultyControls task={task} />`)

**Interfaces:**
- Consumes: `useDifficulty` (Task 8); `Task`.
- Produces: `<DifficultyControls task={task} />` — easier/harder buttons (disabled at floor/ceiling) and, when `task.difficultyOfferable`, the offer chip with "Make it smaller" / "Not now".

- [ ] **Step 1: Write the failing component test**

Create `artifacts/focusquest/src/components/difficulty-controls.test.tsx`. Match the render/util imports the sibling component tests use (check an existing `*.test.tsx` such as `momentum-board.test.tsx` for the shared `renderWithProviders` and mocking approach). Behaviors to pin:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/render"; // <- match the real helper sibling tests use

const apply = vi.fn();
const snooze = vi.fn();
vi.mock("@/hooks/use-difficulty", () => ({
  useDifficulty: () => ({ apply, snooze, isBusy: false, canEasier: true, canHarder: true }),
}));

import { DifficultyControls } from "./difficulty-controls";

const baseTask = { id: 1, title: "T", difficulty: "medium", difficultyOfferable: false } as never;

describe("DifficultyControls", () => {
  it("hides the offer chip unless the quest is offerable", () => {
    renderWithProviders(<DifficultyControls task={baseTask} />);
    expect(screen.queryByText(/smaller version/i)).toBeNull();
  });

  it("shows the offer chip and applies easy on 'Make it smaller'", () => {
    renderWithProviders(<DifficultyControls task={{ ...baseTask, difficultyOfferable: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /make it smaller/i }));
    expect(apply).toHaveBeenCalledWith("easy");
  });

  it("snoozes on 'Not now'", () => {
    renderWithProviders(<DifficultyControls task={{ ...baseTask, difficultyOfferable: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(snooze).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workspace/focusquest test difficulty-controls`
Expected: FAIL — `Cannot find module './difficulty-controls'`.

- [ ] **Step 3: Implement the component**

Create `artifacts/focusquest/src/components/difficulty-controls.tsx`. Use the app's existing button/chip primitives (match what `task-item.tsx` already imports — e.g. the shared `Button` and icon set). Reference implementation:

```tsx
import type { Task } from "@workspace/api-client-react";
import { useDifficulty } from "@/hooks/use-difficulty";

export function DifficultyControls({ task }: { task: Task }) {
  const { apply, snooze, isBusy, canEasier, canHarder } = useDifficulty(task);

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          disabled={!canEasier || isBusy}
          onClick={() => apply("easy")}
          className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
          aria-label="Make this quest easier"
        >
          Easier
        </button>
        <button
          type="button"
          disabled={!canHarder || isBusy}
          onClick={() => apply("hard")}
          className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
          aria-label="Make this quest harder"
        >
          Harder
        </button>
      </div>

      {task.difficultyOfferable && (
        <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1 text-xs">
          <span className="text-muted-foreground">This one keeps sliding — want a smaller version?</span>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => apply("easy")}
            className="font-medium text-primary hover:underline disabled:opacity-40"
          >
            Make it smaller
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => snooze()}
            className="text-muted-foreground hover:underline disabled:opacity-40"
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
```

> Styling: swap the utility classes to match the app's actual design tokens used elsewhere in `task-item.tsx` (this repo uses Tailwind + shadcn-style tokens). Keep the copy verbatim — it's anti-shame calibrated.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @workspace/focusquest test difficulty-controls`
Expected: PASS.

- [ ] **Step 5: Mount in `task-item.tsx`**

In `artifacts/focusquest/src/components/task-item.tsx`, import the component and render it in the task body (near the existing breakdown/steps controls):

```tsx
import { DifficultyControls } from "./difficulty-controls";
```

and, within the task's detail area (where steps / breakdown actions render), add:

```tsx
        <DifficultyControls task={task} />
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/focusquest/src/components/difficulty-controls.tsx artifacts/focusquest/src/components/difficulty-controls.test.tsx artifacts/focusquest/src/components/task-item.tsx
git commit -m "feat(web): difficulty controls + anti-shame smaller-version offer on task item"
```

---

## Task 10: Wire tz into the task list + end-to-end verification

**Files:**
- Modify: the focusquest data-fetch call for the task list (the `useGetTasks(...)` call in `pages/tasks.tsx` or wherever the list is loaded) to pass `{ tz: browserTimeZone() }` so offer flags are computed.

**Interfaces:**
- Consumes: `browserTimeZone` (`@/lib/timezone`) — already used by `use-micro-step.ts`.

- [ ] **Step 1: Pass tz to the task-list query**

Find the task-list fetch (search for `useGetTasks(` in `artifacts/focusquest/src`). Add the `tz` query param so the server computes offers. Example:

```tsx
import { browserTimeZone } from "@/lib/timezone";
// ...
const tasksQuery = useGetTasks({ tz: browserTimeZone() /* keep any existing params */ });
```

> Match the existing call's parameter object shape exactly (orval passes query params as the first arg object). Keep any current filters (`completed`, `category`, `date`) intact.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: PASS.

- [ ] **Step 3: Full server + client test sweep**

Run: `pnpm --filter @workspace/api-server test` then `pnpm --filter @workspace/focusquest test`
Expected: PASS across both suites.

- [ ] **Step 4: Manual end-to-end verification (browser)**

Start the dev servers and verify the real flow (use the project's run/verify skill or `preview_start`). Confirm:
1. A quest shows **Easier / Harder** controls.
2. Clicking **Easier** on a fresh quest shows the ~1–2s spinner, then the quest's title/estimate/steps shrink; the rung persists on reload.
3. Clicking **Harder** (or Easier again) swaps without a second spinner (ladder cached).
4. Force an offer: seed `struggle_score >= 3` on an incomplete, non-easy quest (or push its due date forward 3×), reload with tz — the chip *"This one keeps sliding — want a smaller version?"* appears; **Make it smaller** applies easy and the chip clears; **Not now** dismisses it and it stays gone on reload.
5. Confirm no struggle count is ever shown, and the momentum board reflects the resized quest (title/estimate updated) without a manual refresh.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(web): request local-day difficulty offers on the task list"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Data model (§1) → Task 1.
- LLM ladder generation (§2) → Task 2.
- Swap mechanics / reversibility / step reset (§3) → Task 4.
- Struggle score + persisted increments (§4) → Task 5; ambient signals + offer evaluation → Task 3; surfacing → Task 6.
- API surface + client + dual invalidation (§5) → Tasks 4, 7, 8.
- Anti-shame guardrails (§6) → enforced in Tasks 3 (easy floor / snooze / completed), 5 (no counts; server-only score), 9 (copy). No `activityTable` writes anywhere in Tasks 4–6 (verified: none added).
- Edge cases (§7): anchored → Task 3 test; recurring per-instance → variants are per-row (Task 1); AI-not-configured hides controls/offers → Tasks 6 (`isAiConfigured` gate) + 9; completed never offers → Task 3; ladder staleness on edit → Task 5.
- Testing strategy (§8) → tests in Tasks 2, 3, 4, 5, 6, 9.
- Sequencing / schema-push note (§9) → Task 1 + Global Constraints.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". Three implementer notes intentionally defer to the *live* generated/harness shapes (orval mutation arg shape in Task 8; shared route-test + RTL harness imports in Tasks 4/9; existing design tokens in Task 9) — these are "match what the codebase already emits", not missing logic. Every code step ships complete code.

**Type consistency:** `DifficultyLevel` / `RungContent` / `VariantLadder` declared in Task 1 (db), imported unchanged in Tasks 3–4. `VariantsResult` / `VariantDraft` from Task 2 consumed by `assembleLadder` (Task 3) and the route (Task 4). `OfferInput` / `OfferContext` from Task 3 used identically in Tasks 6. `evaluateDifficultyOffer` signature stable across Tasks 3/6. `formatTask(task, steps, opts?)` third-arg shape consistent in Tasks 4/6. Hook names `useApplyDifficulty` / `useSnoozeDifficultyOffer` match the `operationId`s in Task 7 and the consumer in Task 8.
