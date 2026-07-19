# Life Kingdoms — Design

**Act:** VI — A Living World (quest 2 of 5)
**Date:** 2026-07-18
**Status:** Approved, ready for implementation plan
**Related:** [[project-living-companion]] (PR #57), [[project-hero-character-system]], [[project-feature-roadmap]], [[project-act5-reflection-patterns]]

## Thesis

FocusQuest already knows which life areas you're feeding — `category` has been on every
quest since the beginning, and `categoryBreakdown` already ships on `/insights` as a
sorted list. But a sorted list is something you *read*, and reading it requires already
suspecting something is wrong.

Life Kingdoms makes that data **something you notice without looking for it**. Each life
area is a place. Work there and it visibly grows; stay away and it goes quiet. The ADHD
failure mode this targets is specific and real: chasing the interesting domain so hard
that an entire life area goes dark for weeks *without you ever noticing it happened*.

The map is the instrument. The growth is what makes you willing to look at it.

Everything obeys the campaign's **Anti-Shame Design law** — and here that law is enforced
by the *mechanic*, not by careful copy. See "The two-layer model."

## Scope (decisions locked during brainstorm)

- **Purpose:** a life-balance instrument (B), delivered through visible growth (A). Not a
  navigation layer — Questlines already groups quests, and a second hierarchy would add
  exactly the executive-function cost this app exists to remove.
- **Five kingdoms**, fixed mapping covering all 12 categories, plus a Capital for General.
- **Two layers:** monotonic persisted *structure* + derived, never-stored *liveliness*.
- **Growth unit:** base task points — not completion counts, not boosted XP.
- **Art:** terrain-led identity, LPC-Revised assets, vendored into the repo with credits.
- **Renderer:** plain canvas behind a swappable seam; Tiled JSON layouts from day one.
- **Surface:** compact strip on the dashboard, full map on `/insights`.

Out of scope for v1: an explorable/pannable world, hero walk animation, per-kingdom
questline integration, kingdom-gated unlocks or cosmetics, seasonal terrain. All layer on
later without rework — see "Engine adoption path."

## Kingdom mapping

Five kingdoms, fixed, covering all 12 canonical category slugs:

| Kingdom | Categories | Terrain identity |
|---|---|---|
| **Hearth** | `household`, `errands` | homestead, dirt paths |
| **Wellspring** | `health`, `self_care` | spring, pools, falls |
| **Forge** | `deep_work`, `admin`, `finance` | crag, stronghold |
| **Athenaeum** | `learning`, `creative` | grove, canopy |
| **Crossroads** | `social`, `travel` | roads, bridges, waystones |
| *(Capital)* | `default` | town square |

Five is deliberate: it fits one screen, and a balance instrument you have to scroll is
not one. Grouping (rather than 12 one-to-one kingdoms) also keeps each kingdom dense
enough to visibly move — a map of seven empty plots is the exact shame failure mode this
design exists to avoid.

**Forge deliberately mixes deep work with finance and admin.** A heavy deep-work day and
a bill-paying day both feed the same meter, because both are "the working life," and both
deserve to count.

**The Capital is special: it grows but is excluded from the balance reading.** `default`
is the keyword-miss fallback in `auto-points.ts` — a semantic void, and likely
high-volume. Letting it feed a kingdom would make the instrument lie about your balance;
letting it build nothing would mean real effort visibly counts for nothing. So it grows
the town square and is omitted from liveliness comparison and neglect detection.

## The two-layer model

The core of the design, and the anti-shame enforcement mechanism.

### Layer 1 — Structure (persisted, monotonic)

Buildings you have earned. Driven by **lifetime base points** in that kingdom. Crosses
absolute tier thresholds. **Never decreases** — not on uncomplete, not on quest deletion,
not on absence, not ever. Identical invariant to `bond_quests_completed`.

| Tier | Name | Lifetime points |
|---|---|---|
| 0 | Wild | 0 (terrain only, no structures) |
| 1 | Outpost | 1–249 |
| 2 | Settlement | 250–999 |
| 3 | Village | 1,000–2,999 |
| 4 | Town | 3,000–7,999 |
| 5 | Stronghold | 8,000+ |

Thresholds are **absolute, not relative to your other kingdoms.** Relative thresholds
would make your strongest kingdom permanently "the capital" regardless of actual
investment, which destroys the balance signal.

### Layer 2 — Liveliness (derived at read time, never stored)

Recent activity, as **share of your own last-14-day points**:

| State | Share of recent points |
|---|---|
| `dormant` | no activity at all |
| `stirring` | > 0 and < 10% |
| `steady` | 10–30% |
| `bustling` | > 30% |

Share-based, not absolute, and this is load-bearing: absolute thresholds would show a
low-activity user five dormant kingdoms (shame) and a high-activity user five bustling
ones (no signal). Proportions still read during a quiet week.

**The denominator is the five kingdoms' recent points, excluding the Capital.** Including
`default` would let uncategorized work dilute every real kingdom's share and drag the
whole map toward `stirring` — the same reason the Capital is excluded from the balance
reading generally.

### Why this is the anti-shame answer

Structure never falls, so **a neglected kingdom is asleep at night — not in ruins.** Dark
windows, everything still standing, every building you ever earned still there. It reads
as *quiet*, and quiet is inviting to return to in a way that rubble never is.

The mechanic is incapable of expressing decay. No copy discipline required.

## Growth unit: base points

Kingdom structure grows on **base task points**, with two deliberate exclusions.

**Not completion counts.** Twelve small errands would outgrow three deep-work sessions,
and the instrument would tell you something false about where your effort went. Points
already normalize effort (`auto-points.ts`: deep_work 20–35, errands 15, admin 10–20).

**Not boosted XP.** Kingdom growth ignores coin-bought XP and stat-perk multipliers
(`users.xp_boost_expires_at`). An instrument whose job is to reflect your real life must
not move because you bought a perk — that decouples the map from reality, and the map is
only worth having if it is honest.

## The neglect invitation

The instrument's active output, and the feature's actual ADHD payload.

**Rule:** surface a kingdom only when `structure > 0 AND liveliness == dormant` — *"you've
built here before, and haven't visited lately."*

Self-calibrating to your own life. It never tells someone who has never done fitness that
they should do fitness; it only reflects your own established pattern back at you. That is
the difference between an instrument and a lifestyle prescription.

### Defining "global absence"

Both guards below fire on one concrete, testable condition:

> `WORLD_RESTING_THRESHOLD` — recent (14-day) kingdom points, excluding the Capital, below
> **100 points** (roughly five small quests).

A plain zero-check is not enough. With a single quest in fourteen days, share math would
report that kingdom at 100% — `bustling` — which is absurd and would also make the other
four read as pointed neglect. The floor prevents the instrument from drawing confident
conclusions from a sample too small to support them. Tunable constant; the shape is fixed.

### Two mandatory guards

**1. Global-absence guard.** Below `WORLD_RESTING_THRESHOLD`, suppress the neglect
invitation entirely. "You've neglected Wellspring" is precisely wrong for someone who has
been away from everything — absence is hunger's and the companion's territory
([[project-hero-care]], [[project-living-companion]]), and the kingdoms must not pile on.
The nudge is only meaningful when you are **active but lopsided**, which is the real
insight.

**2. Whole-world resting state.** Under the same threshold, the map must
not render five independent verdicts of neglect. It renders a distinct **resting** state —
dusk, lanterns lit, smoke rising: *"your world is sleeping."* Returning after two weeks
away must not be greeted by a dead landscape. This has to agree with the companion's
`welcome_back` beat rather than contradict it.

## Art strategy

**Terrain-led kingdoms.** Identity comes from landscape, not architecture.

### Verified asset situation

The official `OpenGameArt/LiberatedPixelCup` repo has abundant terrain (15 tilesets:
grass, dirt, water, waterfall, mountains, rock, treetop, trunk, bridges…) but **essentially
one house and one castle** — architecture-led identity is not affordable from that source.

**Primary source instead: [LPC Revised] Fully Configured 4-Seasons Tilesets** (compiled by
JaidynReiman) — four seasonal terrain sheets plus a **dedicated buildings tileset**
(2048×2048), licensed **CC-BY 3.0 / OGA-BY 3.0**.

Two reasons this is the right pick beyond filling the gap:
- **No share-alike**, unlike the base repo's CC-BY-SA. Cleaner, and better for the later
  Cosmetic Premium roadmap item.
- **JaidynReiman is already a credited author in the hero pipeline.** Same art lineage, so
  hero-to-world style consistency is close to free.

Attribution required: JaidynReiman, Eliza Wyatt (DeathsDarling), Lanea Zimmerman (Sharm),
Stephen Challener (Redshrike), Johannes Sjölund (Wulax), BlueCarrot16, BenCreating,
Durrani, YuriNikolai, Craftpix.net.

**Open item before shipping:** the credit list includes **Craftpix.net**, a commercial
asset vendor. The compiler published the pack under CC-BY/OGA-BY, but that specific
inclusion warrants one sanity check rather than being assumed through.

### Vendored, not fetched

Unlike `build-lpc` (which fetches from stable git raw URLs at build time), OGA serves
attachments on content pages. Kingdom art is therefore **downloaded once and committed**,
with a `CREDITS` entry following the existing `public/lpc/CREDITS.csv` pattern.

This is a *different pattern* from the character pipeline, and the simpler one: no
build-time network dependency, no upstream drift, reproducible builds. Named here so it
does not later look like an inconsistency.

### Composition

Structure tier **adds** built elements; liveliness **toggles** overlay layers (lit
windows via `castle_lightsources`, smoke, figures). Layer-toggling for state is the same
trick `hero-care` used for sprite states.

Figures in the streets reuse the **existing hero sprite** — your own customized hero,
walking in the kingdom you built. Free, on-brand, and better than generic NPCs.

**Seasons must never encode neglect.** The seasonal sheets are tempting for liveliness;
"dormant = winter" is exactly the decay framing this design eliminates. Frozen and dead is
worse than dark and asleep. Seasons may later track the *real calendar* uniformly across
all kingdoms — never neglect.

## Engine adoption path

No game engine in v1. Life Kingdoms as designed needs readable static scenes, which the
existing `PixelHero` canvas compositor pattern already handles. An engine would cost
meaningful bundle on a PWA whose core loop (quick-add, complete a quest) must stay
instant. Task manager first.

**Three decisions that keep later adoption cheap, at no cost today:**

1. **Kingdom state stays renderer-agnostic.** Tier, liveliness, and per-kingdom points
   live in a pure module that has never heard of canvas. Same discipline as `companion.ts`.
2. **The renderer is a swappable seam.** One `KingdomScene` boundary — canvas today, Pixi
   later, nothing upstream changes. Mirrors the AI-provider seam.
3. **Layouts ship as Tiled JSON from day one.** The LPC Revised pack is already configured
   for Tiled Map Editor. Author layouts in Tiled; render that JSON with a small plain-canvas
   renderer. Both Pixi and Phaser read Tiled natively, so **every layout ports for free**
   when an engine is eventually justified. Baked scene PNGs would throw that away.

**What would justify an engine later:** a pannable continuous world, walking the hero
around, real animation (note `build-lpc` currently crops only the south standing frame and
discards the walk/idle cycles already present in fetched sheets), or Body-Doubling Rooms
if a shared visual space becomes the realtime answer.

**When it comes: PixiJS, not Phaser.** Phaser wants to own the app lifecycle, which fights
React for a surface that is one page of the product. Pixi is a renderer you embed, and it
is lighter. Phaser only wins if the game surface becomes the main event.

## Surfaces

**Dashboard strip (the actual instrument).** A compact five-kingdom liveliness strip.
`/insights` is `mobileShow: false` and therefore two taps deep in the drawer on mobile —
a balance instrument you have to go find is not one. The strip makes it glanceable where
you already are; the map is the drill-down.

**Full map on `/insights`**, placed *directly above* the existing `categoryBreakdown`.
This placement is deliberate and self-teaching: the map is the felt version, the breakdown
is the precise version, and they are visibly the same data. A beautiful world floating
unexplained on the Hero page would be a worse outcome.

No new nav entry — the app already carries 12 (6 on mobile).

## Pure libs (testable, zero cost)

Mirrors the `companion.ts` / `hero-care.ts` pattern.

- `artifacts/api-server/src/lib/kingdoms.ts` — `KINGDOM_MAP` (category → kingdom),
  `kingdomTier(points)`, `deriveLiveliness(kingdomPoints, recentTotal)`,
  `deriveNeglectInvitation(kingdoms, recentTotal)`, `isWorldResting(recentTotal)`.
- `artifacts/focusquest/src/lib/kingdom-scene.ts` — pure layout resolution:
  `(kingdomId, tier, liveliness) → layer list`. No canvas, no React.

Both pure, both fully unit-testable, neither aware of rendering or the database.

## Data model

Additive columns only, matching the Living Companion approach.

- `users.kingdom_points_<id>` **or** a `kingdom_points` table keyed `(user_id, kingdom_id)`
  — resolve during planning; the table is likely cleaner given five-plus-Capital and the
  precedent of `coin_transactions`.
- Incremented in the **completion transaction** alongside `lastFedAt` and
  `bond_quests_completed`, using base points.
- **Never decremented** on uncomplete or delete.

Liveliness, tier, and the neglect invitation are all **derived at read time** and stored
nowhere.

## Anti-shame invariants (made testable)

Each becomes an explicit test:

1. Structure points never decrease — uncomplete, delete, and absence all leave them intact.
2. No liveliness state renders as decay, ruin, or damage; `dormant` renders as night.
3. Neglect invitation never fires below `WORLD_RESTING_THRESHOLD`.
4. The map renders the whole-world `resting` state below `WORLD_RESTING_THRESHOLD`, never
   five independent neglect verdicts.
5. The Capital never participates in liveliness comparison or neglect detection.
6. Kingdom growth is unaffected by active XP/stat-perk multipliers.
7. Seasonal art never encodes neglect.

## Testing

- Unit: `kingdoms.ts` — mapping totality (all 12 slugs map somewhere), tier boundaries,
  share-based liveliness across low/high total-activity users, both guards.
- Unit: `kingdom-scene.ts` — layer resolution per tier × liveliness, no missing sprites.
- Integration: completion transaction increments the right kingdom by base (not boosted)
  points; uncomplete leaves it unchanged.
- Catalog integrity: every sprite referenced by a layout resolves — mirrors the existing
  `catalog-integrity.test.ts` and `assertCoverage()` guards.

## Open items for planning

- Kingdom points as user columns vs. a keyed table (table preferred).
- Exact tier thresholds are tunable constants — the shape is fixed, the numbers are not.
- Craftpix.net licensing sanity check before art is vendored.
- Whether the dashboard strip links to `/insights` directly or opens an inline expansion.
