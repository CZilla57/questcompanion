# Capital Rework — Design

**Act:** VI — A Living World (follow-up to quest 2)
**Date:** 2026-07-19
**Status:** Approved, ready for implementation plan
**Related:** [[project-life-kingdoms]] (PR #58, #59), [[project-feature-roadmap]]

## Thesis

Life Kingdoms shipped the capital as a leftovers bin: the bucket that caught quests whose
category didn't map to one of the five kingdoms. It grew only from work that fit nowhere,
which made it both the least earned place on the map and — until this week — the only one
never rendered.

This rework gives the capital the one meaning nothing else on the map carries: **the total
of everything you have ever done.** The five kingdoms answer "where is my attention going?"
That is a question about *balance*, and balance is a share — necessarily zero-sum, and
necessarily silent about how much you have built overall. The capital answers the other
question: "how far have I come?" That one is cumulative and can only ever go up.

Two instruments, two grammars, one map. Keeping them distinct is the whole design.

## Scope (decisions locked during brainstorm)

- **Capital value = grand total**, derived at read time as the sum of all six rows.
- **12-tier ladder** for the capital, separate from the five kingdoms' 6-tier ladder.
- **Capital art is a different shape** (1024×192 band) from the kingdom tiles (320×192).
- **Layout:** 2 tiles centred / capital band full-width / 3 tiles, all five tiles equal size.
- **`liveliness` becomes nullable** and the capital returns `null`.
- The balance reading is **untouched** — the capital stays excluded from it.

Out of scope: changing what the five kingdoms mean, per-user scene variation, any change
to the write path or to `kingdomGrowth()`.

## The two questions

| | Five kingdoms | Capital |
|---|---|---|
| Question | Where is my attention going? | How far have I come? |
| Nature | Share of recent activity | Cumulative lifetime total |
| Can go down? | Yes — liveliness is a share | No — monotonic by construction |
| Visual grammar | Liveliness bar / scene dimming | Filled tier pips |
| Tiers | 6 (Wild → Stronghold) | 12 (Wilds → Eternal Capital) |
| In balance reading? | Yes | **Never** |

The distinct visual grammar is load-bearing, not decorative. A liveliness bar on the
capital would make it read as a sixth life area and dilute the five-way balance signal;
pips count structure, which only ever grows.

## Growth

One new pure function in `artifacts/api-server/src/lib/kingdoms.ts`:

```ts
/** The capital is the realm's grand total: every base point ever earned,
 *  including the uncategorized work held in its own row. */
export function capitalLifetime(
  lifetimeByKingdom: Partial<Record<KingdomId, number>>,
): number
```

Summed over **all six** ids — the five balance kingdoms plus the capital's own catch-all
row. Categorized work therefore counts once in its kingdom and once in the total;
uncategorized work counts once, in the capital row.

**The write path does not change.** `kingdomGrowth()` still routes each completed quest to
exactly one kingdom, and `category: "default"` still lands in the capital's row. The total
is computed in the `GET /users/me/kingdoms` route only.

Why derived rather than stored:

- No backfill migration — every existing user's capital is correct on first read.
- No second write to forget, so the value cannot drift out of sync.
- Monotonic for free: a sum of monotonic values is monotonic.

### The balance invariant

`balanceRecentTotal`, `isWorldResting`, and `deriveNeglectInvitation` continue to operate
on `BALANCE_KINGDOMS` only. The capital growing from all quests **must not** reach the
balance denominator — doing so would let uncategorized work dilute every real kingdom's
share, which is the exact failure the original design called out.

This needs an explicit regression test, because "the capital now counts everything" is
precisely the kind of change that leaks into a denominator during a later refactor.

## Tier ladder

`kingdomTier()` is unchanged and keeps serving the five. A new `capitalTier()` sits beside
it with its own 12 entries. Calibrated against ~20 base points per quest, and against the
fact that the capital accumulates roughly 5–6× faster than any single kingdom.

| Tier | Name | Min points | ≈ quests | Milestone |
|---|---|---|---|---|
| 0 | Wilds | 0 | 0 | |
| 1 | Waystation | 1 | 1 | first quest ever |
| 2 | Camp | 150 | ~8 | |
| 3 | Hamlet | 400 | ~20 | |
| 4 | Village | 1,000 | ~50 | |
| 5 | Town | 2,000 | ~100 | |
| 6 | Borough | 3,500 | ~175 | |
| 7 | City | 6,000 | ~300 | ≈ all five kingdoms at Village |
| 8 | Grand City | 10,000 | ~500 | |
| 9 | Metropolis | 16,000 | ~800 | |
| 10 | Crown City | 25,000 | ~1,250 | |
| 11 | Eternal Capital | 40,000 | ~2,000 | ≈ all five kingdoms at Stronghold |

Thresholds are absolute, never relative to the user's own history — same discipline as the
kingdom ladder, and for the same reason.

## Art

Twelve new images replace the current six:

```
artifacts/focusquest/public/kingdoms/scenes/capital/tier-0.png … tier-11.png
```

- **1024 × 192 px** each (64 × 12 tiles of 16px).
- Both dimensions are multiples of `TILE` — the existing scene-bounds test asserts this.
- **Safe zone: the centre 512px** (x = 256→768). The band is fixed-height with
  `object-cover`, so the outer quarters crop away on narrow viewports. The defining
  silhouette must live in the centre half; treat the outer quarters as outskirts.
- Renders 1:1 at desktop (1024px content width), so the art is authored at true scale.

Visible fraction by breakpoint, given the responsive band height:

| Breakpoint | Band | Source visible |
|---|---|---|
| mobile (343w) | 343 × 128 | ~50% |
| tablet (672w) | 672 × 160 | ~75% |
| desktop (1024w) | 1024 × 192 | 100% |

## Renderer seam

The only structural change. `kingdom-scene.tsx` currently hardcodes the module constants
`SCENE_W`/`SCENE_H` (320×192) onto the canvas element, which assumes every scene is the
same shape. The capital is now a different shape, so scene dimensions become per-kingdom:

- `sceneSize(kingdomId): { w, h }` — capital `1024×192`, all others `320×192`.
- `MAX_CAPITAL_TIER = 11` alongside `MAX_KINGDOM_TIER = 5`; `resolveSceneImageUrl` clamps
  per kingdom rather than against one global max.
- The capital gets its own 12-entry tier-phrase set for the aria-label. The existing
  `label` override prop stays — the capital passes an explicit label so screen-reader
  users are never told a liveliness verdict that sighted users aren't shown.
- The scene-bounds test iterates per-kingdom dimensions instead of the two constants.

Everything above this seam still speaks only in kingdom id, tier, and liveliness. The
PixiJS swap path is unaffected.

## API change

`liveliness` becomes **nullable** in `lib/api-spec/openapi.yaml`, and the route returns
`null` for the capital.

The route currently computes a capital liveliness through a special-case denominator,
carrying a comment admitting the value is meaningless and unrendered. Now that the capital
is explicitly a cumulative total rather than a share, that special case is deleted rather
than patched: a share-of-recent-activity reading has no meaning for a lifetime total.

Requires an orval regen (`pnpm codegen`). Frontend consumers must treat `liveliness` as
nullable; the five kingdoms always populate it.

## Layout

`/insights`, content width capped at `max-w-5xl` (1024px):

```
        ┌─────────┐ ┌─────────┐
        │ Hearth  │ │Wellsprg │      333 × 200 art, centred pair
        └─────────┘ └─────────┘
┌──────────────────────────────────┐
│      T H E   C A P I T A L       │  full width, fixed height
└──────────────────────────────────┘
┌─────────┐ ┌─────────┐ ┌─────────┐
│  Forge  │ │Athenaeum│ │Crossrds │  333 × 200 art
└─────────┘ └─────────┘ └─────────┘
```

- All five tiles are the **same size**. Sizing tiles by activity would rank the user's life
  areas against each other and visibly shrink one the week they stepped away from it —
  the exact verdict this system refuses to deliver.
- Band height `h-32` / `sm:h-40` / `lg:h-48` with `object-cover object-center`.
- Everything stacks to a single column on mobile.
- The dashboard strip keeps the five-bar row plus the capital's pip readout below the rule.

Pips now render 12 positions for the capital. `KingdomTierPips` takes the total count as a
prop rather than reading a single global max.

## Testing

| Area | Assertion |
|---|---|
| `capitalLifetime` | sums all six rows, including the capital's own |
| `capitalTier` | every threshold boundary, both sides |
| Balance invariant | capital totals never affect `balanceRecentTotal`, `isWorldResting`, or `deriveNeglectInvitation` |
| Scene URLs | capital resolves tier-0…tier-11; kingdoms still clamp at 5 |
| Scene bounds | per-kingdom dimensions are multiples of `TILE` |
| Route | capital returns `liveliness: null` and the derived total |
| Monotonicity | capital total never decreases as kingdom rows grow |

## Risks

- **Balance-denominator leak.** Highest-consequence failure and silent if it happens.
  Covered by an explicit regression test.
- **Art safe zone.** If the centre 512px doesn't carry the composition, the band reads as
  a crop rather than a scene on phones. Verify on a real 375px viewport once art lands.
- **Nullable liveliness.** A missed null-guard on the frontend would surface as a crash on
  the capital only. Typecheck catches it after regen; the tiles and band are separate code
  paths, so both need exercising.
