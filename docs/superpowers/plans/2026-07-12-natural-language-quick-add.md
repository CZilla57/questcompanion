# Natural-Language Quick-Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user type one line (`Email Sam re: budget tomorrow 3pm #work !high`) and have it parse into a scheduled, categorized, prioritized quest with a live preview and a single Enter.

**Architecture:** A dependency-free `@workspace/quick-add` package holds the deterministic grammar, imported by both the React client (live preview) and the api-server (a `/tasks/parse` endpoint). The endpoint runs the deterministic parser first and only calls Groq when it finds no date/time. Tasks gain a nullable `dueTime` column; hashtags map to the existing 9 categories via an alias table; task creation stays on the existing `POST /tasks`.

**Tech Stack:** pnpm workspaces, TypeScript (strict, `moduleResolution: bundler`, `customConditions: ["workspace"]`), Drizzle ORM + drizzle-zod, Express 5, Vitest, React 19 + Vite + TanStack Query, orval codegen (OpenAPI → react-query client + zod), Groq (`llama-3.3-70b-versatile`) behind the existing `generateJson` seam.

## Global Constraints

- Package manager is **pnpm** only; every install runs from the repo root. Workspace deps use `"workspace:*"`.
- New workspace packages follow the `lib/*` convention: `"type": "module"`, `"private": true`, `exports` pointing at `./src/index.ts`, tsconfig `extends ../../tsconfig.base.json` with `"composite": true`, and a `{ "path": ... }` entry in the root `tsconfig.json` `references`.
- `@workspace/quick-add` must stay **pure**: no DB, no network, no Node built-ins, no `Date.now()` — the current time is always injected as `opts.now`.
- Category slugs are exactly: `health, deep_work, learning, finance, admin, household, social, creative, default`. Priorities are exactly: `low, medium, high`.
- `dueTime` is stored as `text` in `HH:mm` 24-hour form (e.g. `"15:00"`), matching `recurring_tasks.timeOfDay`. `dueDate` stays `YYYY-MM-DD`.
- The `/tasks/parse` endpoint reuses `GROQ_API_KEY` / `GROQ_MODEL`; **no new env vars.** When the key is unset it returns `503` and deterministic quick-add still works.
- After editing `lib/api-spec/openapi.yaml`, regenerate with `pnpm --filter @workspace/api-spec run codegen` and commit the generated output under `lib/api-client-react/src/generated` and `lib/api-zod/src/generated`. Never hand-edit generated files.
- DB schema changes are applied with `drizzle push` (see the `reference-dev-commands` memory for the `.env` export gotcha), never a hand-written migration.
- Tests are Vitest. Pure logic is TDD (test first, watch it fail, implement, watch it pass, commit). UI/codegen/route-wiring tasks are gated by typecheck + the noted manual check, matching the AI-breakdown feature's bar.

---

## File Structure

**New — `@workspace/quick-add` package:**
- `lib/quick-add/package.json` — manifest
- `lib/quick-add/tsconfig.json` — composite TS config
- `lib/quick-add/vitest.config.ts` — node test config
- `lib/quick-add/src/index.ts` — barrel (`parseQuickAdd`, `ParsedQuickAdd`, `Priority`, `resolveHashtag`, `CATEGORY_ALIASES`)
- `lib/quick-add/src/types.ts` — `ParsedQuickAdd`, `Priority`
- `lib/quick-add/src/categories.ts` — `CATEGORY_SLUGS`, `CATEGORY_ALIASES`, `resolveHashtag`
- `lib/quick-add/src/categories.test.ts`
- `lib/quick-add/src/parse.ts` — `parseQuickAdd` grammar
- `lib/quick-add/src/parse.test.ts`

**New — server:**
- `artifacts/api-server/src/lib/task-datetime.ts` — `isValidDueTime`, `isValidDueDate`
- `artifacts/api-server/src/lib/task-datetime.test.ts`
- `artifacts/api-server/src/lib/ai/quick-add-parse.ts` — `buildQuickAddPrompt`, `parseQuickAddResult`, `QuickAddParseError`
- `artifacts/api-server/src/lib/ai/quick-add-parse.test.ts`
- `artifacts/api-server/src/lib/ai/parse-cooldown.ts` — `parseCooldown`

**New — client:**
- `artifacts/focusquest/src/components/quick-add-bar.tsx`

**Modified:**
- `tsconfig.json` (root) — add `lib/quick-add` reference
- `artifacts/api-server/package.json`, `artifacts/focusquest/package.json` — add `@workspace/quick-add` dep
- `lib/db/src/schema/tasks.ts` — add `dueTime` column
- `lib/api-spec/openapi.yaml` — `dueTime` on `Task`/`TaskInput`/`TaskUpdate`; new `/tasks/parse` path + `ParseQuickAddInput`/`ParsedQuickAdd` schemas
- `artifacts/api-server/src/routes/tasks.ts` — `dueTime` in create/patch + `formatTask`; new `POST /tasks/parse`
- `artifacts/focusquest/src/pages/tasks.tsx` — render `<QuickAddBar />`
- `artifacts/focusquest/src/components/task-item.tsx` — display `dueTime`

---

## Task 1: Scaffold `@workspace/quick-add` with the category alias map

**Files:**
- Create: `lib/quick-add/package.json`, `lib/quick-add/tsconfig.json`, `lib/quick-add/vitest.config.ts`
- Create: `lib/quick-add/src/types.ts`, `lib/quick-add/src/categories.ts`, `lib/quick-add/src/index.ts`
- Test: `lib/quick-add/src/categories.test.ts`
- Modify: `tsconfig.json` (root), `artifacts/api-server/package.json`, `artifacts/focusquest/package.json`

**Interfaces:**
- Produces: `type Priority = "low" | "medium" | "high"`; `interface ParsedQuickAdd { title: string; dueDate?: string; dueTime?: string; priority?: Priority; category?: string }`; `resolveHashtag(word: string): string | undefined`; `CATEGORY_ALIASES: Record<string, string>`; `CATEGORY_SLUGS: readonly string[]`.

- [ ] **Step 1: Create the package manifest** — `lib/quick-add/package.json`:

```json
{
  "name": "@workspace/quick-add",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Create `lib/quick-add/tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `lib/quick-add/vitest.config.ts`:**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `lib/quick-add/src/types.ts`:**

```ts
export type Priority = "low" | "medium" | "high";

export interface ParsedQuickAdd {
  /** The task text, with all recognized tokens stripped and whitespace collapsed. */
  title: string;
  /** YYYY-MM-DD in the caller's local calendar, if a date was parsed. */
  dueDate?: string;
  /** HH:mm 24-hour, if a time was parsed. */
  dueTime?: string;
  /** Only set when an explicit `!priority` token was present. */
  priority?: Priority;
  /** Canonical category slug, only when an explicit `#tag` matched. */
  category?: string;
}
```

- [ ] **Step 5: Create `lib/quick-add/src/categories.ts`:**

```ts
// The 9 canonical category slugs (mirrors lib/db and the server's auto-points).
export const CATEGORY_SLUGS = [
  "health", "deep_work", "learning", "finance",
  "admin", "household", "social", "creative", "default",
] as const;

const SLUG_SET = new Set<string>(CATEGORY_SLUGS);

// #tag word (lower-case, no '#') -> canonical slug. Seeded with common synonyms
// so hashtags work without a full tags system. Each canonical slug maps to itself.
export const CATEGORY_ALIASES: Record<string, string> = {
  work: "deep_work", job: "deep_work", office: "deep_work", focus: "deep_work",
  chore: "household", chores: "household", home: "household", house: "household",
  gym: "health", workout: "health", run: "health", fitness: "health",
  money: "finance", bills: "finance", budget: "finance",
  study: "learning", read: "learning", reading: "learning", learn: "learning",
  errand: "admin", errands: "admin", paperwork: "admin",
  friends: "social", family: "social", call: "social",
  art: "creative", draw: "creative", music: "creative",
};

/** Resolve a hashtag word to a canonical category slug, or undefined if unknown. */
export function resolveHashtag(word: string): string | undefined {
  const w = word.toLowerCase();
  if (CATEGORY_ALIASES[w]) return CATEGORY_ALIASES[w];
  if (SLUG_SET.has(w)) return w;
  return undefined;
}
```

- [ ] **Step 6: Create the barrel `lib/quick-add/src/index.ts`:**

```ts
export type { Priority, ParsedQuickAdd } from "./types";
export { CATEGORY_SLUGS, CATEGORY_ALIASES, resolveHashtag } from "./categories";
export { parseQuickAdd } from "./parse";
```

> Note: `./parse` doesn't exist until Task 2. That's fine — this step's typecheck is deferred to Task 2's step where `parse.ts` lands. Do **not** run the package typecheck until Task 2; the `categories.test.ts` below imports only `./categories`, so it runs green now.

- [ ] **Step 7: Write the failing test** — `lib/quick-add/src/categories.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveHashtag } from "./categories";

describe("resolveHashtag", () => {
  it("maps a known synonym to its canonical slug", () => {
    expect(resolveHashtag("work")).toBe("deep_work");
    expect(resolveHashtag("chore")).toBe("household");
    expect(resolveHashtag("gym")).toBe("health");
  });

  it("is case-insensitive", () => {
    expect(resolveHashtag("Work")).toBe("deep_work");
  });

  it("maps a canonical slug to itself", () => {
    expect(resolveHashtag("finance")).toBe("finance");
    expect(resolveHashtag("deep_work")).toBe("deep_work");
  });

  it("returns undefined for an unknown word", () => {
    expect(resolveHashtag("banana")).toBeUndefined();
  });
});
```

- [ ] **Step 8: Wire the package into the workspace.** Add to root `tsconfig.json` `references` array (alongside the existing entries):

```json
    { "path": "./lib/quick-add" }
```

Add `"@workspace/quick-add": "workspace:*"` to the `dependencies` of `artifacts/api-server/package.json` and to the `devDependencies` of `artifacts/focusquest/package.json` (focusquest keeps all deps under `devDependencies` — match that).

- [ ] **Step 9: Install to link the new package.** Run from repo root:

Run: `pnpm install`
Expected: completes; `@workspace/quick-add` is linked into `api-server` and `focusquest` `node_modules`.

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter @workspace/quick-add test`
Expected: PASS (4 assertions in `categories.test.ts`).

- [ ] **Step 11: Commit**

```bash
git add lib/quick-add tsconfig.json artifacts/api-server/package.json artifacts/focusquest/package.json pnpm-lock.yaml
git commit -m "feat(quick-add): scaffold @workspace/quick-add package with category aliases"
```

---

## Task 2: Parse `!priority` and `#tag`, clean the title

**Files:**
- Create: `lib/quick-add/src/parse.ts`
- Test: `lib/quick-add/src/parse.test.ts`

**Interfaces:**
- Consumes: `resolveHashtag` from `./categories`; `ParsedQuickAdd`, `Priority` from `./types`.
- Produces: `parseQuickAdd(input: string, opts: { now: Date }): ParsedQuickAdd`. In this task it fills `title`, `priority`, `category` only; `dueDate`/`dueTime` land in Tasks 3–4.

- [ ] **Step 1: Write the failing test** — `lib/quick-add/src/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseQuickAdd } from "./parse";

const NOW = new Date(2026, 6, 12, 9, 0, 0); // Sun 2026-07-12, 09:00 local

describe("parseQuickAdd — priority", () => {
  it("extracts !high and strips the token", () => {
    const r = parseQuickAdd("Ship the report !high", { now: NOW });
    expect(r.priority).toBe("high");
    expect(r.title).toBe("Ship the report");
  });

  it("accepts short aliases and is case-insensitive", () => {
    expect(parseQuickAdd("x !h", { now: NOW }).priority).toBe("high");
    expect(parseQuickAdd("x !MED", { now: NOW }).priority).toBe("medium");
    expect(parseQuickAdd("x !l", { now: NOW }).priority).toBe("low");
  });

  it("last priority token wins", () => {
    expect(parseQuickAdd("x !low !high", { now: NOW }).priority).toBe("high");
  });

  it("leaves priority undefined and keeps unknown !words in the title", () => {
    const r = parseQuickAdd("email !urgent", { now: NOW });
    expect(r.priority).toBeUndefined();
    expect(r.title).toBe("email !urgent");
  });
});

describe("parseQuickAdd — hashtags", () => {
  it("maps a known #tag to a category and strips it", () => {
    const r = parseQuickAdd("Email Sam #work", { now: NOW });
    expect(r.category).toBe("deep_work");
    expect(r.title).toBe("Email Sam");
  });

  it("strips an unknown #tag and leaves category undefined", () => {
    const r = parseQuickAdd("Email Sam #banana", { now: NOW });
    expect(r.category).toBeUndefined();
    expect(r.title).toBe("Email Sam");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/quick-add exec vitest run src/parse.test.ts`
Expected: FAIL — cannot find module `./parse`.

- [ ] **Step 3: Create `lib/quick-add/src/parse.ts` with priority + hashtag + title logic:**

```ts
import type { ParsedQuickAdd, Priority } from "./types";
import { resolveHashtag } from "./categories";

const PRIORITY_ALIASES: Record<string, Priority> = {
  high: "high", hi: "high", h: "high",
  medium: "medium", med: "medium", m: "medium",
  low: "low", lo: "low", l: "low",
};

interface Field<T> { value?: T; rest: string; }

function extractPriority(text: string): Field<Priority> {
  let value: Priority | undefined;
  const rest = text.replace(/!([a-z]+)/gi, (whole, word: string) => {
    const p = PRIORITY_ALIASES[word.toLowerCase()];
    if (p) { value = p; return " "; } // last match wins
    return whole;                     // unknown !word stays in the title
  });
  return { value, rest };
}

function extractHashtag(text: string): Field<string> {
  let value: string | undefined;
  const rest = text.replace(/#(\w+)/g, (_whole, word: string) => {
    const slug = resolveHashtag(word);
    if (slug) value = slug;           // last known match wins; unknown still stripped
    return " ";
  });
  return { value, rest };
}

function cleanTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseQuickAdd(input: string, opts: { now: Date }): ParsedQuickAdd {
  void opts; // dates/times added in later tasks
  const p = extractPriority(input);
  const h = extractHashtag(p.rest);

  const result: ParsedQuickAdd = { title: cleanTitle(h.rest) };
  if (p.value) result.priority = p.value;
  if (h.value) result.category = h.value;
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/quick-add exec vitest run src/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the package (the barrel now resolves `./parse`)**

Run: `pnpm --filter @workspace/quick-add run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/quick-add/src/parse.ts lib/quick-add/src/parse.test.ts
git commit -m "feat(quick-add): parse !priority and #tag tokens"
```

---

## Task 3: Parse time-of-day

**Files:**
- Modify: `lib/quick-add/src/parse.ts`
- Test: `lib/quick-add/src/parse.test.ts` (add a describe block)

**Interfaces:**
- Produces: `parseQuickAdd` now fills `dueTime` (`HH:mm`) for `3pm`, `3:30pm`, `9am`, `noon`, `midnight`, `15:00`.

- [ ] **Step 1: Add the failing test** — append to `lib/quick-add/src/parse.test.ts`:

```ts
describe("parseQuickAdd — time-of-day", () => {
  it("parses 12-hour times", () => {
    expect(parseQuickAdd("call 3pm", { now: NOW }).dueTime).toBe("15:00");
    expect(parseQuickAdd("call 3:30pm", { now: NOW }).dueTime).toBe("15:30");
    expect(parseQuickAdd("call 9am", { now: NOW }).dueTime).toBe("09:00");
  });

  it("parses noon and midnight", () => {
    expect(parseQuickAdd("call noon", { now: NOW }).dueTime).toBe("12:00");
    expect(parseQuickAdd("call midnight", { now: NOW }).dueTime).toBe("00:00");
  });

  it("handles 12am/12pm correctly", () => {
    expect(parseQuickAdd("call 12pm", { now: NOW }).dueTime).toBe("12:00");
    expect(parseQuickAdd("call 12am", { now: NOW }).dueTime).toBe("00:00");
  });

  it("parses 24-hour times", () => {
    expect(parseQuickAdd("call 15:00", { now: NOW }).dueTime).toBe("15:00");
  });

  it("strips an 'at' prefix and the time token from the title", () => {
    const r = parseQuickAdd("Standup at 9am", { now: NOW });
    expect(r.dueTime).toBe("09:00");
    expect(r.title).toBe("Standup");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/quick-add exec vitest run src/parse.test.ts -t "time-of-day"`
Expected: FAIL — `dueTime` is undefined.

- [ ] **Step 3: Add time extraction to `parse.ts`.** Insert this `pad` helper and `extractTime` function above `parseQuickAdd`:

```ts
function pad(n: number): string { return String(n).padStart(2, "0"); }

function extractTime(text: string): Field<string> {
  let value: string | undefined;
  let rest = text;

  // 12-hour: 3pm, 3:30pm, at 9 am
  rest = rest.replace(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    (whole, h: string, min: string | undefined, ap: string) => {
      let hour = parseInt(h, 10);
      if (hour < 1 || hour > 12) return whole;
      hour = hour % 12;
      if (ap.toLowerCase() === "pm") hour += 12;
      value = `${pad(hour)}:${pad(min ? parseInt(min, 10) : 0)}`;
      return " ";
    });

  // Word times
  if (value === undefined) {
    rest = rest.replace(/\b(noon|midnight)\b/i, (_whole, w: string) => {
      value = w.toLowerCase() === "noon" ? "12:00" : "00:00";
      return " ";
    });
  }

  // 24-hour: 15:00
  if (value === undefined) {
    rest = rest.replace(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/,
      (_whole, h: string, min: string) => {
        value = `${pad(parseInt(h, 10))}:${min}`;
        return " ";
      });
  }

  return { value, rest };
}
```

Then update `parseQuickAdd` to run it (after hashtag extraction):

```ts
export function parseQuickAdd(input: string, opts: { now: Date }): ParsedQuickAdd {
  void opts; // dates added in Task 4
  const p = extractPriority(input);
  const h = extractHashtag(p.rest);
  const t = extractTime(h.rest);

  const result: ParsedQuickAdd = { title: cleanTitle(t.rest) };
  if (t.value) result.dueTime = t.value;
  if (p.value) result.priority = p.value;
  if (h.value) result.category = h.value;
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/quick-add exec vitest run src/parse.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/quick-add/src/parse.ts lib/quick-add/src/parse.test.ts
git commit -m "feat(quick-add): parse time-of-day into dueTime"
```

---

## Task 4: Parse dates + combined/order-independence

**Files:**
- Modify: `lib/quick-add/src/parse.ts`
- Test: `lib/quick-add/src/parse.test.ts` (add describe blocks)

**Interfaces:**
- Produces: `parseQuickAdd` now fills `dueDate` for ISO, `M/D[/Y]`, `Mon D`/`D Mon`, `in N days/weeks`, `today`/`tonight`/`tomorrow`/`tmr`/`tmrw`, and weekdays (`next` supported). Fully composed with priority/hashtag/time, order-independent.

- [ ] **Step 1: Add the failing tests** — append to `lib/quick-add/src/parse.test.ts` (NOW is Sun 2026-07-12):

```ts
describe("parseQuickAdd — dates", () => {
  it("parses relative words", () => {
    expect(parseQuickAdd("x today", { now: NOW }).dueDate).toBe("2026-07-12");
    expect(parseQuickAdd("x tonight", { now: NOW }).dueDate).toBe("2026-07-12");
    expect(parseQuickAdd("x tomorrow", { now: NOW }).dueDate).toBe("2026-07-13");
    expect(parseQuickAdd("x tmr", { now: NOW }).dueDate).toBe("2026-07-13");
  });

  it("parses 'in N days' and 'in N weeks'", () => {
    expect(parseQuickAdd("x in 3 days", { now: NOW }).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x in 2 weeks", { now: NOW }).dueDate).toBe("2026-07-26");
  });

  it("parses weekdays (today excluded) and 'next'", () => {
    expect(parseQuickAdd("x mon", { now: NOW }).dueDate).toBe("2026-07-13");
    expect(parseQuickAdd("x friday", { now: NOW }).dueDate).toBe("2026-07-17");
    expect(parseQuickAdd("x sun", { now: NOW }).dueDate).toBe("2026-07-19");
    expect(parseQuickAdd("x next mon", { now: NOW }).dueDate).toBe("2026-07-20");
  });

  it("parses numeric M/D, defaulting to the next future year", () => {
    expect(parseQuickAdd("x 7/15", { now: NOW }).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x 7/10", { now: NOW }).dueDate).toBe("2027-07-10");
    expect(parseQuickAdd("x 12/25/2026", { now: NOW }).dueDate).toBe("2026-12-25");
  });

  it("parses ISO and month-name dates", () => {
    expect(parseQuickAdd("x 2026-12-01", { now: NOW }).dueDate).toBe("2026-12-01");
    expect(parseQuickAdd("x jul 15", { now: NOW }).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x 15 jul", { now: NOW }).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x dec 25", { now: NOW }).dueDate).toBe("2026-12-25");
  });

  it("treats impossible dates/times as ordinary title text", () => {
    const r = parseQuickAdd("meet feb 30", { now: NOW });
    expect(r.dueDate).toBeUndefined();
    expect(r.title).toBe("meet feb 30");
    expect(parseQuickAdd("x 25:00", { now: NOW }).dueTime).toBeUndefined();
  });
});

describe("parseQuickAdd — full line, order independent", () => {
  it("parses the canonical example", () => {
    const r = parseQuickAdd("Email Sam re: budget tomorrow 3pm #work !high", { now: NOW });
    expect(r).toEqual({
      title: "Email Sam re: budget",
      dueDate: "2026-07-13",
      dueTime: "15:00",
      priority: "high",
      category: "deep_work",
    });
  });

  it("does not depend on token order", () => {
    const r = parseQuickAdd("!high #work 3pm tomorrow Email Sam re: budget", { now: NOW });
    expect(r.dueDate).toBe("2026-07-13");
    expect(r.dueTime).toBe("15:00");
    expect(r.priority).toBe("high");
    expect(r.category).toBe("deep_work");
    expect(r.title).toBe("Email Sam re: budget");
  });

  it("returns an empty title when the line is only tokens", () => {
    expect(parseQuickAdd("tomorrow 3pm !high", { now: NOW }).title).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/quick-add exec vitest run src/parse.test.ts -t "dates"`
Expected: FAIL — `dueDate` undefined.

- [ ] **Step 3: Add date extraction to `parse.ts`.** Add these helpers and `extractDate` above `parseQuickAdd`:

```ts
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function ymd(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function atMidnight(now: Date): Date { return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
function addDays(base: Date, n: number): Date { const r = new Date(base); r.setDate(r.getDate() + n); return r; }
function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
// For M/D and month-name with no year: this year, or next year if already past.
function futureYear(base: Date, m: number, d: number): number {
  const y = base.getFullYear();
  return isRealDate(y, m, d) && new Date(y, m - 1, d) < base ? y + 1 : y;
}

function extractDate(text: string, now: Date): Field<string> {
  let value: string | undefined;
  let rest = text;
  const base = atMidnight(now);
  const set = (d: string) => { value = d; return " "; };

  // ISO YYYY-MM-DD
  rest = rest.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/, (whole, y, mo, d) =>
    isRealDate(+y, +mo, +d) ? set(ymd(new Date(+y, +mo - 1, +d))) : whole);

  // Numeric M/D or M/D/Y
  if (value === undefined) {
    rest = rest.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (whole, mo, d, y) => {
      const M = +mo, D = +d;
      const Y = y ? (+y < 100 ? 2000 + +y : +y) : futureYear(base, M, D);
      return isRealDate(Y, M, D) ? set(ymd(new Date(Y, M - 1, D))) : whole;
    });
  }

  // Month name before day: "Jul 15"
  if (value === undefined) {
    rest = rest.replace(/\b([a-z]{3,9})\s+(\d{1,2})\b/i, (whole, mon, d) => {
      const M = MONTHS[mon.slice(0, 3).toLowerCase()];
      if (!M) return whole;
      const D = +d, Y = futureYear(base, M, D);
      return isRealDate(Y, M, D) ? set(ymd(new Date(Y, M - 1, D))) : whole;
    });
  }
  // Day before month name: "15 Jul"
  if (value === undefined) {
    rest = rest.replace(/\b(\d{1,2})\s+([a-z]{3,9})\b/i, (whole, d, mon) => {
      const M = MONTHS[mon.slice(0, 3).toLowerCase()];
      if (!M) return whole;
      const D = +d, Y = futureYear(base, M, D);
      return isRealDate(Y, M, D) ? set(ymd(new Date(Y, M - 1, D))) : whole;
    });
  }

  // in N days / in N weeks
  if (value === undefined) {
    rest = rest.replace(/\bin\s+(\d+)\s+(days?|weeks?)\b/i, (_whole, n, unit) =>
      set(ymd(addDays(base, +n * (unit.toLowerCase().startsWith("week") ? 7 : 1)))));
  }

  // Relative words
  if (value === undefined) {
    rest = rest.replace(/\b(today|tonight|tomorrow|tmr|tmrw)\b/i, (_whole, w) => {
      const lw = w.toLowerCase();
      const n = lw === "tomorrow" || lw === "tmr" || lw === "tmrw" ? 1 : 0;
      return set(ymd(addDays(base, n)));
    });
  }

  // Weekday, optionally "next"
  if (value === undefined) {
    rest = rest.replace(
      /\b(next\s+)?(sunday|sun|saturday|sat|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri)\b/i,
      (_whole, next, name) => {
        const target = WEEKDAYS[name.toLowerCase()];
        let delta = (target - base.getDay() + 7) % 7;
        if (delta === 0) delta = 7; // bare weekday excludes today
        if (next) delta += 7;       // "next <weekday>" = the following week
        return set(ymd(addDays(base, delta)));
      });
  }

  return { value, rest };
}
```

Then update `parseQuickAdd` to run date extraction **before** time extraction and use `opts.now`:

```ts
export function parseQuickAdd(input: string, opts: { now: Date }): ParsedQuickAdd {
  const p = extractPriority(input);
  const h = extractHashtag(p.rest);
  const d = extractDate(h.rest, opts.now);
  const t = extractTime(d.rest);

  const result: ParsedQuickAdd = { title: cleanTitle(t.rest) };
  if (d.value) result.dueDate = d.value;
  if (t.value) result.dueTime = t.value;
  if (p.value) result.priority = p.value;
  if (h.value) result.category = h.value;
  return result;
}
```

- [ ] **Step 4: Run the full test file to verify it passes**

Run: `pnpm --filter @workspace/quick-add test`
Expected: PASS — every describe block including the canonical example and order-independence.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/quick-add run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/quick-add/src/parse.ts lib/quick-add/src/parse.test.ts
git commit -m "feat(quick-add): parse dates and compose the full grammar"
```

---

## Task 5: Add the `dueTime` column to the tasks table

**Files:**
- Modify: `lib/db/src/schema/tasks.ts:27` (near `estimatedMinutes`)

**Interfaces:**
- Produces: `tasksTable.dueTime` (nullable `text`); `InsertTask` gains optional `dueTime`; `Task` type gains `dueTime: string | null`.

- [ ] **Step 1: Add the column.** In `lib/db/src/schema/tasks.ts`, add a `dueTime` line next to `dueDate` (after line 35 `dueDate: text("due_date").notNull(),`):

```ts
  dueDate: text("due_date").notNull(),
  dueTime: text("due_time"),
```

(Leave `insertTaskSchema` as-is — `createInsertSchema` picks up the new nullable column automatically as optional.)

- [ ] **Step 2: Typecheck the db package**

Run: `pnpm run typecheck:libs`
Expected: no errors.

- [ ] **Step 3: Push the schema to the database.** Load env then push (see `reference-dev-commands` for the `.env` export gotcha):

Run:
```bash
set -a; . ./.env; set +a
pnpm --filter @workspace/db run push
```
Expected: drizzle-kit reports adding the `due_time` column to `tasks` and applies it.

- [ ] **Step 4: Commit**

```bash
git add lib/db/src/schema/tasks.ts
git commit -m "feat(db): add nullable tasks.dueTime column"
```

---

## Task 6: Add `dueTime` + `/tasks/parse` to the OpenAPI spec and regenerate

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Generated (do not hand-edit): `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`

**Interfaces:**
- Produces: `dueTime` on the generated `Task`, `TaskInput`, `TaskUpdate` types; a `useParseQuickAdd` react-query hook; `ParseQuickAddInput` (`{ text: string }`) and `ParsedQuickAdd` response types.

- [ ] **Step 1: Add `dueTime` to the `Task` schema.** In `openapi.yaml`, inside `Task.properties` (after `focusDate`, before `steps`, around line 1427), add:

```yaml
        dueTime:
          type: ["string", "null"]
          description: Optional time of day (HH:mm, 24-hour)
```

- [ ] **Step 2: Add `dueTime` to `TaskInput.properties`** (after `category`, around line 1489):

```yaml
        dueTime:
          type: string
          pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"
          description: Optional time of day (HH:mm, 24-hour)
```

- [ ] **Step 3: Add `dueTime` to `TaskUpdate.properties`** (after `category`, around line 1520 — match the same block):

```yaml
        dueTime:
          type: string
          pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"
          description: Optional time of day (HH:mm, 24-hour)
```

- [ ] **Step 4: Add the `/tasks/parse` path.** Insert immediately after the `/tasks:` block closes and before `/tasks/{id}:` (around line 354):

```yaml
  /tasks/parse:
    post:
      operationId: parseQuickAdd
      tags: [tasks]
      summary: Parse a natural-language quick-add line into structured task fields
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ParseQuickAddInput"
      responses:
        "200":
          description: Parsed fields (does not create a task)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ParsedQuickAdd"
        "429":
          description: Cooldown — too many parse requests
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
          description: AI parse not configured
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

- [ ] **Step 5: Add the two schemas.** In `components.schemas` (next to `TaskInput`, around line 1461), add:

```yaml
    ParseQuickAddInput:
      type: object
      required: [text]
      properties:
        text:
          type: string
          minLength: 1

    ParsedQuickAdd:
      type: object
      required: [title]
      properties:
        title:
          type: string
        dueDate:
          type: ["string", "null"]
        dueTime:
          type: ["string", "null"]
        priority:
          type: ["string", "null"]
          enum: [low, medium, high, null]
        category:
          type: ["string", "null"]
          enum: [health, deep_work, learning, finance, admin, household, social, creative, null]
```

- [ ] **Step 6: Regenerate the client + zod.**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: orval rewrites `lib/api-client-react/src/generated` and `lib/api-zod/src/generated`, then `typecheck:libs` runs clean. Confirm a `useParseQuickAdd` hook exists:

Run: `grep -rl "useParseQuickAdd" lib/api-client-react/src/generated`
Expected: at least one file matches.

- [ ] **Step 7: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): add dueTime and /tasks/parse; regenerate client"
```

---

## Task 7: Persist and validate `dueTime` on create/patch

**Files:**
- Create: `artifacts/api-server/src/lib/task-datetime.ts`
- Test: `artifacts/api-server/src/lib/task-datetime.test.ts`
- Modify: `artifacts/api-server/src/routes/tasks.ts` (`formatTask`, `POST /tasks`, `PATCH /tasks/:id`)

**Interfaces:**
- Produces: `isValidDueTime(v: unknown): v is string`; `isValidDueDate(v: unknown): v is string`. `formatTask` output gains `dueTime: string | null`. `POST /tasks` and `PATCH /tasks/:id` accept and persist `dueTime`.

- [ ] **Step 1: Write the failing test** — `artifacts/api-server/src/lib/task-datetime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidDueTime, isValidDueDate } from "./task-datetime";

describe("isValidDueTime", () => {
  it("accepts HH:mm in range", () => {
    expect(isValidDueTime("00:00")).toBe(true);
    expect(isValidDueTime("15:30")).toBe(true);
    expect(isValidDueTime("23:59")).toBe(true);
  });
  it("rejects malformed or out-of-range values", () => {
    expect(isValidDueTime("24:00")).toBe(false);
    expect(isValidDueTime("3:00")).toBe(false);   // needs two-digit hour
    expect(isValidDueTime("15:60")).toBe(false);
    expect(isValidDueTime("")).toBe(false);
    expect(isValidDueTime(1500)).toBe(false);
  });
});

describe("isValidDueDate", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    expect(isValidDueDate("2026-07-15")).toBe(true);
  });
  it("rejects impossible or malformed dates", () => {
    expect(isValidDueDate("2026-02-30")).toBe(false);
    expect(isValidDueDate("2026-7-5")).toBe(false);
    expect(isValidDueDate("nope")).toBe(false);
    expect(isValidDueDate(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/task-datetime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `artifacts/api-server/src/lib/task-datetime.ts`:**

```ts
export function isValidDueTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const h = Number(m[1]), min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

export function isValidDueDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/task-datetime.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `dueTime` into the routes.** In `artifacts/api-server/src/routes/tasks.ts`:

Add the import near the other `../lib/...` imports (after line 13):

```ts
import { isValidDueTime } from "../lib/task-datetime";
```

In `formatTask` (after the `dueDate: task.dueDate,` line, ~line 32) add:

```ts
    dueTime: task.dueTime ?? null,
```

In `POST /tasks`, extend the destructure and validation. Replace the body destructure (lines 222–229) and insert with:

```ts
  const { title, description, dueDate, dueTime, priority = "medium", estimatedMinutes, category } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    category?: string;
  };

  if (!title || !dueDate) {
    res.status(400).json({ error: "title and dueDate are required" });
    return;
  }
  if (dueTime !== undefined && dueTime !== null && !isValidDueTime(dueTime)) {
    res.status(400).json({ error: "dueTime must be HH:mm (24-hour)" });
    return;
  }
```

and add `dueTime: dueTime ?? null,` to the `db.insert(tasksTable).values({ ... })` object (next to `estimatedMinutes`).

In `PATCH /tasks/:id`, add `dueTime` to the destructure (~line 285) and, in the incomplete-task branch (after the `dueDate` line, ~line 315), add:

```ts
  if (dueTime !== undefined) {
    if (dueTime !== null && !isValidDueTime(dueTime)) {
      res.status(400).json({ error: "dueTime must be HH:mm (24-hour)" });
      return;
    }
    updates.dueTime = dueTime;
  }
```

(Add `dueTime?: string;` to that handler's body type.)

- [ ] **Step 6: Typecheck + run the server test suite**

Run: `pnpm --filter @workspace/api-server run typecheck && pnpm --filter @workspace/api-server test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/task-datetime.ts artifacts/api-server/src/lib/task-datetime.test.ts artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): validate and persist task dueTime on create/patch"
```

---

## Task 8: AI quick-add prompt + result normalizer + cooldown

**Files:**
- Create: `artifacts/api-server/src/lib/ai/quick-add-parse.ts`
- Test: `artifacts/api-server/src/lib/ai/quick-add-parse.test.ts`
- Create: `artifacts/api-server/src/lib/ai/parse-cooldown.ts`

**Interfaces:**
- Consumes: `VALID_CATEGORIES` from `../auto-points`; `isValidDueDate`, `isValidDueTime` from `../task-datetime`; `ParsedQuickAdd` from `@workspace/quick-add`; `createCooldown` from `./breakdown-cooldown`.
- Produces: `buildQuickAddPrompt(text: string, opts: { now: Date }): string`; `parseQuickAddResult(raw: unknown, fallback: { text: string }): ParsedQuickAdd`; `QuickAddParseError`; `parseCooldown` (a `Cooldown`).

- [ ] **Step 1: Write the failing test** — `artifacts/api-server/src/lib/ai/quick-add-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildQuickAddPrompt, parseQuickAddResult, QuickAddParseError } from "./quick-add-parse";

const NOW = new Date(2026, 6, 12, 9, 0, 0);

describe("buildQuickAddPrompt", () => {
  it("includes the raw text and today's date", () => {
    const p = buildQuickAddPrompt("ping landlord next week", { now: NOW });
    expect(p).toContain("ping landlord next week");
    expect(p).toContain("2026-07-12");
  });
});

describe("parseQuickAddResult", () => {
  it("keeps valid fields", () => {
    const r = parseQuickAddResult(
      { title: "Ping landlord", dueDate: "2026-07-20", dueTime: "09:00", priority: "high", category: "admin" },
      { text: "ping landlord next week" },
    );
    expect(r).toEqual({
      title: "Ping landlord",
      dueDate: "2026-07-20",
      dueTime: "09:00",
      priority: "high",
      category: "admin",
    });
  });

  it("drops invalid date/time/priority/category and keeps the title", () => {
    const r = parseQuickAddResult(
      { title: "Do thing", dueDate: "2026-02-30", dueTime: "99:99", priority: "urgent", category: "work" },
      { text: "do thing" },
    );
    expect(r).toEqual({ title: "Do thing" });
  });

  it("falls back to the raw text when title is missing", () => {
    const r = parseQuickAddResult({ dueDate: "2026-07-20" }, { text: "  buy milk  " });
    expect(r.title).toBe("buy milk");
    expect(r.dueDate).toBe("2026-07-20");
  });

  it("throws on non-object model output", () => {
    expect(() => parseQuickAddResult("nope", { text: "x" })).toThrow(QuickAddParseError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/ai/quick-add-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `artifacts/api-server/src/lib/ai/quick-add-parse.ts`:**

```ts
import type { ParsedQuickAdd } from "@workspace/quick-add";
import { VALID_CATEGORIES } from "../auto-points";
import { isValidDueDate, isValidDueTime } from "../task-datetime";

const PRIORITIES = new Set(["low", "medium", "high"]);

export class QuickAddParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickAddParseError";
  }
}

function isoDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildQuickAddPrompt(text: string, opts: { now: Date }): string {
  const today = isoDate(opts.now);
  const weekday = WEEKDAY_NAMES[opts.now.getDay()];
  return `You convert one line of natural language into a structured to-do task.
Today is ${today} (${weekday}) in the user's local time. Resolve relative phrases like "next week" or "friday" against that.

The user's line:
"${text}"

Extract these fields, omitting any you cannot confidently determine:
- title: the task itself, with date/time/hashtag/priority words removed
- dueDate: YYYY-MM-DD, if any date is implied
- dueTime: HH:mm 24-hour, if a time of day is implied
- priority: one of low, medium, high, if implied
- category: one of health, deep_work, learning, finance, admin, household, social, creative, if clear

Respond with JSON only, no prose, in exactly this shape:
{"title": "...", "dueDate": "...", "dueTime": "...", "priority": "...", "category": "..."}`;
}

export function parseQuickAddResult(raw: unknown, fallback: { text: string }): ParsedQuickAdd {
  if (!raw || typeof raw !== "object") {
    throw new QuickAddParseError("Model output was not a JSON object");
  }
  const o = raw as Record<string, unknown>;

  const title =
    typeof o.title === "string" && o.title.trim() ? o.title.trim() : fallback.text.trim();
  const result: ParsedQuickAdd = { title };

  if (typeof o.dueDate === "string" && isValidDueDate(o.dueDate)) result.dueDate = o.dueDate;
  if (typeof o.dueTime === "string" && isValidDueTime(o.dueTime)) result.dueTime = o.dueTime;
  if (typeof o.priority === "string" && PRIORITIES.has(o.priority)) {
    result.priority = o.priority as ParsedQuickAdd["priority"];
  }
  if (typeof o.category === "string" && VALID_CATEGORIES.has(o.category) && o.category !== "default") {
    result.category = o.category;
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/ai/quick-add-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the cooldown** — `artifacts/api-server/src/lib/ai/parse-cooldown.ts`:

```ts
import { createCooldown } from "./breakdown-cooldown";

export const PARSE_COOLDOWN_MS = 3000;
export const parseCooldown = createCooldown(PARSE_COOLDOWN_MS);
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/ai/quick-add-parse.ts artifacts/api-server/src/lib/ai/quick-add-parse.test.ts artifacts/api-server/src/lib/ai/parse-cooldown.ts
git commit -m "feat(api): add quick-add AI prompt, result normalizer, and cooldown"
```

---

## Task 9: The `POST /tasks/parse` route

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts`

**Interfaces:**
- Consumes: `parseQuickAdd` from `@workspace/quick-add`; `buildQuickAddPrompt`, `parseQuickAddResult`, `QuickAddParseError`; `parseCooldown`; existing `generateJson`, `isAiConfigured`, `AiClientError`, `logger`.
- Produces: `POST /api/tasks/parse` returning a `ParsedQuickAdd`.

- [ ] **Step 1: Add imports** to `artifacts/api-server/src/routes/tasks.ts` (after the existing AI imports, ~line 13):

```ts
import { parseQuickAdd } from "@workspace/quick-add";
import { buildQuickAddPrompt, parseQuickAddResult, QuickAddParseError } from "../lib/ai/quick-add-parse";
import { parseCooldown } from "../lib/ai/parse-cooldown";
```

- [ ] **Step 2: Add the route.** Place it right after the `router.post("/tasks", ...)` handler ends (~line 251), so it's registered before `/tasks/:id`:

```ts
router.post("/tasks/parse", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) { res.status(400).json({ error: "text is required" }); return; }

  const now = new Date();
  const deterministic = parseQuickAdd(text, { now });

  // Deterministic path was enough — no LLM call needed.
  if (deterministic.dueDate || deterministic.dueTime) {
    res.json(deterministic);
    return;
  }

  if (!isAiConfigured()) {
    res.status(503).json({ error: "AI parse is not configured" });
    return;
  }
  if (!parseCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment before parsing again." });
    return;
  }

  let aiParsed;
  try {
    const rawJson = await generateJson(buildQuickAddPrompt(text, { now }));
    aiParsed = parseQuickAddResult(rawJson, { text });
  } catch (err) {
    if (err instanceof AiClientError || err instanceof QuickAddParseError) {
      logger.warn({ err }, "quick-add parse generation failed");
      res.status(502).json({ error: "Couldn't smart-parse, edit manually." });
      return;
    }
    throw err;
  }

  // Deterministic fields win on merge (title, priority, category from explicit tokens).
  const merged = { ...aiParsed };
  if (deterministic.title) merged.title = deterministic.title;
  if (deterministic.priority) merged.priority = deterministic.priority;
  if (deterministic.category) merged.category = deterministic.category;
  res.json(merged);
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: no errors.

- [ ] **Step 4: Manually verify the endpoint end-to-end.** Start the server (`pnpm --filter @workspace/api-server run dev`) with `GROQ_API_KEY` set and an authenticated session, then:

Run:
```bash
# deterministic short-circuit (no Groq call): returns dueDate/dueTime
curl -s -X POST localhost:$PORT/api/tasks/parse -H 'content-type: application/json' \
  -b "$COOKIE" -d '{"text":"Email Sam tomorrow 3pm #work !high"}'
# LLM fallback: no explicit date token
curl -s -X POST localhost:$PORT/api/tasks/parse -H 'content-type: application/json' \
  -b "$COOKIE" -d '{"text":"ping the landlord about the leak sometime next week"}'
```
Expected: first returns `{title:"Email Sam", dueDate:"<tomorrow>", dueTime:"15:00", priority:"high", category:"deep_work"}`; second returns a title plus an LLM-resolved `dueDate`. With `GROQ_API_KEY` unset, the second returns `503`.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): add POST /tasks/parse with deterministic short-circuit and Groq fallback"
```

---

## Task 10: The `QuickAddBar` component + Quest Log integration

**Files:**
- Create: `artifacts/focusquest/src/components/quick-add-bar.tsx`
- Modify: `artifacts/focusquest/src/pages/tasks.tsx`

**Interfaces:**
- Consumes: `parseQuickAdd` from `@workspace/quick-add`; `useCreateTask`, `useParseQuickAdd`, `getGetTasksQueryKey` from `@workspace/api-client-react`; `CATEGORY_HEX_COLORS`, `CATEGORY_LABEL` from `@/lib/categories`; `useToast`; `format` from `date-fns`.
- Produces: `<QuickAddBar selectedDate={Date | undefined} />` rendered on the Quest Log.

- [ ] **Step 1: Create `artifacts/focusquest/src/components/quick-add-bar.tsx`:**

```tsx
import { useMemo, useState, useEffect } from "react";
import { format } from "date-fns";
import { Sparkles, CalendarClock, Zap, Plus, RefreshCw } from "lucide-react";
import { parseQuickAdd, type ParsedQuickAdd } from "@workspace/quick-add";
import { useCreateTask, useParseQuickAdd, getGetTasksQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CATEGORY_HEX_COLORS, CATEGORY_LABEL } from "@/lib/categories";

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return format(new Date(y, m - 1, d), "EEE MMM d");
}

export function QuickAddBar({ selectedDate }: { selectedDate: Date | undefined }) {
  const [text, setText] = useState("");
  const [aiFields, setAiFields] = useState<ParsedQuickAdd | null>(null);
  const [xp, setXp] = useState<number | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateTask();
  const parseMutation = useParseQuickAdd();

  // Deterministic parse runs live on every keystroke; AI result (if any) overrides it.
  const parsed = useMemo<ParsedQuickAdd>(() => {
    const det = parseQuickAdd(text, { now: new Date() });
    return aiFields ? { ...det, ...aiFields, title: det.title || aiFields.title } : det;
  }, [text, aiFields]);

  // Reset any AI result once the user edits the line again.
  useEffect(() => { setAiFields(null); }, [text]);

  // Reuse the existing points/category endpoint for the XP + auto-category chip.
  useEffect(() => {
    if (!parsed.title.trim()) { setXp(null); return; }
    const t = setTimeout(() => {
      fetch(`/api/tasks/suggest-points?title=${encodeURIComponent(parsed.title)}&priority=${parsed.priority ?? "medium"}`)
        .then((r) => r.json())
        .then((d: { points: number }) => setXp(d.points))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [parsed.title, parsed.priority]);

  const canCreate = parsed.title.trim().length > 0 && !createMutation.isPending;
  const showSmartParse = parsed.title.trim().length > 0 && !parsed.dueDate && !parsed.dueTime;

  const handleCreate = () => {
    if (!canCreate) return;
    const dueDate = parsed.dueDate ?? format(selectedDate ?? new Date(), "yyyy-MM-dd");
    createMutation.mutate({
      data: {
        title: parsed.title,
        dueDate,
        priority: (parsed.priority ?? "medium") as any,
        ...(parsed.dueTime ? { dueTime: parsed.dueTime } : {}),
        ...(parsed.category ? { category: parsed.category as any } : {}),
      },
    }, {
      onSuccess: (task) => {
        toast({ title: `Quest added — ${task.points} XP`, className: "border-primary bg-primary/10" });
        setText("");
        setAiFields(null);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      },
      onError: () => toast({ title: "Couldn't add that quest", variant: "destructive" }),
    });
  };

  const handleSmartParse = () => {
    parseMutation.mutate({ data: { text } }, {
      onSuccess: (result) => setAiFields(result),
      onError: (err: any) => {
        const status = err?.status;
        const msg =
          status === 503 ? "Smart parse isn't set up yet."
          : status === 429 ? "Give it a moment and try again."
          : "Couldn't smart-parse — edit the line manually.";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };

  return (
    <div className="bg-card border border-primary/30 rounded-xl p-3 space-y-2 shadow-[0_0_15px_rgba(0,255,255,0.06)]">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
          placeholder="Quick add — e.g. Email Sam tomorrow 3pm #work !high"
          aria-label="Quick add a quest in natural language"
          className="border-primary/20 focus:border-primary"
          autoFocus
        />
        <Button onClick={handleCreate} disabled={!canCreate} className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0">
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>

      {parsed.title.trim() && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {parsed.dueDate && (
            <span aria-label="Due date" className="px-2 py-0.5 rounded-full border border-border bg-muted/40 flex items-center gap-1">
              <CalendarClock className="w-3 h-3" />
              {dateLabel(parsed.dueDate)}{parsed.dueTime ? ` · ${to12h(parsed.dueTime)}` : ""}
            </span>
          )}
          {!parsed.dueDate && parsed.dueTime && (
            <span aria-label="Due time" className="px-2 py-0.5 rounded-full border border-border bg-muted/40 flex items-center gap-1">
              <CalendarClock className="w-3 h-3" /> {to12h(parsed.dueTime)}
            </span>
          )}
          {parsed.priority && (
            <span aria-label="Priority" className="px-2 py-0.5 rounded-full border border-border bg-muted/40 capitalize">
              {parsed.priority} priority
            </span>
          )}
          {parsed.category && (
            <span aria-label="Category" className="px-2 py-0.5 rounded-full border" style={{ color: CATEGORY_HEX_COLORS[parsed.category], borderColor: `${CATEGORY_HEX_COLORS[parsed.category]}55` }}>
              {CATEGORY_LABEL[parsed.category] ?? parsed.category}
            </span>
          )}
          {xp !== null && (
            <span aria-label="Experience points" className="px-2 py-0.5 rounded-full border border-primary/30 text-primary flex items-center gap-1">
              <Zap className="w-3 h-3" /> {xp} XP
            </span>
          )}
          {showSmartParse && (
            <Button variant="ghost" size="sm" onClick={handleSmartParse} disabled={parseMutation.isPending} className="h-6 px-2 text-xs text-muted-foreground hover:text-primary gap-1">
              {parseMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Smart parse
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render it on the Quest Log.** In `artifacts/focusquest/src/pages/tasks.tsx`, add the import near the other component imports (after line 5):

```tsx
import { QuickAddBar } from "@/components/quick-add-bar";
```

Then render it directly under the page header block. Insert immediately after the header `</div>` that closes at line 380 (right before the `{/* Recommendation card */}` comment):

```tsx
      <QuickAddBar selectedDate={date} />

```

- [ ] **Step 3: Typecheck the app**

Run: `pnpm --filter @workspace/focusquest run typecheck`
Expected: no errors (confirms the generated `useParseQuickAdd` hook and `dueTime` field resolve).

- [ ] **Step 4: Manually verify in the browser.** Start the app (`pnpm --filter @workspace/focusquest run dev`), open the Quest Log, and type `Email Sam re: budget tomorrow 3pm #work !high`. Confirm the chip row shows the date+time, High priority, Deep Work, and an XP value; press Enter and confirm the quest appears in the list and the input clears. Then type `ping landlord next week`, confirm **Smart parse** appears, click it, and confirm a date chip fills in.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/quick-add-bar.tsx artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(focusquest): add natural-language quick-add bar to the Quest Log"
```

---

## Task 11: Show `dueTime` on the task card

**Files:**
- Modify: `artifacts/focusquest/src/components/task-item.tsx:234`

**Interfaces:**
- Consumes: `task.dueTime` (from the regenerated `Task` type, Task 6).

- [ ] **Step 1: Render the time next to the due date.** In `artifacts/focusquest/src/components/task-item.tsx`, replace the due-date span (line 234):

```tsx
            <span>{format(new Date(task.dueDate), 'MMM d, yyyy')}</span>
```

with:

```tsx
            <span>
              {format(new Date(task.dueDate), 'MMM d, yyyy')}
              {task.dueTime ? ` · ${(() => {
                const [h, m] = task.dueTime.split(":").map(Number);
                const ap = h < 12 ? "AM" : "PM";
                const h12 = h % 12 === 0 ? 12 : h % 12;
                return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
              })()}` : ""}
            </span>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/focusquest run typecheck`
Expected: no errors.

- [ ] **Step 3: Manually verify.** In the running app, a quest created with a time (e.g. via the quick-add bar with `3pm`) shows `... · 3:00 PM` on its card; a quest with no time shows only the date.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/components/task-item.tsx
git commit -m "feat(focusquest): show dueTime on the quest card"
```

---

## Final verification

- [ ] **Full typecheck:** `pnpm run typecheck` — no errors across libs and apps.
- [ ] **All unit tests:** `pnpm --filter @workspace/quick-add test && pnpm --filter @workspace/api-server test` — green.
- [ ] **End-to-end smoke:** with the app + server running and `GROQ_API_KEY` set, capture the canonical line, confirm the created quest has the right date/time/priority/category and XP, and confirm Smart parse resolves a fuzzy date. Then unset `GROQ_API_KEY`, restart the server, and confirm deterministic quick-add still works and Smart parse surfaces the "isn't set up" toast (503).

---

## Self-Review notes

- **Spec coverage:** hybrid parser (Tasks 2–4 deterministic, Tasks 8–9 LLM fallback); on-demand button (Task 10 `showSmartParse`); `dueTime` column + validation + display (Tasks 5, 7, 11); `#tag`→category alias with unknown-tag fallback (Tasks 1–2); pinned quick-add bar with live chip preview reusing suggest-points (Task 10); `/parse` deterministic short-circuit (Task 9); no new env vars (Task 8/9 reuse Groq); single-path creation via `POST /tasks` (Task 10). Every spec section maps to a task.
- **Type consistency:** `ParsedQuickAdd`/`Priority` defined once in `lib/quick-add/src/types.ts` and imported everywhere (server normalizer, component). `isValidDueTime`/`isValidDueDate` defined in Task 7, reused in Task 8. `parseQuickAdd(input, { now })` signature identical across client and server callers.
- **Deferred (out of scope, per spec):** real free-form tags, `dueTime`→notification wiring, global Cmd-K capture, recurring syntax, automatic LLM parsing.
