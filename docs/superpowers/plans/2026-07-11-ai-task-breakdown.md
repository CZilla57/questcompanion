# AI Task Breakdown Implementation Plan

> **Provider update (post-implementation):** the feature shipped on **Groq**
> (`llama-3.3-70b-versatile`, `GROQ_API_KEY`/`GROQ_MODEL`) instead of Gemini —
> Gemini's free tier was unavailable for this account. The change was contained to
> `client.ts` (Groq's OpenAI-compatible endpoint), with `RESPONSE_SCHEMA` removed
> and the `{ steps: string[] }` shape moved into the prompt. Task bodies below that
> say "Gemini" are historical; the seam design is unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user turn a vague quest ("clean the garage") into a short LLM-generated checklist of concrete first steps that attach to the quest as checkable progress.

**Architecture:** A new `task_steps` table stores steps per task. A pure, unit-tested breakdown module builds an ADHD-tuned prompt and validates the model's JSON; a thin Gemini `fetch` client is the only network seam (swappable). Three Express endpoints (generate/toggle/remove) hang off the existing tasks router; steps ride along in `formatTask`. The frontend renders an inline checklist in `TaskItem` plus a "break it down" offer right after quest creation.

**Tech Stack:** pnpm monorepo, Express 5, Drizzle ORM + Postgres (Neon), Google Gemini REST (free tier) via global `fetch`, React 19 + TanStack Query, orval-generated client, vitest.

## Global Constraints

- **Provider:** Google Gemini REST via global `fetch`, no SDK dependency. Key from `GEMINI_API_KEY`, model from `GEMINI_MODEL` (default `gemini-2.0-flash`).
- **No per-step XP.** Steps never touch the completion/streak/badge/gear transaction.
- **Step bounds:** `MIN_STEPS = 3`, `MAX_STEPS = 6`, `MAX_STEP_LENGTH = 120`.
- **One-shot persistence:** generating a breakdown replaces any existing steps for that task; there is no breakdown history.
- **Feature is optional:** with `GEMINI_API_KEY` unset the endpoint returns `503` and the rest of the app runs unchanged.
- **Never hand-edit** files under `*/src/generated` — regenerate with orval.
- **Codegen:** `pnpm --filter @workspace/api-spec codegen`. **DB push:** `pnpm --filter @workspace/db push` (must `export DATABASE_URL` first — `drizzle.config.ts` does not load `.env`). **api-server tests:** `pnpm --filter @workspace/api-server test`. **Root typecheck:** `pnpm typecheck`.
- Commit messages use conventional-commit prefixes and end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File Structure

**Create:**
- `lib/db/src/schema/task-steps.ts` — `taskStepsTable` + `TaskStep` type.
- `artifacts/api-server/src/lib/ai/task-breakdown.ts` — pure: prompt build + parse + orchestrate.
- `artifacts/api-server/src/lib/ai/task-breakdown.test.ts` — pure tests.
- `artifacts/api-server/src/lib/ai/client.ts` — Gemini `fetch` seam.
- `artifacts/api-server/src/lib/ai/client.test.ts` — client tests (stubbed fetch/env).
- `artifacts/api-server/src/lib/ai/breakdown-cooldown.ts` — per-user in-memory cooldown.
- `artifacts/api-server/src/lib/ai/breakdown-cooldown.test.ts` — cooldown tests.
- `artifacts/focusquest/src/components/task-steps.tsx` — inline checklist + break-it-down UI.

**Modify:**
- `lib/db/src/schema/index.ts` — export the new schema.
- `artifacts/api-server/src/routes/tasks.ts` — 3 endpoints + steps in `formatTask` + list/get batching.
- `lib/api-spec/openapi.yaml` — `TaskStep` schema, `steps` on `Task`, `StepToggleInput`, 3 paths.
- `artifacts/focusquest/src/components/task-item.tsx` — render `<TaskSteps>`.
- `artifacts/focusquest/src/pages/tasks.tsx` — post-create "head start" offer.
- `.env.example` — Gemini config block.

---

## Task 1: `task_steps` table

**Files:**
- Create: `lib/db/src/schema/task-steps.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**
- Consumes: `usersTable` from `./users`, `tasksTable` from `./tasks`.
- Produces: `taskStepsTable` (columns `id`, `taskId`, `userId`, `text`, `position`, `done`, `createdAt`); `type TaskStep = typeof taskStepsTable.$inferSelect`.

- [ ] **Step 1: Create the schema file**

`lib/db/src/schema/task-steps.ts`:

```ts
import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tasksTable } from "./tasks";

export const taskStepsTable = pgTable("task_steps", {
  id: serial("id").primaryKey(),
  // Steps are cascade-deleted with their parent quest.
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  // Denormalized so ownership checks are a plain WHERE, matching focus_sessions.
  userId: integer("user_id").notNull().references(() => usersTable.id),
  text: text("text").notNull(),
  position: integer("position").notNull(), // stable 0-based ordering
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TaskStep = typeof taskStepsTable.$inferSelect;
```

- [ ] **Step 2: Export from the schema barrel**

Add to `lib/db/src/schema/index.ts` (after the `focus-sessions` export line):

```ts
export * from "./task-steps";
```

- [ ] **Step 3: Typecheck the db package**

Run: `pnpm --filter @workspace/db exec tsc --noEmit -p .` — if that script/path errors, run the root gate instead: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Push the schema to Neon**

Run (Bash tool — the `export` is required because `drizzle.config.ts` does not read `.env`):

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```

Expected: ends with `[✓] Changes applied` (additive table, no destructive prompt). If a re-run is blocked by Neon's auto-mode guardrail, the first run is authoritative.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/task-steps.ts lib/db/src/schema/index.ts
git commit -m "$(cat <<'EOF'
feat(db): add task_steps table for AI breakdowns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure breakdown module (prompt + parse)

**Files:**
- Create: `artifacts/api-server/src/lib/ai/task-breakdown.ts`
- Test: `artifacts/api-server/src/lib/ai/task-breakdown.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no DB, no network).
- Produces:
  - `MIN_STEPS = 3`, `MAX_STEPS = 6`, `MAX_STEP_LENGTH = 120`
  - `class BreakdownParseError extends Error`
  - `interface BreakdownInput { title: string; description?: string | null; category?: string | null; estimatedMinutes?: number | null }`
  - `const RESPONSE_SCHEMA` (Gemini responseSchema object for `{ steps: string[] }`)
  - `type GenerateJson = (prompt: string, responseSchema: Record<string, unknown>) => Promise<unknown>`
  - `buildBreakdownPrompt(input: BreakdownInput): string`
  - `parseBreakdown(raw: unknown): string[]`
  - `breakdownTask(input: BreakdownInput, generate: GenerateJson): Promise<string[]>`

- [ ] **Step 1: Write the failing tests**

`artifacts/api-server/src/lib/ai/task-breakdown.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  buildBreakdownPrompt,
  parseBreakdown,
  breakdownTask,
  BreakdownParseError,
  RESPONSE_SCHEMA,
  MIN_STEPS,
  MAX_STEPS,
  MAX_STEP_LENGTH,
} from "./task-breakdown";

describe("buildBreakdownPrompt", () => {
  it("includes the title and the core ADHD constraints", () => {
    const p = buildBreakdownPrompt({ title: "clean the garage" });
    expect(p).toContain("clean the garage");
    expect(p.toLowerCase()).toContain("first step");
    expect(p).toContain(String(MIN_STEPS));
    expect(p).toContain(String(MAX_STEPS));
  });

  it("includes description, category, and estimate when present", () => {
    const p = buildBreakdownPrompt({
      title: "X",
      description: "the big one",
      category: "household",
      estimatedMinutes: 90,
    });
    expect(p).toContain("the big one");
    expect(p).toContain("household");
    expect(p).toContain("90");
  });
});

describe("parseBreakdown", () => {
  it("trims and returns valid steps", () => {
    expect(parseBreakdown({ steps: ["  a ", "b", "c"] })).toEqual(["a", "b", "c"]);
  });

  it("drops empty/whitespace steps", () => {
    expect(parseBreakdown({ steps: ["a", "   ", "b", "", "c"] })).toEqual(["a", "b", "c"]);
  });

  it("truncates over-long steps to MAX_STEP_LENGTH", () => {
    const long = "x".repeat(MAX_STEP_LENGTH + 50);
    const [first] = parseBreakdown({ steps: [long, "b", "c"] });
    expect(first.length).toBe(MAX_STEP_LENGTH);
  });

  it("clamps to MAX_STEPS", () => {
    const many = Array.from({ length: MAX_STEPS + 4 }, (_, i) => `step ${i}`);
    expect(parseBreakdown({ steps: many })).toHaveLength(MAX_STEPS);
  });

  it("throws when fewer than MIN_STEPS usable steps remain", () => {
    expect(() => parseBreakdown({ steps: ["only one", "   "] })).toThrow(BreakdownParseError);
  });

  it("throws on a non-object or missing steps array", () => {
    expect(() => parseBreakdown({ nope: true })).toThrow(BreakdownParseError);
    expect(() => parseBreakdown(null)).toThrow(BreakdownParseError);
    expect(() => parseBreakdown({ steps: "not an array" })).toThrow(BreakdownParseError);
  });
});

describe("breakdownTask", () => {
  it("passes the built prompt + RESPONSE_SCHEMA to generate and returns parsed steps", async () => {
    const generate = vi.fn(async () => ({ steps: ["a", "b", "c"] }));
    const result = await breakdownTask({ title: "Tidy the shed" }, generate);
    expect(result).toEqual(["a", "b", "c"]);
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining("Tidy the shed"),
      RESPONSE_SCHEMA,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test src/lib/ai/task-breakdown.test.ts`
Expected: FAIL — cannot find module `./task-breakdown`.

- [ ] **Step 3: Write the implementation**

`artifacts/api-server/src/lib/ai/task-breakdown.ts`:

```ts
export const MIN_STEPS = 3;
export const MAX_STEPS = 6;
export const MAX_STEP_LENGTH = 120;

export class BreakdownParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BreakdownParseError";
  }
}

export interface BreakdownInput {
  title: string;
  description?: string | null;
  category?: string | null;
  estimatedMinutes?: number | null;
}

// Gemini responseSchema (OpenAPI subset) constraining output to { steps: string[] }.
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    steps: { type: "array", items: { type: "string" } },
  },
  required: ["steps"],
} as const;

export type GenerateJson = (
  prompt: string,
  responseSchema: Record<string, unknown>,
) => Promise<unknown>;

export function buildBreakdownPrompt(input: BreakdownInput): string {
  const context: string[] = [`Task: ${input.title}`];
  if (input.description) context.push(`Details: ${input.description}`);
  if (input.category && input.category !== "default") context.push(`Category: ${input.category}`);
  if (input.estimatedMinutes) context.push(`Estimated time: ${input.estimatedMinutes} minutes`);

  return `You help people with ADHD start tasks they've been avoiding. Break the task below into ${MIN_STEPS}-${MAX_STEPS} concrete first steps that beat the initiation wall.

Rules:
- The FIRST step must be trivially easy — a 2-minute "just start" action that requires no decisions (e.g. "Grab a trash bag and a box").
- Every step is a single concrete PHYSICAL action, written as a present-tense imperative.
- Never use vague verbs like "organize", "sort out", "deal with", or "handle" — name the specific visible action instead.
- Keep each step to a short phrase, not a sentence.
- Do not restate the task itself as a step.
- Return between ${MIN_STEPS} and ${MAX_STEPS} steps.

${context.join("\n")}`;
}

export function parseBreakdown(raw: unknown): string[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { steps?: unknown }).steps)
  ) {
    throw new BreakdownParseError("Model output did not match { steps: string[] }");
  }

  const steps = ((raw as { steps: unknown[] }).steps)
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.length > MAX_STEP_LENGTH ? s.slice(0, MAX_STEP_LENGTH) : s))
    .slice(0, MAX_STEPS);

  if (steps.length < MIN_STEPS) {
    throw new BreakdownParseError(`Expected at least ${MIN_STEPS} steps, got ${steps.length}`);
  }
  return steps;
}

export async function breakdownTask(
  input: BreakdownInput,
  generate: GenerateJson,
): Promise<string[]> {
  const prompt = buildBreakdownPrompt(input);
  const raw = await generate(prompt, RESPONSE_SCHEMA);
  return parseBreakdown(raw);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test src/lib/ai/task-breakdown.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/ai/task-breakdown.ts artifacts/api-server/src/lib/ai/task-breakdown.test.ts
git commit -m "$(cat <<'EOF'
feat(api): ADHD-tuned task breakdown prompt + parser

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Gemini client seam

**Files:**
- Create: `artifacts/api-server/src/lib/ai/client.ts`
- Test: `artifacts/api-server/src/lib/ai/client.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `GenerateJson` shape from Task 2 (this module's `generateJson` is assignable to it).
- Produces:
  - `class AiClientError extends Error`
  - `isAiConfigured(): boolean`
  - `generateJson(prompt: string, responseSchema: Record<string, unknown>): Promise<unknown>`

- [ ] **Step 1: Write the failing tests**

`artifacts/api-server/src/lib/ai/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateJson, isAiConfigured, AiClientError } from "./client";

function geminiResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isAiConfigured", () => {
  it("reflects presence of GEMINI_API_KEY", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    expect(isAiConfigured()).toBe(true);
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(isAiConfigured()).toBe(false);
  });
});

describe("generateJson", () => {
  it("returns the parsed JSON from the model's candidate text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiResponse({ steps: ["a", "b", "c"] })));
    const result = await generateJson("prompt", { type: "object" });
    expect(result).toEqual({ steps: ["a", "b", "c"] });
  });

  it("throws AiClientError when the key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(generateJson("p", {})).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(generateJson("p", {})).rejects.toBeInstanceOf(AiClientError);
  });

  it("throws AiClientError when the candidate text is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ));
    await expect(generateJson("p", {})).rejects.toBeInstanceOf(AiClientError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test src/lib/ai/client.test.ts`
Expected: FAIL — cannot find module `./client`.

- [ ] **Step 3: Write the implementation**

`artifacts/api-server/src/lib/ai/client.ts`:

```ts
const DEFAULT_MODEL = "gemini-2.0-flash";
const REQUEST_TIMEOUT_MS = 15_000;

export class AiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiClientError";
  }
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * The single network seam for LLM calls. Sends a prompt to the Gemini REST API
 * with a JSON responseSchema and returns the parsed JSON object. Swapping to
 * another provider means replacing only this function's body.
 */
export async function generateJson(
  prompt: string,
  responseSchema: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiClientError("GEMINI_API_KEY is not set");
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header (not query string) keeps the key out of URLs and logs.
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.7,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new AiClientError(`Gemini request failed: ${(cause as Error).message}`);
  }

  if (!response.ok) {
    throw new AiClientError(`Gemini request returned ${response.status}`);
  }

  const envelope = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new AiClientError("Gemini returned no candidate text");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AiClientError("Gemini returned text that was not valid JSON");
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test src/lib/ai/client.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Add the Gemini config block to `.env.example`**

Append to `.env.example` (after the `Cron` block, before `Server`):

```
# ── AI (Gemini) ──────────────────────────────────────────
# Free API key from Google AI Studio: https://aistudio.google.com/apikey
# When unset, the AI breakdown feature returns 503 and the app runs normally.
GEMINI_API_KEY=
# Optional model override (default: gemini-2.0-flash)
GEMINI_MODEL=gemini-2.0-flash
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/ai/client.ts artifacts/api-server/src/lib/ai/client.test.ts .env.example
git commit -m "$(cat <<'EOF'
feat(api): swappable Gemini JSON client seam

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Per-user breakdown cooldown

**Files:**
- Create: `artifacts/api-server/src/lib/ai/breakdown-cooldown.ts`
- Test: `artifacts/api-server/src/lib/ai/breakdown-cooldown.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Cooldown { tryAcquire(userId: number, nowMs?: number): boolean }`
  - `createCooldown(intervalMs: number): Cooldown`
  - `BREAKDOWN_COOLDOWN_MS = 3000`
  - `breakdownCooldown: Cooldown` (shared instance the route uses)

- [ ] **Step 1: Write the failing tests**

`artifacts/api-server/src/lib/ai/breakdown-cooldown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createCooldown } from "./breakdown-cooldown";

describe("createCooldown", () => {
  it("allows the first call, denies within the interval, allows again after it", () => {
    const cd = createCooldown(1000);
    expect(cd.tryAcquire(1, 0)).toBe(true);
    expect(cd.tryAcquire(1, 500)).toBe(false);
    expect(cd.tryAcquire(1, 1000)).toBe(true);
  });

  it("tracks users independently", () => {
    const cd = createCooldown(1000);
    expect(cd.tryAcquire(1, 0)).toBe(true);
    expect(cd.tryAcquire(2, 100)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test src/lib/ai/breakdown-cooldown.test.ts`
Expected: FAIL — cannot find module `./breakdown-cooldown`.

- [ ] **Step 3: Write the implementation**

`artifacts/api-server/src/lib/ai/breakdown-cooldown.ts`:

```ts
export interface Cooldown {
  tryAcquire(userId: number, nowMs?: number): boolean;
}

/**
 * Best-effort, in-memory per-user rate guard. Single-instance only (Render free
 * tier); state resets on restart. Prevents rapid re-clicks and free-tier burn.
 */
export function createCooldown(intervalMs: number): Cooldown {
  const lastCall = new Map<number, number>();
  return {
    tryAcquire(userId, nowMs = Date.now()) {
      const prev = lastCall.get(userId);
      if (prev !== undefined && nowMs - prev < intervalMs) {
        return false;
      }
      lastCall.set(userId, nowMs);
      return true;
    },
  };
}

export const BREAKDOWN_COOLDOWN_MS = 3000;
export const breakdownCooldown = createCooldown(BREAKDOWN_COOLDOWN_MS);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test src/lib/ai/breakdown-cooldown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/ai/breakdown-cooldown.ts artifacts/api-server/src/lib/ai/breakdown-cooldown.test.ts
git commit -m "$(cat <<'EOF'
feat(api): per-user cooldown for breakdown generation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Breakdown endpoints + steps in task serialization

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts`

**Interfaces:**
- Consumes: `taskStepsTable` (Task 1); `breakdownTask`, `BreakdownParseError` (Task 2); `generateJson`, `isAiConfigured`, `AiClientError` (Task 3); `breakdownCooldown` (Task 4).
- Produces (HTTP contract that Task 6 mirrors into openapi):
  - `POST /tasks/:id/breakdown` → `201` `Task` (with `steps`), or `404 / 503 / 429 / 502` `{ error }`.
  - `PATCH /tasks/:id/steps/:stepId` body `{ done: boolean }` → `200` `{ id, text, position, done }`, or `400 / 404`.
  - `DELETE /tasks/:id/steps` → `204`.
  - `formatTask(task, steps?)` now returns a `steps: { id, text, position, done }[]` field.

- [ ] **Step 1: Extend the imports**

In `artifacts/api-server/src/routes/tasks.ts`, update the drizzle-orm and db imports and add the AI imports. Change line 2 and line 4, then add three imports after the existing `../lib/*` imports:

```ts
import { eq, and, desc, count, inArray } from "drizzle-orm";
```

```ts
import { db, usersTable, tasksTable, badgesTable, userBadgesTable, activityTable, userGearTable, taskStepsTable } from "@workspace/db";
```

Add near the other lib imports (e.g. after the `logger` import):

```ts
import { breakdownTask, BreakdownParseError } from "../lib/ai/task-breakdown";
import { generateJson, isAiConfigured, AiClientError } from "../lib/ai/client";
import { breakdownCooldown } from "../lib/ai/breakdown-cooldown";
```

- [ ] **Step 2: Add `steps` to `formatTask`**

Replace the `formatTask` signature/return (lines 16-35) so it accepts steps and serializes them:

```ts
function formatTask(
  task: typeof tasksTable.$inferSelect,
  steps: (typeof taskStepsTable.$inferSelect)[] = [],
) {
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
    steps: steps
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, text: s.text, position: s.position, done: s.done })),
  };
}
```

All existing `formatTask(task)` callers keep working (steps default to `[]`).

- [ ] **Step 3: Attach steps in the `GET /tasks` list handler**

In the `router.get("/tasks", ...)` handler, replace the final `res.json(tasks.map(formatTask));` line with a batched steps fetch:

```ts
  const taskIds = tasks.map((t) => t.id);
  const steps = taskIds.length
    ? await db.select().from(taskStepsTable)
        .where(inArray(taskStepsTable.taskId, taskIds))
        .orderBy(taskStepsTable.position)
    : [];
  const stepsByTask = new Map<number, (typeof taskStepsTable.$inferSelect)[]>();
  for (const s of steps) {
    const arr = stepsByTask.get(s.taskId) ?? [];
    arr.push(s);
    stepsByTask.set(s.taskId, arr);
  }

  res.json(tasks.map((t) => formatTask(t, stepsByTask.get(t.id) ?? [])));
```

- [ ] **Step 4: Attach steps in the `GET /tasks/:id` handler**

In `router.get("/tasks/:id", ...)`, after the `if (!task)` guard and before `res.json(formatTask(task));`, fetch and pass steps:

```ts
  const stepsForTask = await db.select().from(taskStepsTable)
    .where(eq(taskStepsTable.taskId, id))
    .orderBy(taskStepsTable.position);
  res.json(formatTask(task, stepsForTask));
```

(Replace the existing bare `res.json(formatTask(task));` in this handler.)

- [ ] **Step 5: Add the three new routes**

Insert these handlers just before `router.patch("/tasks/:id/focus", ...)`:

```ts
router.post("/tasks/:id/breakdown", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  if (!isAiConfigured()) {
    res.status(503).json({ error: "AI breakdown is not configured" });
    return;
  }
  if (!breakdownCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment before generating another breakdown." });
    return;
  }

  let steps: string[];
  try {
    steps = await breakdownTask(
      {
        title: task.title,
        description: task.description,
        category: task.category,
        estimatedMinutes: task.estimatedMinutes,
      },
      generateJson,
    );
  } catch (err) {
    if (err instanceof AiClientError || err instanceof BreakdownParseError) {
      logger.warn({ err, taskId: id }, "task breakdown generation failed");
      res.status(502).json({ error: "Couldn't generate a breakdown, try again." });
      return;
    }
    throw err;
  }

  // Replace any existing steps atomically so a breakdown never half-applies.
  const inserted = await db.transaction(async (tx) => {
    await tx.delete(taskStepsTable)
      .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
    return tx.insert(taskStepsTable)
      .values(steps.map((text, i) => ({ taskId: id, userId, text, position: i })))
      .returning();
  });

  res.status(201).json(formatTask(task, inserted));
});

router.patch("/tasks/:id/steps/:stepId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawStepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;
  const id = parseInt(rawId, 10);
  const stepId = parseInt(rawStepId, 10);
  if (isNaN(id) || isNaN(stepId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const done: unknown = req.body?.done;
  if (typeof done !== "boolean") {
    res.status(400).json({ error: "done must be a boolean" });
    return;
  }

  const [updated] = await db.update(taskStepsTable)
    .set({ done })
    .where(and(
      eq(taskStepsTable.id, stepId),
      eq(taskStepsTable.taskId, id),
      eq(taskStepsTable.userId, userId),
    ))
    .returning();
  if (!updated) { res.status(404).json({ error: "Step not found" }); return; }

  res.json({ id: updated.id, text: updated.text, position: updated.position, done: updated.done });
});

router.delete("/tasks/:id/steps", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Idempotent: the userId filter means a non-owned/absent task deletes nothing.
  await db.delete(taskStepsTable)
    .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
  res.sendStatus(204);
});
```

- [ ] **Step 6: Typecheck the api-server package**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: no errors.

- [ ] **Step 7: Run the full api-server test suite (nothing regressed)**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (existing suites + the three AI suites).

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "$(cat <<'EOF'
feat(api): task breakdown + step endpoints, steps in task payload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: OpenAPI contract + client regeneration

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerated (do NOT hand-edit): `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`

**Interfaces:**
- Consumes: the HTTP contract from Task 5.
- Produces (generated): `Task.steps: TaskStep[]`; `TaskStep` type `{ id, text, position, done }`; hooks `useBreakdownTask`, `usePatchTaskStep`, `useDeleteTaskSteps`.

- [ ] **Step 1: Add `steps` to the `Task` schema**

In `lib/api-spec/openapi.yaml`, in the `Task:` schema (starts at line ~1292): add `steps` to the `required` list and add the property. Change the `required` line to include `steps`:

```yaml
      required: [id, userId, title, points, completed, dueDate, priority, createdAt, category, categoryLabel, steps]
```

Add this property at the end of the `Task` `properties:` block (after `focusDate`):

```yaml
        steps:
          type: array
          description: AI-generated first-step checklist attached to this quest
          items:
            $ref: "#/components/schemas/TaskStep"
```

- [ ] **Step 2: Add the `TaskStep` and `StepToggleInput` schemas**

In the `components/schemas` section (e.g. immediately after the `FocusToggleInput` schema, ~line 1341), add:

```yaml
    TaskStep:
      type: object
      required: [id, text, position, done]
      properties:
        id:
          type: integer
        text:
          type: string
        position:
          type: integer
        done:
          type: boolean

    StepToggleInput:
      type: object
      required: [done]
      properties:
        done:
          type: boolean
```

- [ ] **Step 3: Add the three paths**

In the `paths:` section, after the `/tasks/{id}/focus:` block (ends ~line 583), add:

```yaml
  /tasks/{id}/breakdown:
    post:
      operationId: breakdownTask
      tags: [tasks]
      summary: Generate an AI first-step breakdown for a quest (replaces existing steps)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "201":
          description: Task with its new steps
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Task"
        "429":
          description: Cooldown — too many breakdown requests
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
          description: AI breakdown not configured
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /tasks/{id}/steps/{stepId}:
    patch:
      operationId: patchTaskStep
      tags: [tasks]
      summary: Toggle a breakdown step's done state
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: stepId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/StepToggleInput"
      responses:
        "200":
          description: Updated step
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/TaskStep"
        "400":
          description: Invalid payload
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "404":
          description: Step not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /tasks/{id}/steps:
    delete:
      operationId: deleteTaskSteps
      tags: [tasks]
      summary: Remove all breakdown steps for a quest
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Steps removed
```

- [ ] **Step 4: Regenerate the client + zod packages**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval writes to `lib/api-client-react` + `lib/api-zod`, then the bundled `typecheck:libs` passes with no errors.

- [ ] **Step 5: Confirm the new symbols exist**

Run: `grep -rl "useBreakdownTask\|usePatchTaskStep\|useDeleteTaskSteps" lib/api-client-react/src/generated`
Expected: at least one generated file path prints.

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "$(cat <<'EOF'
feat(api-spec): breakdown/step paths + TaskStep schema, regen client

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Inline steps checklist in the Quest Log

**Files:**
- Create: `artifacts/focusquest/src/components/task-steps.tsx`
- Modify: `artifacts/focusquest/src/components/task-item.tsx`

**Interfaces:**
- Consumes: `Task` (now with `steps`), `useBreakdownTask`, `usePatchTaskStep`, `useDeleteTaskSteps`, `getGetTasksQueryKey` (Task 6).
- Produces: `export function TaskSteps({ task }: { task: Task })`.

- [ ] **Step 1: Create the `TaskSteps` component**

`artifacts/focusquest/src/components/task-steps.tsx`:

```tsx
import { Sparkles, RefreshCw, MoreVertical, Trash2, ListTree } from "lucide-react";
import {
  Task,
  useBreakdownTask,
  usePatchTaskStep,
  useDeleteTaskSteps,
  getGetTasksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Progress } from "./ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

function breakdownErrorMessage(err: any): string {
  const status = err?.status;
  if (status === 503) return "AI breakdown isn't set up yet.";
  if (status === 429) return "Give it a moment before generating another breakdown.";
  if (status === 502) return "Couldn't generate a breakdown — try again.";
  return err?.data?.error ?? "Something went wrong.";
}

export function TaskSteps({ task }: { task: Task }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const breakdownMutation = useBreakdownTask();
  const patchStepMutation = usePatchTaskStep();
  const deleteStepsMutation = useDeleteTaskSteps();

  const steps = task.steps ?? [];
  const doneCount = steps.filter((s) => s.done).length;
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });

  const handleBreakdown = () => {
    breakdownMutation.mutate(
      { id: task.id },
      {
        onSuccess: () => invalidate(),
        onError: (err) => toast({ title: breakdownErrorMessage(err), variant: "destructive" }),
      },
    );
  };

  const handleToggle = (stepId: number, done: boolean) => {
    patchStepMutation.mutate(
      { id: task.id, stepId, data: { done } },
      { onSuccess: () => invalidate() },
    );
  };

  const handleRemove = () => {
    deleteStepsMutation.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Breakdown removed" });
        },
      },
    );
  };

  // No steps yet: offer to break it down (incomplete quests only).
  if (steps.length === 0) {
    if (task.completed) return null;
    return (
      <div className="mt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBreakdown}
          disabled={breakdownMutation.isPending}
          className="h-7 px-2 gap-1.5 text-xs text-primary/80 hover:text-primary hover:bg-primary/10"
        >
          {breakdownMutation.isPending ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          Break it down
        </Button>
      </div>
    );
  }

  const pct = Math.round((doneCount / steps.length) * 100);
  const allDone = doneCount === steps.length;

  return (
    <div className="mt-3 rounded-lg border border-primary/15 bg-primary/[0.03] p-3">
      <div className="flex items-center gap-2 mb-2">
        <ListTree className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary flex-1">
          First steps · {doneCount}/{steps.length}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleBreakdown} disabled={breakdownMutation.isPending}>
              <RefreshCw className="w-3.5 h-3.5 mr-2" /> Regenerate
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleRemove}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Progress value={pct} className="h-1.5 mb-3" />

      <ul className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2">
            <Checkbox
              id={`step-${step.id}`}
              checked={step.done}
              disabled={task.completed || patchStepMutation.isPending}
              onCheckedChange={(v) => handleToggle(step.id, v === true)}
              className="mt-0.5"
            />
            <label
              htmlFor={`step-${step.id}`}
              className={`text-sm leading-snug cursor-pointer ${
                step.done ? "line-through text-muted-foreground" : "text-foreground"
              }`}
            >
              {step.text}
            </label>
          </li>
        ))}
      </ul>

      {allDone && !task.completed && (
        <p className="text-[11px] text-primary/80 mt-2.5 italic">
          All steps done — ready to complete the quest?
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render `TaskSteps` inside `TaskItem`**

In `artifacts/focusquest/src/components/task-item.tsx`, add the import near the top (after the existing local imports):

```tsx
import { TaskSteps } from "./task-steps";
```

Then render it inside the content `<div className="flex-1 min-w-0">`, immediately after the closing `)}` of the `{task.completed && loggingTime && ( ... )}` block and before that content div closes:

```tsx
        <TaskSteps task={task} />
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors (confirms `task.steps`, the hooks, and mutation argument shapes all line up with the generated client).

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/components/task-steps.tsx artifacts/focusquest/src/components/task-item.tsx
git commit -m "$(cat <<'EOF'
feat(web): inline AI step checklist on quests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Post-create "head start" offer + end-to-end verification

**Files:**
- Modify: `artifacts/focusquest/src/pages/tasks.tsx`

**Interfaces:**
- Consumes: `useBreakdownTask`, `getGetTasksQueryKey`, `Task` (already imported in this file).

- [ ] **Step 1: Import the breakdown hook**

In `artifacts/focusquest/src/pages/tasks.tsx`, add `useBreakdownTask` to the existing `@workspace/api-client-react` import (line 4 area, alongside `useCreateTask`).

- [ ] **Step 2: Add state + the created-task breakdown handler**

Add state near the other create-dialog state (after line ~198, `categoryManuallySet`):

```tsx
  const [createdTask, setCreatedTask] = useState<Task | null>(null);
```

Add the mutation near the other mutations (after `updateMutation`, ~line 254):

```tsx
  const breakdownMutation = useBreakdownTask();
```

Add the handler (near `handleCreateTask`):

```tsx
  const handleBreakdownNew = () => {
    if (!createdTask) return;
    breakdownMutation.mutate({ id: createdTask.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        toast({ title: "Broke it into first steps ✦", className: "border-primary bg-primary/10" });
        handleCloseCreate();
      },
      onError: (err: any) => {
        const status = err?.status;
        const msg =
          status === 503 ? "AI breakdown isn't set up yet."
          : status === 429 ? "Give it a moment and try again."
          : status === 502 ? "Couldn't generate a breakdown — try again."
          : err?.data?.error ?? "Something went wrong.";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };
```

- [ ] **Step 3: Switch the create success into the offer instead of closing**

In `handleCreateTask`'s `onSuccess` (lines ~279-288), replace the `handleCloseCreate();` call with `setCreatedTask(task);` (keep the toast and the `invalidateQueries` call). The dialog stays open and flips to the offer view:

```tsx
      onSuccess: (task) => {
        toast({
          title: `Quest added — ${task.points} XP`,
          description: `Category: ${task.categoryLabel}`,
          className: "border-primary bg-primary/10",
        });
        setCreatedTask(task);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      }
```

- [ ] **Step 4: Reset the offer state on close**

In `handleCloseCreate` (lines ~291-299), add `setCreatedTask(null);` alongside the other resets.

- [ ] **Step 5: Render the offer view in the create dialog**

In the create `<Dialog>` (`<DialogContent className="sm:max-w-md ...">`), make the title conditional and render the offer instead of the form when `createdTask` is set. Change the `<DialogTitle>` line to:

```tsx
            <DialogTitle className="text-2xl font-bold text-primary">
              {createdTask ? "Quest Added" : "New Quest"}
            </DialogTitle>
```

Then wrap the existing `<form onSubmit={handleCreateTask} ...> ... </form>` so it only renders when there is no `createdTask`, and add the offer block for when there is. The structure becomes:

```tsx
          {createdTask ? (
            <div className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground font-medium">{createdTask.title}</span> is in your log ✦ Want a head start?
              </p>
              <p className="text-xs text-muted-foreground">
                Let AI break it into a few concrete first steps to beat the initiation wall.
              </p>
              <div className="pt-2 flex justify-end gap-3">
                <Button type="button" variant="ghost" onClick={handleCloseCreate}>Done</Button>
                <Button
                  onClick={handleBreakdownNew}
                  disabled={breakdownMutation.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                >
                  {breakdownMutation.isPending
                    ? <RefreshCw className="w-4 h-4 animate-spin" />
                    : <Sparkles className="w-4 h-4" />}
                  Break it down
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateTask} className="space-y-4 mt-4">
              {/* …existing form body unchanged… */}
            </form>
          )}
```

(`Sparkles` and `RefreshCw` are already imported in this file.)

- [ ] **Step 6: Typecheck the frontend**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 7: Full typecheck gate + all tests**

Run: `pnpm typecheck`
Expected: passes across libs + artifacts.

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS.

- [ ] **Step 8: Manual end-to-end verification**

Ensure `.env` has a real `GEMINI_API_KEY` (free key from https://aistudio.google.com/apikey) and `DATABASE_URL` set. Start the API server and the web app (`pnpm --filter @workspace/api-server dev` and `pnpm --filter @workspace/focusquest dev`, or your usual preview flow), then confirm:

1. Create a quest "clean the garage" → the dialog flips to "Quest Added ✦ Want a head start?" → click **Break it down** → 3–6 steps appear inline on that quest in the Quest Log, first step trivially easy.
2. Tick a step → the progress bar advances and the label strikes through; reload → state persists.
3. On an existing incomplete quest with no steps, the **Break it down** button generates a checklist.
4. **Regenerate** replaces the steps; **Remove** clears them.
5. Temporarily unset `GEMINI_API_KEY` and restart the API → **Break it down** shows the "AI breakdown isn't set up yet" toast, and the rest of the app is unaffected.

- [ ] **Step 9: Commit**

```bash
git add artifacts/focusquest/src/pages/tasks.tsx
git commit -m "$(cat <<'EOF'
feat(web): offer AI breakdown right after creating a quest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

**Spec coverage:** data model → Task 1; AI module (client + pure prompt/parse) → Tasks 2–3; the ADHD-tuned prompt rules → Task 2 Step 3; endpoints (breakdown/patch/delete) + `formatTask` steps + list batching → Task 5; cooldown/503/502/429 error handling → Tasks 4 & 5; OpenAPI + regen + generated hooks → Task 6; inline checklist, progress, regenerate/remove → Task 7; post-create offer → Task 8; `.env.example` config → Task 3; testing (pure vitest) → Tasks 2–4; manual e2e → Task 8. All spec sections map to a task.

**Refinement vs. spec:** the spec said `POST /breakdown` "returns the new steps"; this plan returns the full `Task` (a superset that includes `steps`), which reuses the existing `Task` schema for codegen and lets the frontend replace the cached task directly. Behavior is otherwise identical.

**Type consistency:** `taskStepsTable`/`TaskStep` (Task 1) are consumed unchanged in Task 5; `breakdownTask(input, generate)` and `GenerateJson` (Task 2) match `generateJson` (Task 3); `breakdownCooldown.tryAcquire` (Task 4) matches its route call (Task 5); the `{ id, text, position, done }` step shape is identical across `formatTask` (Task 5), the `TaskStep` OpenAPI schema (Task 6), and the `TaskSteps` component (Task 7); hook names `useBreakdownTask`/`usePatchTaskStep`/`useDeleteTaskSteps` derive from the Task 6 operationIds and are used verbatim in Tasks 7–8.
