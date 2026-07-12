# Auto-Category Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broaden and sharpen the backend auto-categorization engine — add 3 new categories (self_care, errands, travel), fix substring false-positives via leading word-boundary matching, and grow the `#hashtag` alias list.

**Architecture:** `assignPoints(title, priority)` in `artifacts/api-server/src/lib/auto-points.ts` is the single source of truth for a task's auto-category and base points. We replace its substring matcher with a leading-word-boundary regex, rewrite the `RULES` list (moves + additions + reorderings), add labels/colors in the frontend, extend the quick-add hashtag aliases, and add the new slugs to the OpenAPI enums (regenerating `api-zod` + `api-client-react`). No DB migration — `category` is a free-text column.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Drizzle (Postgres/Neon), Orval (OpenAPI codegen), React (focusquest).

## Global Constraints

- pnpm monorepo. Run package scripts with `pnpm --filter <pkg> <script>`.
- **Never hand-edit** files under any `*/src/generated` directory — they come from Orval codegen (`pnpm --filter @workspace/api-spec codegen`).
- **No DB migration** — `tasks.category` / `recurring_tasks.category` are `text` columns (default `"default"`).
- **Preserve every existing rule's `basePoints`** unless this plan explicitly changes it.
- **Matcher:** leading word boundary (`\bkeyword`), suffix open — must keep stems (`meditat`→meditation) working while rejecting mid-word matches (`brunch`, `party`, `workshop`, `bread`).
- **Starter-quests invariant:** the four seed titles must keep mapping to four distinct categories — `Take a 10-minute walk`→health, `Read for 15 minutes`→learning, `Tidy up your desk`→household, `Plan your top 3 tasks for today`→deep_work.
- **Rule order matters** (first match wins). Category block order is fixed as: health, self_care, travel, deep_work, learning, finance, errands, admin, household, social, creative. (Travel precedes deep_work so `plan a trip`/`book flight`→travel; finance precedes errands so `tax return`→finance while `return package`→errands.)
- The 3 new slugs, verbatim: `self_care`, `errands`, `travel`. Labels: `Self-Care`, `Errands`, `Travel`.
- Commit after each task. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Rewrite the keyword engine (matcher + rules + labels + tests)

**Files:**
- Modify (replace body): `artifacts/api-server/src/lib/auto-points.ts`
- Create: `artifacts/api-server/src/lib/auto-points.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (unchanged public API, new behavior): `assignPoints(title: string, priority?: string): { points: number; category: string; categoryLabel: string }`; `CATEGORY_LABELS: Record<string,string>` (now includes `self_care`, `errands`, `travel`); `VALID_CATEGORIES: Set<string>` (derived, now includes the 3 new slugs). Later tasks rely only on these slug strings.

- [ ] **Step 1: Write the failing test file**

Create `artifacts/api-server/src/lib/auto-points.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assignPoints, CATEGORY_LABELS, VALID_CATEGORIES } from "./auto-points";

const cat = (title: string) => assignPoints(title).category;

describe("assignPoints — precision (word boundary, no mid-word matches)", () => {
  it("does not match short keywords inside other words", () => {
    expect(cat("brunch with friends")).not.toBe("health");     // 'run'
    expect(cat("start the project")).not.toBe("creative");     // 'art'
    expect(cat("attend the workshop")).not.toBe("errands");    // 'shop'
    expect(cat("buy fresh bread")).toBe("errands");            // 'buy' wins, not 'read'
    expect(cat("get ready for work")).not.toBe("learning");    // 'read' ≠ 'ready'
    expect(cat("book a taxi")).not.toBe("finance");            // 'tax' ≠ 'taxi'
    expect(cat("water the plant")).not.toBe("deep_work");      // 'plan' ≠ 'plant'
  });

  it("still matches whole short words and their listed inflections", () => {
    expect(cat("go for a run")).toBe("health");                // 'run' whole word
    expect(cat("go running")).toBe("health");                  // 'running' listed
    expect(cat("reading a chapter")).toBe("learning");         // 'reading' listed
  });

  it("still matches long stems with open suffix", () => {
    expect(cat("morning meditation")).toBe("self_care");       // 'meditat'
    expect(cat("budgeting for the month")).toBe("finance");    // 'budget'
    expect(cat("packing my suitcase")).toBe("travel");         // 'packing'
  });
});

describe("assignPoints — targeted routing fixes", () => {
  it("routes phone calls to social now that admin no longer keys on 'call'", () => {
    expect(cat("call mom")).toBe("social");
    expect(cat("call a friend to catch up")).toBe("social");
  });

  it("splits 'return' between finance (tax) and errands (package)", () => {
    expect(cat("file my tax return")).toBe("finance");
    expect(cat("return package to post office")).toBe("errands");
  });

  it("routes 'book flight' to travel, not learning/admin", () => {
    expect(cat("book flight to NYC")).toBe("travel");
  });

  it("moves journaling out of social into self_care", () => {
    expect(cat("journal for 10 minutes")).toBe("self_care");
  });
});

describe("assignPoints — new category coverage", () => {
  it("categorizes self_care, errands, travel", () => {
    expect(cat("evening skincare routine")).toBe("self_care");
    expect(cat("grocery shopping")).toBe("errands");
    expect(cat("check my itinerary")).toBe("travel");
  });
});

describe("assignPoints — labels + valid set", () => {
  it("exposes labels and valid-category membership for new slugs", () => {
    expect(CATEGORY_LABELS.self_care).toBe("Self-Care");
    expect(CATEGORY_LABELS.errands).toBe("Errands");
    expect(CATEGORY_LABELS.travel).toBe("Travel");
    for (const slug of ["self_care", "errands", "travel"]) {
      expect(VALID_CATEGORIES.has(slug)).toBe(true);
    }
  });
});

describe("assignPoints — regression (starter-quest routing preserved)", () => {
  it("keeps the four seed titles on distinct categories", () => {
    expect(cat("Take a 10-minute walk")).toBe("health");
    expect(cat("Read for 15 minutes")).toBe("learning");
    expect(cat("Tidy up your desk")).toBe("household");
    expect(cat("Plan your top 3 tasks for today")).toBe("deep_work");
  });

  it("still applies priority modifiers and clamps points", () => {
    expect(assignPoints("go running", "high").points).toBe(45);   // 35 + 10
    expect(assignPoints("random task", "low").points).toBe(5);    // 10 - 5, clamped to 5
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/api-server test`
Expected: FAIL — several `expect(...).toBe("self_care"/"errands"/"travel")` fail (old engine returns `default`/`social`/`health`), and `CATEGORY_LABELS.self_care` is `undefined`.

- [ ] **Step 3: Replace `auto-points.ts` with the new engine**

Replace the entire contents of `artifacts/api-server/src/lib/auto-points.ts` with:

```ts
interface RuleEntry {
  keywords: string[];
  basePoints: number;
  category: string;
}

// First matching rule wins, so ORDER MATTERS. Blocks are ordered so specific new
// categories win before broad generics can shadow them: travel precedes deep_work so
// "plan a trip"/"book flight" -> travel; finance precedes errands so "tax return" ->
// finance while "return package" -> errands.
const RULES: RuleEntry[] = [
  // ── Health & Fitness ─────────────────────────────────────────────────────
  { keywords: ["workout", "gym", "lift", "weight", "strength", "resistance"], basePoints: 35, category: "health" },
  { keywords: ["run", "running", "jog", "jogging", "sprint", "5k", "10k", "marathon"], basePoints: 35, category: "health" },
  { keywords: ["swim", "swimming", "bike", "biking", "cycle", "cycling", "hike", "hiking"], basePoints: 30, category: "health" },
  { keywords: ["yoga", "pilates", "stretch", "stretching", "exercise", "cardio", "hiit"], basePoints: 25, category: "health" },
  { keywords: ["walk", "walking", "steps"], basePoints: 15, category: "health" },
  { keywords: ["doctor", "dentist", "therapy", "therapist", "appointment", "checkup", "prescription", "physio", "physical therapy"], basePoints: 25, category: "health" },
  { keywords: ["medication", "medicine", "vitamins", "supplements"], basePoints: 10, category: "health" },
  { keywords: ["sleep", "bed", "wake up", "morning routine", "night routine", "nap"], basePoints: 10, category: "health" },
  { keywords: ["meal prep", "meal plan", "cook", "cooking", "prepare food", "healthy eating", "diet"], basePoints: 20, category: "health" },

  // ── Self-Care ────────────────────────────────────────────────────────────
  { keywords: ["meditat", "mindful", "breathe", "breathing", "relax"], basePoints: 15, category: "self_care" },
  { keywords: ["journal", "journaling", "diary", "reflect", "gratitude"], basePoints: 15, category: "self_care" },
  { keywords: ["self care", "self-care", "skincare", "unwind", "mental health"], basePoints: 15, category: "self_care" },

  // ── Travel ───────────────────────────────────────────────────────────────
  { keywords: ["flight", "flights", "fly", "airport", "boarding pass"], basePoints: 20, category: "travel" },
  { keywords: ["packing", "luggage", "suitcase", "passport", "visa"], basePoints: 20, category: "travel" },
  { keywords: ["itinerary", "hotel", "airbnb", "trip", "vacation", "rental car", "cruise"], basePoints: 20, category: "travel" },

  // ── Deep Work / Focus ────────────────────────────────────────────────────
  { keywords: ["write", "writing", "draft", "essay", "article", "blog", "report", "thesis"], basePoints: 35, category: "deep_work" },
  { keywords: ["code", "coding", "program", "programming", "develop", "development", "debug", "deploy", "refactor", "algorithm", "architecture"], basePoints: 35, category: "deep_work" },
  { keywords: ["design", "prototype", "mockup", "wireframe", "ui", "ux"], basePoints: 30, category: "deep_work" },
  { keywords: ["research", "analyze", "analysis", "study", "investigate", "audit"], basePoints: 30, category: "deep_work" },
  { keywords: ["build", "create", "make", "produce", "launch"], basePoints: 25, category: "deep_work" },
  { keywords: ["plan", "planning", "strategize", "strategy", "roadmap", "outline"], basePoints: 20, category: "deep_work" },
  { keywords: ["present", "presentation", "slides", "pitch"], basePoints: 30, category: "deep_work" },

  // ── Learning ─────────────────────────────────────────────────────────────
  { keywords: ["read", "reading", "book", "chapter", "pages"], basePoints: 20, category: "learning" },
  { keywords: ["course", "lesson", "tutorial", "lecture", "class", "workshop", "train", "training"], basePoints: 25, category: "learning" },
  { keywords: ["learn", "practice", "study", "review", "memorize", "flashcard"], basePoints: 20, category: "learning" },
  { keywords: ["podcast", "documentary", "video", "watch"], basePoints: 10, category: "learning" },

  // ── Finance ──────────────────────────────────────────────────────────────
  { keywords: ["tax", "taxes", "irs", "tax return", "file taxes"], basePoints: 35, category: "finance" },
  { keywords: ["budget", "budgeting", "finances", "financial"], basePoints: 25, category: "finance" },
  { keywords: ["invoice", "billing", "bill", "pay", "payment", "subscription", "refund"], basePoints: 20, category: "finance" },
  { keywords: ["bank", "transfer", "deposit", "invest", "investing", "savings", "insurance", "mortgage"], basePoints: 15, category: "finance" },

  // ── Errands / Shopping ───────────────────────────────────────────────────
  // After finance so "tax return" -> finance; a bare "return" here catches the rest.
  { keywords: ["grocery", "groceries", "shopping", "shop", "errand", "errands"], basePoints: 15, category: "errands" },
  { keywords: ["pick up", "drop off", "post office", "pharmacy", "dry clean"], basePoints: 15, category: "errands" },
  { keywords: ["gas station", "store", "buy", "return", "supplies"], basePoints: 15, category: "errands" },

  // ── Admin / Correspondence ───────────────────────────────────────────────
  { keywords: ["email", "emails", "inbox", "reply", "respond", "message", "messages"], basePoints: 15, category: "admin" },
  { keywords: ["meeting", "standup", "sync", "interview", "conference"], basePoints: 20, category: "admin" },
  { keywords: ["schedule", "scheduling", "calendar", "book", "booking", "appointment"], basePoints: 10, category: "admin" },
  { keywords: ["organize", "sort", "file", "filing", "paperwork", "document", "archive"], basePoints: 15, category: "admin" },
  { keywords: ["renew", "dmv", "cancel", "application", "register"], basePoints: 15, category: "admin" },

  // ── Household ─────────────────────────────────────────────────────────────
  { keywords: ["clean", "cleaning", "tidy", "vacuum", "mop", "sweep", "dust"], basePoints: 20, category: "household" },
  { keywords: ["laundry", "dishes", "wash", "washing", "iron", "ironing", "dishwasher"], basePoints: 15, category: "household" },
  { keywords: ["repair", "fix", "maintenance", "install", "assemble"], basePoints: 25, category: "household" },
  { keywords: ["declutter", "donate", "throw away", "clear out", "trash", "garbage", "recycling"], basePoints: 20, category: "household" },
  { keywords: ["yard", "lawn", "mow", "garden", "water plants"], basePoints: 20, category: "household" },

  // ── Social / Relationships ───────────────────────────────────────────────
  { keywords: ["call friend", "call family", "call mom", "call dad", "catch up"], basePoints: 15, category: "social" },
  { keywords: ["visit", "meet", "hangout", "hang out", "spend time"], basePoints: 15, category: "social" },
  { keywords: ["text", "birthday", "party", "date night", "dinner with"], basePoints: 15, category: "social" },

  // ── Creative ──────────────────────────────────────────────────────────────
  { keywords: ["draw", "drawing", "paint", "painting", "sketch"], basePoints: 20, category: "creative" },
  { keywords: ["music", "practice guitar", "practice piano", "instrument", "compose", "sing"], basePoints: 20, category: "creative" },
  { keywords: ["photo", "photography", "edit photos", "video edit"], basePoints: 20, category: "creative" },
  { keywords: ["craft", "knit", "pottery", "sculpt"], basePoints: 20, category: "creative" },
];

const PRIORITY_MODIFIER: Record<string, number> = {
  high: 10,
  medium: 0,
  low: -5,
};

export const CATEGORY_LABELS: Record<string, string> = {
  health: "Health",
  self_care: "Self-Care",
  deep_work: "Deep Work",
  learning: "Learning",
  finance: "Finance",
  admin: "Admin",
  household: "Household",
  errands: "Errands",
  social: "Social",
  creative: "Creative",
  travel: "Travel",
  default: "General",
};

export const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

export interface AutoPointResult {
  points: number;
  category: string;
  categoryLabel: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One regex per keyword, compiled once at module load. The boundary is length-tiered:
//   - short keywords (<=4 chars) match as WHOLE words, so common short words don't match
//     shared-prefix false friends: read≠ready, tax≠taxi, plan≠plant, art≠party, bed≠bedroom.
//     Their inflections (running, shopping, reading, ...) are listed explicitly in RULES.
//   - longer keywords keep an OPEN suffix so stems inflect: meditat→meditation,
//     budget→budgeting, journal→journaling, reflect→reflection.
function keywordRegex(kw: string): RegExp {
  const body = escapeRegExp(kw);
  return kw.length <= 4
    ? new RegExp(`\\b${body}\\b`, "i")
    : new RegExp(`\\b${body}`, "i");
}

const COMPILED: { res: RegExp[]; rule: RuleEntry }[] = RULES.map((rule) => ({
  res: rule.keywords.map(keywordRegex),
  rule,
}));

export function assignPoints(title: string, priority: string = "medium"): AutoPointResult {
  const modifier = PRIORITY_MODIFIER[priority] ?? 0;

  for (const { res, rule } of COMPILED) {
    if (res.some((re) => re.test(title))) {
      const raw = rule.basePoints + modifier;
      return {
        points: Math.max(5, Math.min(100, raw)),
        category: rule.category,
        categoryLabel: CATEGORY_LABELS[rule.category] ?? rule.category,
      };
    }
  }

  // Default: no match — use priority-driven baseline
  const defaultBase = priority === "high" ? 25 : priority === "low" ? 10 : 15;
  return {
    points: Math.max(5, Math.min(100, defaultBase + modifier)),
    category: "default",
    categoryLabel: CATEGORY_LABELS.default,
  };
}
```

- [ ] **Step 4: Run the api-server tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS — `auto-points.test.ts`, `starter-quests.test.ts`, and `quick-add-parse.test.ts` all green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/auto-points.ts artifacts/api-server/src/lib/auto-points.test.ts
git commit -m "feat(categories): word-boundary matcher + self_care/errands/travel rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Extend quick-add hashtag aliases + slugs

**Files:**
- Modify: `lib/quick-add/src/categories.ts`
- Modify: `lib/quick-add/src/categories.test.ts`

**Interfaces:**
- Consumes: the slug strings `self_care`, `errands`, `travel` (from Task 1's category set).
- Produces: `resolveHashtag(word)` now resolves the new slugs and their aliases; `CATEGORY_SLUGS` includes the 3 new slugs.

- [ ] **Step 1: Add the failing test cases**

In `lib/quick-add/src/categories.test.ts`, add these tests inside the existing `describe("resolveHashtag", …)` block (after the "maps a canonical slug to itself" test):

```ts
  it("resolves the new category slugs", () => {
    expect(resolveHashtag("self_care")).toBe("self_care");
    expect(resolveHashtag("errands")).toBe("errands");
    expect(resolveHashtag("travel")).toBe("travel");
  });

  it("resolves aliases for the new categories", () => {
    expect(resolveHashtag("selfcare")).toBe("self_care");
    expect(resolveHashtag("meditate")).toBe("self_care");
    expect(resolveHashtag("groceries")).toBe("errands");
    expect(resolveHashtag("shopping")).toBe("errands");
    expect(resolveHashtag("trip")).toBe("travel");
    expect(resolveHashtag("vacation")).toBe("travel");
  });

  it("resolves newly added aliases for existing categories", () => {
    expect(resolveHashtag("email")).toBe("admin");
    expect(resolveHashtag("code")).toBe("deep_work");
    expect(resolveHashtag("clean")).toBe("household");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/quick-add test`
Expected: FAIL — the new slugs and aliases resolve to `undefined`.

- [ ] **Step 3: Update `categories.ts`**

In `lib/quick-add/src/categories.ts`, replace the `CATEGORY_SLUGS` array and the `CATEGORY_ALIASES` object with:

```ts
export const CATEGORY_SLUGS = [
  "health", "deep_work", "learning", "finance",
  "admin", "household", "social", "creative",
  "self_care", "errands", "travel", "default",
] as const;
```

```ts
export const CATEGORY_ALIASES: Record<string, string> = {
  work: "deep_work", job: "deep_work", office: "deep_work", focus: "deep_work", code: "deep_work",
  chore: "household", chores: "household", home: "household", house: "household", clean: "household",
  gym: "health", workout: "health", run: "health", fitness: "health",
  money: "finance", bills: "finance", bill: "finance", budget: "finance",
  study: "learning", read: "learning", reading: "learning", learn: "learning",
  errand: "errands", errands: "errands", groceries: "errands", grocery: "errands", shopping: "errands", shop: "errands",
  paperwork: "admin", email: "admin", admin: "admin",
  friends: "social", family: "social", call: "social",
  art: "creative", draw: "creative", music: "creative",
  selfcare: "self_care", meditate: "self_care", meditation: "self_care", journal: "self_care", mindfulness: "self_care", wellness: "self_care",
  travel: "travel", trip: "travel", flight: "travel", vacation: "travel", holiday: "travel",
};
```

> Note: `errand`/`errands` moved from `admin` to `errands`; `call` now maps to `social`
> (matching Task 1's routing); `paperwork` stays `admin`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/quick-add test`
Expected: PASS — all `categories.test.ts` and `parse.test.ts` cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/quick-add/src/categories.ts lib/quick-add/src/categories.test.ts
git commit -m "feat(quick-add): hashtag aliases + slugs for self_care/errands/travel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Frontend labels + colors for the new categories

**Files:**
- Modify: `artifacts/focusquest/src/lib/categories.ts`
- Create: `artifacts/focusquest/src/lib/categories.test.ts`

**Interfaces:**
- Consumes: slug strings `self_care`, `errands`, `travel`.
- Produces: `CATEGORIES` (adds 3 entries), `CATEGORY_COLORS` + `CATEGORY_HEX_COLORS` (adds 3 keys each), `CATEGORY_LABEL` (derived). Consumed by `insights.tsx` / `progress.tsx` legends.

- [ ] **Step 1: Write the failing invariant test**

Create `artifacts/focusquest/src/lib/categories.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_HEX_COLORS, CATEGORY_LABEL } from "./categories";

describe("category catalog integrity", () => {
  it("has a color, hex, and label for every category slug", () => {
    for (const { slug } of CATEGORIES) {
      expect(CATEGORY_COLORS[slug], `color for ${slug}`).toBeTruthy();
      expect(CATEGORY_HEX_COLORS[slug], `hex for ${slug}`).toBeTruthy();
      expect(CATEGORY_LABEL[slug], `label for ${slug}`).toBeTruthy();
    }
  });

  it("includes the three new categories", () => {
    const slugs = CATEGORIES.map((c) => c.slug);
    expect(slugs).toContain("self_care");
    expect(slugs).toContain("errands");
    expect(slugs).toContain("travel");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- categories`
Expected: FAIL — "includes the three new categories" fails; the new slugs are absent.

- [ ] **Step 3: Add the entries in `categories.ts`**

In `artifacts/focusquest/src/lib/categories.ts`:

Replace the `CATEGORIES` array with (adds self_care after health, errands after household, travel after creative):

```ts
export const CATEGORIES = [
  { slug: "health",    label: "Health" },
  { slug: "self_care", label: "Self-Care" },
  { slug: "deep_work", label: "Deep Work" },
  { slug: "learning",  label: "Learning" },
  { slug: "finance",   label: "Finance" },
  { slug: "admin",     label: "Admin" },
  { slug: "household", label: "Household" },
  { slug: "errands",   label: "Errands" },
  { slug: "social",    label: "Social" },
  { slug: "creative",  label: "Creative" },
  { slug: "travel",    label: "Travel" },
  { slug: "default",   label: "General" },
] as const;
```

Add three keys to `CATEGORY_COLORS` (before the `default` line):

```ts
  self_care: "text-teal-400  bg-teal-400/10  border-teal-400/30",
  errands:   "text-lime-400  bg-lime-400/10  border-lime-400/30",
  travel:    "text-cyan-400  bg-cyan-400/10  border-cyan-400/30",
```

Add three keys to `CATEGORY_HEX_COLORS` (before the `default` line):

```ts
  self_care: "#2dd4bf",
  errands:   "#a3e635",
  travel:    "#22d3ee",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/focusquest test -- categories`
Expected: PASS — both cases green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/categories.ts artifacts/focusquest/src/lib/categories.test.ts
git commit -m "feat(ui): labels + colors for self_care/errands/travel categories

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Add new slugs to OpenAPI enums + regenerate types

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (9 category enum occurrences)
- Regenerate (do not hand-edit): `lib/api-zod/**`, `lib/api-client-react/**`

**Interfaces:**
- Consumes: slug strings `self_care`, `errands`, `travel`.
- Produces: `TaskCategory` (and the other generated category enums) now include the 3 new slugs, keeping generated Zod/TS types in sync with the runtime engine.

- [ ] **Step 1: Add the slugs to every category enum**

Run this from the repo root (updates all 9 occurrences; the two `sed` expressions target the nullable and non-nullable variants separately so neither double-applies):

```bash
sed -i \
  -e 's/health, deep_work, learning, finance, admin, household, social, creative, default, null/health, deep_work, learning, finance, admin, household, social, creative, self_care, errands, travel, default, null/g' \
  -e 's/health, deep_work, learning, finance, admin, household, social, creative, default\]/health, deep_work, learning, finance, admin, household, social, creative, self_care, errands, travel, default]/g' \
  lib/api-spec/openapi.yaml
```

- [ ] **Step 2: Verify all 9 enums were updated**

Run: `grep -c "self_care, errands, travel" lib/api-spec/openapi.yaml`
Expected: `9`

Also confirm none were missed:
Run: `grep -n "creative, default" lib/api-spec/openapi.yaml`
Expected: no output (every occurrence now reads `creative, self_care, errands, travel, default`).

- [ ] **Step 3: Regenerate the client/zod types**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: Orval runs cleanly; files under `lib/api-zod/src/generated` and `lib/api-client-react/src/generated` change.

- [ ] **Step 4: Verify the generated enum picked up the new slugs**

Run: `grep -n "self_care\|errands\|travel" lib/api-zod/src/generated/types/taskCategory.ts`
Expected: three matching lines (`self_care: 'self_care'`, `errands: 'errands'`, `travel: 'travel'`).

- [ ] **Step 5: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: PASS (no type errors across libs + artifacts + scripts).

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api): add self_care/errands/travel to category enums (regen)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run every test package**

Run: `pnpm --filter @workspace/api-server test && pnpm --filter @workspace/quick-add test && pnpm --filter @workspace/focusquest test`
Expected: all suites PASS.

- [ ] **Step 2: Run the root typecheck gate**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Confirm a clean tree (all work committed)**

Run: `git status --short`
Expected: empty output (every change committed across Tasks 1–4).

---

## Notes / accepted edge cases

- `book flight`→travel works because the travel block precedes learning/admin. A bare
  `book meeting` still routes to learning via `book` (pre-existing ambiguity, out of scope).
- `trip` can match `triple`, `tax` can match `taxi`, `bed` can match `bedroom` — all
  low-frequency and pre-existing; not worth narrowing here.
- `video edit`→learning (learning's `video` precedes creative) — pre-existing, unchanged.
- Change applies to newly created tasks only; existing rows are not re-categorized.
