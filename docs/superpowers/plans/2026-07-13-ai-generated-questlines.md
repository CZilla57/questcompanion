# AI-Generated Questlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the New Questline dialog, turn a goal into 3–6 AI-drafted quests the user can trim in an editable preview, then create the questline + kept quests (anchored) in one atomic call.

**Architecture:** Reuse the Groq `generateJson` seam. A new pure prompt/parser lib (mirroring `task-breakdown.ts`) + a side-effect-free `POST /questlines/suggest-quests` endpoint produce suggestions; the existing `POST /questlines` is extended to atomically create anchored quests from an optional `questTitles`. Frontend adds the draft/preview flow to the existing create dialog.

**Tech Stack:** TypeScript, Express, Drizzle (Postgres/Neon), Groq LLM via `generateJson`, Vitest, React 19 + wouter v3 + TanStack Query v5, orval codegen, Tailwind/shadcn.

## Global Constraints

- **No schema/table changes, no `drizzle push`.** Generated quests are ordinary anchored `tasks` rows.
- Reuse the existing AI seam: `generateJson`, `isAiConfigured`, `AiClientError` from `../lib/ai/client`; `createCooldown` from `../lib/ai/breakdown-cooldown`. Mirror `task-breakdown.ts`/`task-breakdown.test.ts` structure.
- Caps: `MIN_QUESTS = 3`, `MAX_QUESTS = 6`, `MAX_QUEST_LENGTH = 120`, `MAX_QUESTLINE_QUESTS = 12`.
- **Suggest endpoint is side-effect-free** (creates nothing). Error ladder: `400` missing/`>200`-char goal, `503` if `!isAiConfigured()`, `429` on cooldown, `502` on model/parse failure.
- **Create-with-quests is atomic** (single `db.transaction`). Each generated quest: `isAnchored: true`, `dueDate: null`, `priority: "medium"`, `points`+`category` from `assignPoints(title, "medium")`, `questlineId` = the new questline's id.
- Frontend: the "Draft quests with AI" button always shows; handle `503`/`429`/`502` with toasts (no pre-check). On create, navigate to `/questlines/${created.id}`.
- Codegen: edit `lib/api-spec/openapi.yaml` → `pnpm --filter @workspace/api-spec codegen`. Never hand-edit `*/src/generated`.
- Verification: `pnpm typecheck` (root) + `pnpm --filter @workspace/api-server test` (includes the new unit tests). Authenticated browser walkthrough is user-run (Auth0 gate). Needs `GROQ_API_KEY` in prod.
- Branch: `feat/questline-ai-generation` (already created). Verify the branch before each commit (`git rev-parse --abbrev-ref HEAD`) — concurrent sessions share this working tree.

---

### Task 1: Pure AI lib + cooldown + tests (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/ai/questline-quests.ts`
- Create: `artifacts/api-server/src/lib/ai/suggest-cooldown.ts`
- Test: `artifacts/api-server/src/lib/ai/questline-quests.test.ts`

**Interfaces:**
- Produces:
  - `buildQuestlineQuestsPrompt(goal: string) => string`
  - `parseQuestlineQuests(raw: unknown) => string[]`
  - `suggestQuestlineQuests(goal: string, generate: GenerateJson) => Promise<string[]>`
  - `sanitizeQuestTitles(titles: string[], max?: number) => string[]`
  - `class QuestlineQuestsParseError extends Error`
  - consts `MIN_QUESTS`, `MAX_QUESTS`, `MAX_QUEST_LENGTH`, `MAX_QUESTLINE_QUESTS`
  - `suggestCooldown: Cooldown` (from suggest-cooldown.ts)

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/ai/questline-quests.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  buildQuestlineQuestsPrompt,
  parseQuestlineQuests,
  suggestQuestlineQuests,
  sanitizeQuestTitles,
  QuestlineQuestsParseError,
  MIN_QUESTS,
  MAX_QUESTS,
  MAX_QUEST_LENGTH,
  MAX_QUESTLINE_QUESTS,
} from "./questline-quests";

describe("buildQuestlineQuestsPrompt", () => {
  it("includes the goal, the count bounds, and the JSON shape", () => {
    const p = buildQuestlineQuestsPrompt("Run a 5K");
    expect(p).toContain("Run a 5K");
    expect(p).toContain(String(MIN_QUESTS));
    expect(p).toContain(String(MAX_QUESTS));
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain("\"quests\"");
  });
});

describe("parseQuestlineQuests", () => {
  it("trims and returns valid quests", () => {
    expect(parseQuestlineQuests({ quests: ["  a ", "b", "c"] })).toEqual(["a", "b", "c"]);
  });
  it("drops empty/whitespace quests", () => {
    expect(parseQuestlineQuests({ quests: ["a", "   ", "b", "", "c"] })).toEqual(["a", "b", "c"]);
  });
  it("truncates over-long quests to MAX_QUEST_LENGTH", () => {
    const long = "x".repeat(MAX_QUEST_LENGTH + 50);
    const [first] = parseQuestlineQuests({ quests: [long, "b", "c"] });
    expect(first.length).toBe(MAX_QUEST_LENGTH);
  });
  it("clamps to MAX_QUESTS", () => {
    const many = Array.from({ length: MAX_QUESTS + 4 }, (_, i) => `quest ${i}`);
    expect(parseQuestlineQuests({ quests: many })).toHaveLength(MAX_QUESTS);
  });
  it("throws when fewer than MIN_QUESTS usable quests remain", () => {
    expect(() => parseQuestlineQuests({ quests: ["only one", "  "] })).toThrow(QuestlineQuestsParseError);
  });
  it("throws on a non-object or missing quests array", () => {
    expect(() => parseQuestlineQuests({ nope: true })).toThrow(QuestlineQuestsParseError);
    expect(() => parseQuestlineQuests(null)).toThrow(QuestlineQuestsParseError);
    expect(() => parseQuestlineQuests({ quests: "not an array" })).toThrow(QuestlineQuestsParseError);
  });
});

describe("suggestQuestlineQuests", () => {
  it("passes the built prompt to generate and returns parsed quests", async () => {
    const generate = vi.fn(async () => ({ quests: ["a", "b", "c"] }));
    const result = await suggestQuestlineQuests("Learn guitar", generate);
    expect(result).toEqual(["a", "b", "c"]);
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("Learn guitar"));
  });
});

describe("sanitizeQuestTitles", () => {
  it("trims, drops empties, and caps count to MAX_QUESTLINE_QUESTS", () => {
    const many = Array.from({ length: MAX_QUESTLINE_QUESTS + 3 }, (_, i) => ` t${i} `);
    const out = sanitizeQuestTitles([" a ", "", "   ", "b", ...many]);
    expect(out).toHaveLength(MAX_QUESTLINE_QUESTS);
    expect(out[0]).toBe("a");
    expect(out).not.toContain("");
  });
  it("truncates over-long titles", () => {
    const long = "y".repeat(MAX_QUEST_LENGTH + 20);
    expect(sanitizeQuestTitles([long])[0].length).toBe(MAX_QUEST_LENGTH);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- questline-quests`
Expected: FAIL — cannot find module `./questline-quests`.

- [ ] **Step 3: Write the cooldown**

Create `artifacts/api-server/src/lib/ai/suggest-cooldown.ts`:

```ts
import { createCooldown } from "./breakdown-cooldown";

export const SUGGEST_COOLDOWN_MS = 3000;
export const suggestCooldown = createCooldown(SUGGEST_COOLDOWN_MS);
```

- [ ] **Step 4: Write the lib**

Create `artifacts/api-server/src/lib/ai/questline-quests.ts`:

```ts
import type { GenerateJson } from "./task-breakdown";

export const MIN_QUESTS = 3;
export const MAX_QUESTS = 6;
export const MAX_QUEST_LENGTH = 120;
export const MAX_QUESTLINE_QUESTS = 12;

export class QuestlineQuestsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestlineQuestsParseError";
  }
}

export function buildQuestlineQuestsPrompt(goal: string): string {
  return `You help people with ADHD turn a big goal into a short quest line they can actually start. Break the goal below into ${MIN_QUESTS}-${MAX_QUESTS} concrete quests that move it forward.

Rules:
- Each quest is a single concrete action or milestone toward the goal, written as a short present-tense imperative phrase.
- Order them from the easiest starting move to later progress.
- The FIRST quest must be a tiny, no-decision starting action that still makes real progress.
- No comfort rituals, warm-ups, or filler (never "get motivated", "make a plan to plan", "take a deep breath").
- Never use vague verbs like "organize", "work on", "deal with", or "handle" — name the specific action.
- Do not restate the goal itself as a quest.
- Return between ${MIN_QUESTS} and ${MAX_QUESTS} quests.

Goal: ${goal}

Respond with JSON only, in this exact shape: {"quests": ["first quest", "second quest", "..."]}`;
}

export function parseQuestlineQuests(raw: unknown): string[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { quests?: unknown }).quests)
  ) {
    throw new QuestlineQuestsParseError("Model output did not match { quests: string[] }");
  }

  const quests = ((raw as { quests: unknown[] }).quests)
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .map((q) => (q.length > MAX_QUEST_LENGTH ? q.slice(0, MAX_QUEST_LENGTH) : q))
    .slice(0, MAX_QUESTS);

  if (quests.length < MIN_QUESTS) {
    throw new QuestlineQuestsParseError(`Expected at least ${MIN_QUESTS} quests, got ${quests.length}`);
  }
  return quests;
}

export async function suggestQuestlineQuests(
  goal: string,
  generate: GenerateJson,
): Promise<string[]> {
  const raw = await generate(buildQuestlineQuestsPrompt(goal));
  return parseQuestlineQuests(raw);
}

/** Title hygiene for the create-with-quests path: trim, drop empties, cap length + count. */
export function sanitizeQuestTitles(titles: string[], max = MAX_QUESTLINE_QUESTS): string[] {
  return titles
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.length > MAX_QUEST_LENGTH ? t.slice(0, MAX_QUEST_LENGTH) : t))
    .slice(0, max);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- questline-quests`
Expected: PASS. Then run the full suite once: `pnpm --filter @workspace/api-server test` → all green.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/ai/questline-quests.ts artifacts/api-server/src/lib/ai/questline-quests.test.ts artifacts/api-server/src/lib/ai/suggest-cooldown.ts
git commit -m "feat(api): add questline-quests AI prompt/parser + suggest cooldown with tests"
```

---

### Task 2: API contract — suggest path + `questTitles` on create + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerates: `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`

**Interfaces:**
- Produces: `useSuggestQuestlineQuests` hook; `useCreateQuestline` body gains optional `questTitles`. Types `SuggestQuestlineQuestsInput`, `SuggestedQuestlineQuests`.

- [ ] **Step 1: Add `questTitles` to `QuestlineInput`**

In `lib/api-spec/openapi.yaml`, in the `QuestlineInput` schema, add a property (after `color`):

```yaml
        questTitles:
          type: array
          maxItems: 12
          items:
            type: string
            maxLength: 120
          description: Optional quest titles to create (anchored) with the questline.
```

- [ ] **Step 2: Add the suggest path**

In `paths:`, alongside the other `/questlines` paths, add:

```yaml
  /questlines/suggest-quests:
    post:
      operationId: suggestQuestlineQuests
      tags: [questlines]
      summary: Suggest quest titles for a goal (AI, creates nothing)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SuggestQuestlineQuestsInput"
      responses:
        "200":
          description: Suggested quest titles
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuggestedQuestlineQuests"
        "429":
          description: Cooldown — too many suggestion requests
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
          description: AI drafting not configured
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

- [ ] **Step 3: Add the suggest schemas**

In `components.schemas`, after the `QuestlineClaimResult` schema, add:

```yaml
    SuggestQuestlineQuestsInput:
      type: object
      required: [goal]
      properties:
        goal:
          type: string
          minLength: 1
          maxLength: 200

    SuggestedQuestlineQuests:
      type: object
      required: [quests]
      properties:
        quests:
          type: array
          items:
            type: string
```

- [ ] **Step 4: Regenerate the client**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: clean. Verify: `grep -n "useSuggestQuestlineQuests" lib/api-client-react/src/generated/api.ts` returns a hit.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (The generated `useSuggestQuestlineQuests` references an endpoint whose handler lands in Task 3 — types only, so typecheck passes.)

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api): add suggest-quests endpoint + questTitles on questline create (codegen)"
```

---

### Task 3: Backend — suggest-quests handler + create-with-quests

**Files:**
- Modify: `artifacts/api-server/src/routes/questlines.ts`

**Interfaces:**
- Consumes: `suggestQuestlineQuests`, `sanitizeQuestTitles`, `QuestlineQuestsParseError` (Task 1); `suggestCooldown` (Task 1); `isAiConfigured`, `generateJson`, `AiClientError` (existing `../lib/ai/client`); `assignPoints` (existing `../lib/auto-points`); existing `db`, `questlinesTable`, `tasksTable`, `formatQuestline`, `parseId`.

- [ ] **Step 1: Add the imports**

In `artifacts/api-server/src/routes/questlines.ts`, add these imports after the existing import block (lines 1–6):

```ts
import { assignPoints } from "../lib/auto-points";
import { isAiConfigured, generateJson, AiClientError } from "../lib/ai/client";
import { suggestQuestlineQuests, sanitizeQuestTitles, QuestlineQuestsParseError } from "../lib/ai/questline-quests";
import { suggestCooldown } from "../lib/ai/suggest-cooldown";
import { logger } from "../lib/logger";
```

- [ ] **Step 2: Extend the `POST /questlines` create handler**

Replace the entire existing create handler (currently):

```ts
// Create a questline.
router.post("/questlines", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, description, color } = req.body as {
    title?: string; description?: string | null; color?: string | null;
  };
  if (!title || !title.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const [row] = await db.insert(questlinesTable).values({
    userId,
    title: title.trim(),
    description: description ?? null,
    color: color ?? null,
  }).returning();

  res.status(201).json(formatQuestline(row, { total: 0, done: 0 }));
});
```

with:

```ts
// Create a questline. Optionally seeds it with anchored quests (questTitles),
// created atomically in one transaction.
router.post("/questlines", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, description, color, questTitles } = req.body as {
    title?: string; description?: string | null; color?: string | null; questTitles?: string[];
  };
  if (!title || !title.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const values = {
    userId,
    title: title.trim(),
    description: description ?? null,
    color: color ?? null,
  };

  const titles = Array.isArray(questTitles) ? sanitizeQuestTitles(questTitles) : [];
  if (titles.length === 0) {
    const [row] = await db.insert(questlinesTable).values(values).returning();
    res.status(201).json(formatQuestline(row, { total: 0, done: 0 }));
    return;
  }

  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(questlinesTable).values(values).returning();
    await tx.insert(tasksTable).values(
      titles.map((t) => {
        const ap = assignPoints(t, "medium");
        return {
          userId,
          title: t,
          points: ap.points,
          category: ap.category,
          priority: "medium",
          dueDate: null,
          isAnchored: true,
          questlineId: created.id,
        };
      }),
    );
    return created;
  });

  res.status(201).json(formatQuestline(row, { total: titles.length, done: 0 }));
});
```

- [ ] **Step 3: Add the suggest-quests handler**

In `artifacts/api-server/src/routes/questlines.ts`, add this handler immediately before `export default router;`:

```ts
// Suggest quest titles for a goal (AI). Side-effect-free — creates nothing.
router.post("/questlines/suggest-quests", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!goal) { res.status(400).json({ error: "goal is required" }); return; }
  if (goal.length > 200) { res.status(400).json({ error: "goal is too long" }); return; }

  if (!isAiConfigured()) { res.status(503).json({ error: "AI drafting is not configured" }); return; }
  if (!suggestCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Give it a moment before drafting again." });
    return;
  }

  let quests: string[];
  try {
    quests = await suggestQuestlineQuests(goal, generateJson);
  } catch (err) {
    if (err instanceof AiClientError || err instanceof QuestlineQuestsParseError) {
      logger.warn({ err }, "questline quest suggestion failed");
      res.status(502).json({ error: "Couldn't draft quests — add them manually." });
      return;
    }
    throw err;
  }

  res.json({ quests });
});
```

> **Route-order note:** Express matches in registration order. `/questlines/suggest-quests` must be registered so it is NOT captured by `/questlines/:id`. The existing `GET /questlines/:id` only matches GET, and there is no `POST /questlines/:id`, so a `POST` to `/questlines/suggest-quests` cannot be shadowed. Placing this handler before `export default router;` (after the other handlers) is safe. Do not add a `POST /questlines/:id`.

- [ ] **Step 4: Typecheck + regression tests**

Run:
```bash
pnpm typecheck
pnpm --filter @workspace/api-server test
```
Expected: typecheck PASS; api-server suite green (Task 1 tests included).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/questlines.ts
git commit -m "feat(api): add questline suggest-quests endpoint and create-with-quests"
```

---

### Task 4: Frontend — AI draft flow in the New Questline dialog

**Files:**
- Modify: `artifacts/focusquest/src/pages/questlines.tsx`

**Interfaces:**
- Consumes: `useSuggestQuestlineQuests` (Task 2); `useCreateQuestline` body now accepts `questTitles` (Task 2); wouter `useLocation`.

- [ ] **Step 1: Update imports**

In `artifacts/focusquest/src/pages/questlines.tsx`:

Change the wouter import:
```tsx
import { Link } from "wouter";
```
to:
```tsx
import { Link, useLocation } from "wouter";
```

Add `Sparkles` and `X` to the lucide import:
```tsx
import { Scroll, Plus, Trophy, ChevronRight, Sparkles, X } from "lucide-react";
```

Extend the api-client import to add the suggest hook:
```tsx
import {
  Questline,
  useGetQuestlines,
  useCreateQuestline,
  useSuggestQuestlineQuests,
  getGetQuestlinesQueryKey,
} from "@workspace/api-client-react";
```

Add the Checkbox import below the existing UI imports (confirm the component exists at `@/components/ui/checkbox`; if not, use a plain `<input type="checkbox">` styled inline):
```tsx
import { Checkbox } from "@/components/ui/checkbox";
```

- [ ] **Step 2: Add draft state and handlers**

In the `Questlines` component, after the existing `const [description, setDescription] = useState("");` line, add:

```tsx
  const [, navigate] = useLocation();
  const suggestMutation = useSuggestQuestlineQuests();
  const [draftQuests, setDraftQuests] = useState<{ text: string; included: boolean }[]>([]);

  const resetDialog = () => {
    setTitle("");
    setDescription("");
    setDraftQuests([]);
    setIsCreateOpen(false);
  };

  const handleDraft = () => {
    if (!title.trim()) return;
    suggestMutation.mutate({ data: { goal: title.trim() } }, {
      onSuccess: (res) => {
        setDraftQuests(res.quests.map((text) => ({ text, included: true })));
      },
      onError: (err: any) => {
        const status = err?.status ?? err?.response?.status;
        const msg =
          status === 503 ? "AI drafting isn't set up yet."
          : status === 429 ? "Give it a moment and try again."
          : "Couldn't draft quests — add them manually.";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };
```

- [ ] **Step 3: Rewrite `handleCreate` to send kept drafts and navigate**

Replace the existing `handleCreate`:

```tsx
  const handleCreate = () => {
    if (!title.trim()) return;
    createMutation.mutate(
      { data: { title: title.trim(), description: description.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          setTitle("");
          setDescription("");
          setIsCreateOpen(false);
          toast({ title: "Questline created", className: "border-primary" });
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Could not create questline", variant: "destructive" });
        },
      },
    );
  };
```

with:

```tsx
  const handleCreate = () => {
    if (!title.trim()) return;
    const kept = draftQuests.filter((d) => d.included && d.text.trim()).map((d) => d.text.trim());
    createMutation.mutate(
      {
        data: {
          title: title.trim(),
          description: description.trim() || null,
          ...(kept.length ? { questTitles: kept } : {}),
        },
      },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          resetDialog();
          toast({ title: "Questline created", className: "border-primary" });
          navigate(`/questlines/${created.id}`);
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Could not create questline", variant: "destructive" });
        },
      },
    );
  };
```

- [ ] **Step 4: Add the draft UI to the dialog**

In the create `<Dialog>`, change its `onOpenChange` to reset drafts on close, and insert the draft controls between the `<Textarea>` and the footer buttons.

Change:
```tsx
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
```
to:
```tsx
      <Dialog open={isCreateOpen} onOpenChange={(o) => (o ? setIsCreateOpen(true) : resetDialog())}>
```

Then, immediately after the `<Textarea ... />` line and before the `<div className="flex justify-end gap-2">` footer, insert:

```tsx
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={handleDraft}
                disabled={!title.trim() || suggestMutation.isPending}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {suggestMutation.isPending ? "Drafting…" : "Draft quests with AI"}
              </Button>
              {draftQuests.length > 0 && (
                <span className="text-xs text-muted-foreground">Uncheck any you don't want</span>
              )}
            </div>

            {draftQuests.length > 0 && (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {draftQuests.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Checkbox
                      checked={d.included}
                      onCheckedChange={(v) =>
                        setDraftQuests((prev) => prev.map((q, j) => (j === i ? { ...q, included: v === true } : q)))
                      }
                      aria-label={`Include quest ${i + 1}`}
                    />
                    <Input
                      value={d.text}
                      onChange={(e) =>
                        setDraftQuests((prev) => prev.map((q, j) => (j === i ? { ...q, text: e.target.value } : q)))
                      }
                      className={d.included ? "" : "opacity-50 line-through"}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={`Remove quest ${i + 1}`}
                      onClick={() => setDraftQuests((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

> If `@/components/ui/checkbox` does not exist, replace `<Checkbox checked={d.included} onCheckedChange={(v) => ...(v === true)...} />` with a native `<input type="checkbox" checked={d.included} onChange={(e) => ...(e.target.checked)...} className="w-4 h-4 accent-primary" />` and drop the Checkbox import. Verify by listing `artifacts/focusquest/src/components/ui/` before writing.

- [ ] **Step 6: End-to-end verification (user-run — Auth0 gate)**

With the app running, on `/questlines`:
1. Open New Questline → type "Run a 5K" → "Draft quests with AI" → ~3–6 rows appear.
2. Uncheck one, edit another's text, remove a third → Create.
3. You land on `/questlines/:id` showing the kept quests as **anchored** (no-deadline) quests; `done/total` shows `0/<kept>`.
4. Create a questline WITHOUT drafting → still works (no quests), lands on its page.
5. (If `GROQ_API_KEY` unset locally) the Draft button toasts "AI drafting isn't set up yet." and manual create still works.

- [ ] **Step 7: Commit**

```bash
git add artifacts/focusquest/src/pages/questlines.tsx
git commit -m "feat(web): draft questline quests with AI in the create dialog"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- Pure lib (prompt/parser/suggest/sanitize) + cooldown (spec §Backend 1–2) → Task 1.
- `suggest-quests` endpoint (spec §Backend 3) → Task 3 Step 3.
- Create-with-`questTitles` atomic (spec §Backend 4) → Task 3 Step 2.
- Contract: `questTitles` on `QuestlineInput` + suggest path/schemas (spec §API contract) → Task 2.
- Editable-preview create-dialog flow (spec §Frontend) → Task 4.
- No schema change → confirmed: no task touches `lib/db` or runs `drizzle push`.
- Testing: parser/sanitize unit tests (spec §Testing) → Task 1; typecheck + regression gate → Tasks 3–4.

**Placeholder scan** — no TBD/TODO; every code step is complete. One flagged verify-before-write (`checkbox` component existence) with a concrete native-input fallback.

**Type consistency** — `GenerateJson` reused from `task-breakdown.ts` (Task 1) matches `generateJson`'s shape passed in Task 3. `sanitizeQuestTitles`/`suggestQuestlineQuests`/`QuestlineQuestsParseError` names identical across Tasks 1 and 3. `assignPoints(title, priority) => { points, category }` matches its use in the create transaction. `questTitles: string[]` is optional across the contract (Task 2), the handler (Task 3), and the frontend payload (Task 4). `useCreateQuestline`'s `onSuccess(created)` returns a `Questline` with `id` used by `navigate`. Anchored-quest insert values (`isAnchored`, `dueDate: null`, `questlineId`) match the `tasks` schema.

**Ordering** — Task 1 (lib) precedes Task 3 (consumes it); Task 2 (contract) precedes Task 3 (backend, uses generated nothing but keeps contract coherent) and Task 4 (consumes generated hooks). Tasks are independently testable: Task 1 by unit tests, Tasks 2–4 by typecheck (+ regression suite).
