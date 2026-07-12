# Auto-Category Expansion — Design

**Date:** 2026-07-12
**Status:** Approved (design)

## Problem

The backend keyword engine that auto-assigns a category (and base points) to every
task/quest — `assignPoints()` in `artifacts/api-server/src/lib/auto-points.ts` — has
two limitations:

1. **Coverage:** only 8 real categories, and many common tasks (self-care, errands,
   travel) fall through to `default`.
2. **Precision:** matching is substring (`lower.includes(kw)`), so keywords match
   *inside other words*: `art` matches "p**art**y"/"st**art**", `read` matches
   "**read**y"/"b**read**", `run` matches "b**run**ch", `shop` matches "work**shop**".

We want to broaden coverage (existing categories + 3 new ones), sharpen precision,
and grow the `#hashtag` alias list — without a DB migration.

## Key facts / constraints

- **No DB migration needed.** `tasks.category` and `recurring_tasks.category` are plain
  `text` columns (default `"default"`), not Postgres enums. New slugs need no schema push.
- **Single source of truth for auto-category:** `assignPoints(title, priority)`. Used on
  create in `routes/tasks.ts` and `routes/recurring-tasks.ts`, by starter quests, and by
  the daily-focus recommendation. The AI quick-add parser deliberately **drops** category
  (see `quick-add-parse.test.ts`); category always comes from `assignPoints`.
- **Category precedence at create time:** explicit known `#tag` › `assignPoints` keyword
  match on the title › `default`.
- **`VALID_CATEGORIES`** is derived from `CATEGORY_LABELS`, so adding a label automatically
  makes the slug a valid explicit-override value in the API routes.
- **Starter-quests invariant:** `starter-quests.test.ts` requires the four seed titles to
  map to four *distinct* categories: `walk→health`, `read→learning`, `tidy→household`,
  `plan→deep_work`. All precision changes below preserve this.
- **api-zod / api-client-react are generated** from `lib/api-spec/openapi.yaml`. The category
  enum appears in **8 places** in that file (one includes `null`). Adding slugs = edit those
  enums, then regenerate.

## Design

### 1. Matcher: word-boundary with length-tiered suffix (root-cause precision fix)

Change the match test in `assignPoints` from substring (`lower.includes(kw)`) to a
word-boundary regex. A pure *leading* boundary (`\bkw`) is not enough: with an open suffix
it still matches shared-prefix false friends — `read`→"**read**y", `tax`→"**tax**i",
`plan`→"**plan**t", `sing`→"**sing**le", `text`→"**text**book". So the boundary is
**length-tiered**:

```ts
// Short keywords (<=4 chars) match as WHOLE words — avoids false friends
//   read≠ready, tax≠taxi, plan≠plant, art≠party, bed≠bedroom, trip≠triple.
// Longer keywords keep an OPEN suffix so stems inflect —
//   meditat→meditation, budget→budgeting, reflect→reflection, journal→journaling.
function keywordRegex(kw: string): RegExp {
  const body = escapeRegExp(kw);
  return kw.length <= 4
    ? new RegExp(`\\b${body}\\b`, "i")   // whole word
    : new RegExp(`\\b${body}`, "i");     // leading boundary, open suffix
}
```

- Short keywords lose arbitrary suffixes, but their common inflections are **already listed
  explicitly** in the rules (`run`+`running`, `walk`+`walking`, `shop`+`shopping`,
  `bill`+`billing`, `read`+`reading`, `plan`+`planning`, `tax`+`taxes`).
- Multi-word phrase keywords (`meal prep`, `call mom`, `post office`) are length ≥5 → open
  boundary, work unchanged.
- Digit-leading keywords (`5k`, `10k`) are ≤4 → whole word; `\b5k\b` still matches "run a 5k".
- Escape keywords before building the regex (defensive; current keywords have no special
  chars). Compile one regex per keyword once at module load.

This eliminates the substring false positives *and* the shared-prefix ones.

### 2. Three new categories

| slug        | label      | Tailwind classes                                             | hex       |
|-------------|------------|-------------------------------------------------------------|-----------|
| `self_care` | Self-Care  | `text-teal-400 bg-teal-400/10 border-teal-400/30`           | `#2dd4bf` |
| `errands`   | Errands    | `text-lime-400 bg-lime-400/10 border-lime-400/30`           | `#a3e635` |
| `travel`    | Travel     | `text-cyan-400 bg-cyan-400/10 border-cyan-400/30`           | `#22d3ee` |

Colors occupy hue slots unused by the existing 8 (teal ≠ health-green/household-emerald,
cyan ≠ deep_work-blue, lime is unused).

### 3. Final keyword rules (`RULES` in auto-points.ts)

Ordering matters (first matching rule wins). New categories are placed **before** the
generic categories whose keywords would otherwise shadow them (travel before learning/admin
so `book flight`→travel; errands before household; self_care before health/social).

**Health** — remove `meditat, mindful, breathe, breathing, relax, rest` (→ self_care).
Keep the rest (incl. the existing `stretch/stretching` in the yoga group); add `physio,
physical therapy, nap`. Meal-prep group unchanged.

**Self-Care (new, ~15 pts)** — `meditat, mindful, breathe, breathing, relax, journal,
journaling, diary, reflect, gratitude, self care, self-care, skincare, unwind,
mental health`. (Dropped leaky bare `rest` — matched "restaurant".)

**Deep Work** — keep existing; add `spec, architecture, refactor, algorithm`.

**Learning** — unchanged groups; ensure it stays *after* travel so `book flight` isn't
caught by learning's `book`.

**Finance** — narrow tax group: replace bare `return` with `tax return` (so `return
package`→errands, not finance). Add `refund, insurance, mortgage, rent payment`.

**Errands (new, ~15 pts)** — `grocery, groceries, shopping, shop, errand, errands,
pick up, drop off, post office, pharmacy, dry clean, gas station, store, buy, returns,
supplies`. (Moved from household: grocery/shopping/shop/errand group.)

**Travel (new, ~20 pts)** — `flight, flights, fly, airport, packing, luggage, suitcase,
itinerary, hotel, airbnb, trip, vacation, passport, visa, rental car, boarding pass,
cruise, check in`.

**Admin** — remove bare `call` from the meeting group (so `call mom`/`call friend` reach
social). Keep `meeting, standup, sync, interview, conference`. Add `renew, form, dmv,
application, cancel`.

**Household** — remove grocery/shopping/errand group (→ errands). Keep clean/laundry/
repair/declutter groups; add `trash, dishwasher, water plants, yard, lawn, mow`.

**Social** — remove journal group (→ self_care). Keep `call friend/family/mom/dad,
catch up`, `visit/meet/hangout`. Add `text, birthday, party, date night, dinner with`.
(`party` is safe here now that the matcher is word-boundary and creative no longer keys on
bare `art`.)

**Creative** — drop leaky bare `art` from the draw group (keep `draw, drawing, paint,
painting, sketch`); add `write song, record, podcast episode, craft, knit`. Keep music/
photo groups.

> Exact base-point values for existing rules are preserved; new categories use the base
> points listed above. Implementation should keep every existing rule's `basePoints` as-is
> unless explicitly changed here.

### 4. `CATEGORY_LABELS` / labels

Add to `CATEGORY_LABELS` (auto-points.ts), `CATEGORIES` + `CATEGORY_COLORS` +
`CATEGORY_HEX_COLORS` (`artifacts/focusquest/src/lib/categories.ts`):
`self_care → "Self-Care"`, `errands → "Errands"`, `travel → "Travel"`.

### 5. Hashtag aliases (`lib/quick-add/src/categories.ts`)

- Add the 3 new slugs to `CATEGORY_SLUGS`.
- Add aliases:
  - self_care: `selfcare, meditate, meditation, journal, mindfulness, wellness`
  - errands: `errands, groceries, grocery, shopping, shop`
  - travel: `travel, trip, flight, vacation, holiday`
- Fill small gaps in existing aliases while here (e.g. `email→admin`, `bill→finance`,
  `clean→household`, `code→deep_work`).

### 6. openapi + regeneration

- Add `self_care, errands, travel` to all 8 category enums in `lib/api-spec/openapi.yaml`
  (preserve the `null` on the one nullable enum).
- Regenerate `api-zod` and `api-client-react` via the repo codegen command; commit the
  generated diffs.

### 7. Tests

Add `artifacts/api-server/src/lib/auto-points.test.ts` (none exists today) covering:

- **Precision (must NOT match):** `brunch with friends`≠health, `start the project`≠creative,
  `attend workshop`≠errands, `buy bread`≠learning, `get ready`≠learning.
- **Precision (correct target):** `call mom`→social, `tax return`→finance,
  `return package`→errands, `journal for 10 min`→self_care, `book flight to NYC`→travel.
- **Coverage:** one representative title per new category (self_care, errands, travel).
- **Stems still work:** `meditation`→self_care, `running`→health, `packing my suitcase`→travel.
- **Regression:** the four starter-quest titles still map to health/learning/household/deep_work.

Keep `starter-quests.test.ts` and `quick-add-parse.test.ts` green.

## Files touched

- `artifacts/api-server/src/lib/auto-points.ts` — matcher, `RULES`, `CATEGORY_LABELS`.
- `artifacts/api-server/src/lib/auto-points.test.ts` — **new**.
- `lib/quick-add/src/categories.ts` — `CATEGORY_SLUGS`, `CATEGORY_ALIASES`.
- `artifacts/focusquest/src/lib/categories.ts` — `CATEGORIES`, `CATEGORY_COLORS`,
  `CATEGORY_HEX_COLORS`.
- `lib/api-spec/openapi.yaml` — 8 category enums.
- `lib/api-zod/**`, `lib/api-client-react/**` — regenerated (do not hand-edit).

## Out of scope / YAGNI

- No `pets` category (deferred; not requested).
- No DB migration (free-text column).
- No AI/LLM categorization changes — the deterministic keyword engine stays the source.
- No backfill/re-categorization of existing tasks; change applies to newly created tasks.
- No new UI for choosing categories beyond existing label/color surfaces.
