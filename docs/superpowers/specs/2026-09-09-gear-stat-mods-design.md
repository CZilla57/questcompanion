# Gear Stat Mods — Design Spec

*Date: 2026-09-09 · Status: design approved, pending spec review · Roadmap: RPG-depth Act I(b)*

## Summary

Give gear **typed ability mods** (the D&D wondrous-item model — Headband of
Intellect, Belt of Giant Strength). Equipped gear raises the ability shown on
the hero's character sheet; that raised ability feeds the **skill-check roll**
on matching-category quests; and the existing flat `statPower` stays as the
separate **battle/defense** number (the AC/HP lane). Effects are **equipped-only
and upside-only** — unequipping returns the hero to base, never below.

This closes the one genuinely-new mechanic left in the RPG-depth roadmap. It was
deliberately deferred until after Act II because `statPower` is load-bearing
across the shipped gear/loot/inventory/attunement wave. This design adds a
*parallel* typed channel rather than replacing `statPower`, so that blast radius
stays contained.

## Motivation

Gear today is a non-decision: every item is a single `statPower` integer, so the
hero always equips the highest number — more is strictly better, no tradeoff.
The roadmap's thesis is "turn nouns into decisions with stakes," and a decision
only exists when items have *different shapes* with an opportunity cost.

Crucially, **gear does not touch the skill-check roll today at all.** The roll is
`d20 + abilityModifier + proficiency + upside` (`roll-engine.ts` `resolveCheck`),
where the ability modifier comes from the *derived* character sheet (kingdom
lifetime points + focus) that gear cannot influence. `statPower` only feeds
battle power (`getUserPower` via `attunement.gearPower`), hero look, and salvage
value. So the roadmap's Act II line "d20 + statMod + **gearBonus** vs DC" was
never actually wired — the gear half is missing. This design adds it.

## Non-goals (YAGNI)

- **No multi-ability items.** The storage shape (`jsonb`) supports them, but we
  author exactly one ability per catalog item. Multi-ability is a later option
  with no schema change.
- **No slot-flavored behavior** (weapon→attack bonus, armor→AC). A purist D&D
  model would differentiate slots; that is a later "texture pass", not this cut.
- **`statPower` is NOT derived from mods.** The single-source unification
  (deriving battle power from the sum of mods) stays deferred. `statPower` keeps
  its current formula and all current consumers untouched.

## The mechanic

### Score model, not modifier model

In real D&D an ability item modifies the **score**; the modifier is recomputed
as `floor((score − 10) / 2)`. We honor that:

- Gear grants **even-amount score bonuses** (e.g. +2 or +4 to the score). Since
  the earned score ladder steps in even increments (8, 10, 12 … 20), an even
  score bonus maps to a clean, predictable modifier step (+2 score = +1
  modifier). No odd-score rounding surprises.
- **Gear may exceed the natural ceiling.** The *earned* derived score caps at 20
  (`MAX_SCORE`); gear stacks on top for an *effective* score that can go above
  20 (D&D's Belt-of-Storm-Giant behavior). This keeps gear meaningful even for a
  maxed hero. The stored/derived sheet remains monotonic and capped at 20; the
  effective score is a derived, equipped-only overlay.
- **Per-ability cap** so bands are never trivialized: the total gear bonus to any
  single ability is capped at **+4 score / +2 modifier** (tunable).

Player-facing effect: equip the Athenaeum staff → sheet shows **INT 18 (+2 from
gear)** → the next learning quest rolls `d20 + 4` instead of `+3`, nudging toward
success/crit and better loot → taking the staff off returns to base.

### Score ↔ roll reconciliation

The sheet shows the authentic *score* change; the roll shows a *legible*
contribution term (as Well-Rested and consumables each do in `mathText`). These
reconcile because the score bonus is even:

- **Character sheet** shows the score change (`base 16 → effective 18`).
- **Roll** carries a distinct `gearBonus` **modifier** term
  = `effectiveModifier − baseModifier`, rendered in `mathText` as `… +1 gear`.
- Same underlying number, each surface in its native unit.

## Data model

Add one column to `gear_items` (catalog table):

```
stat_mods  jsonb  NOT NULL DEFAULT '{}'   -- { [abilityId]: scoreBonus }
```

- `stat_power` is unchanged and keeps all current consumers.
- `stat_mods` is a map of `AbilityId → even score bonus`. Authored today as a
  single entry per item; the shape allows more later.
- **No user-data migration.** `user_gear` already references catalog rows;
  effective mods appear as soon as the catalog reseeds.
- Migration is committed WITH `meta/_journal.json` + the snapshot (per the
  drizzle migration-meta rule), then `npx tsc` in `lib/db` rebuilds dist decls.

### Catalog authoring

Each roster item in `lib/db/src/gear-catalog.ts` gains an authored `ability:
AbilityId` field, chosen to fit its flavor (Staff of the Archmage → intellect,
Excalibur → might, Windrunner Bow → finesse, an amulet → presence/attunement).

`seedGear`'s idempotent upsert writes:

```
stat_mods = rarity === "common" ? {} : { [item.ability]: gearAbilityBonus(rarity) }
```

- **Rarity gates whether an item shapes your build:** common = no mod (pure
  `statPower`); rare/epic/legendary carry the mod. This gives rarity an identity
  beyond raw power, dovetailing with the shipped rarity⊥level decoupling.
- **Magnitude by rarity (rarity-only):** `common 0, rare +2, epic +2, legendary
  +4`. So an ability is maxed by one legendary OR two rare/epic — the loadout
  decision (spread across abilities vs. double down on one). All values are
  tunable balance knobs in a single constants block.
- **Coverage invariant (test):** every one of the six abilities appears on at
  least one low-level `inStore` item, so no ability is ever un-boostable.

## Components

### New pure lib: `gear-mods.ts`

Same derived, DB-free discipline as `attunement.ts` / `character-sheet.ts`.

- `PER_ABILITY_CAP = 4` (score points).
- `gearAbilityBonus(rarity): number` — the magnitude formula (even, rarity-only).
- `equippedAbilityMods(equipped): Partial<Record<AbilityId, number>>` — sums each
  equipped item's `stat_mods` per ability, then clamps each ability to
  `PER_ABILITY_CAP`. Returns even score bonuses per ability.
- One shared function used by BOTH the roll and the sheet, so they can never
  disagree.

Tests: empty → all zero (unequip neutral); monotonic (more gear never lowers);
cap enforced; never negative; outputs even.

### Shared equipped-gear read

Extract the inline equipped-gear query out of `getUserPower` (`routes/battle.ts`)
into a small helper returning rows carrying BOTH `statPower` and `statMods`.
Reused by three callers — battle power, the roll path, the sheet route — so the
query shape can't drift.

### Roll path — `rollCompletionCheck` (`routes/tasks.ts`)

Currently loads kingdom points + focus. Add the shared equipped-gear read,
compute the capped gear bonus for the *task's* ability
(`abilityForKingdom(kingdomForCategory(category))`), and pass its **modifier**
contribution (`floor(cappedScoreBonus / 2)`) into `resolveCheck` as a new
**non-negative upside term** — the same clamped-≥0 channel `restedBonus` / `boost`
already use. `resolveCheck`'s core math is untouched; it gains one more upside
term and surfaces it in `SkillCheck` + `mathText`.

### Sheet path — `character-sheet.ts` + `/users/me`

`abilityScores()` gains an **optional** `gearMods` arg:

- Omitted ⇒ behaves exactly as today (drift-guard + monotonic tests stay green;
  output byte-identical).
- Present ⇒ each `AbilityScore` gains `gearBonus` (score points, 0 when none)
  plus `effectiveScore` / `effectiveModifier`. The base `score` / `modifier`
  stay the earned, monotonic values; gear is a pure overlay.

The `/users/me` route adds the shared equipped-gear read and passes `gearMods`.

### Contract + clients

OpenAPI: `AbilityScore` gains the gear fields; `SkillCheck` gains the gear term.
Regenerate `api-zod` + `api-client` (`cd lib/api-spec && pnpm codegen`). iOS
Codable drops unknown keys, so the live app keeps decoding unchanged — iOS
parity is its own follow-up slice.

### Web display

- Gear cards (Store + Inventory): a "+2 INT" style ability badge alongside the
  existing power/rarity, reusing rarity colors.
- Character sheet (`character-sheet.tsx`): each ability block shows the effective
  score with the gear delta, e.g. `18 (+2 gear)`, and the effective modifier.

## Data flow — completing a learning quest with an INT staff equipped

1. `POST /api/tasks/:id/complete` → `rollCompletionCheck`.
2. Reads kingdom points + focus (base sheet) AND equipped gear (shared read).
3. `equippedAbilityMods` sums + caps → `{ intellect: 2 }`.
4. Task category `learning` → kingdom `athenaeum` → ability `intellect`; gear
   modifier term = `floor(2/2) = +1`.
5. `resolveCheck` rolls `d20 + baseIntMod + proficiency + (+1 gear) + rested/boost`;
   `mathText` shows the `+1 gear` term; band resolved as today.
6. Sheet reads (`/users/me`) show `INT effective 18 (+2 gear)` from the same
   `equippedAbilityMods`.
7. Unequip the staff → gear read empty → roll and sheet return to base exactly.

## Anti-shame invariants (enforced by tests)

- Effective ≥ base always; base score/modifier never move due to gear.
- Unequip reproduces the exact pre-gear roll (seed-stable regression: same seed
  + no gear = byte-identical to pre-change output).
- Per-ability cap holds regardless of how many items stack.
- Existing character-sheet drift-guard + monotonic tests unaffected.

## Testing

Pure-lib only, per the repo convention (no route-test harness); the wired path is
verified by the live drive.

- `gear-mods.test.ts`: cap, monotonic, unequip-neutral, non-negative, even.
- `roll-engine.test.ts`: gear folds into the clamped-≥0 upside channel; `mathText`
  shows the term; seed-stability regression with no gear.
- `character-sheet.test.ts`: optional `gearMods` backward-compat; overlay correct;
  base untouched.
- catalog invariant test: every ability covered by ≥1 low-level `inStore` item;
  common carries no mod; rare+ carries an even mod ≤ cap.

## Rollout & sequencing

- **Slice 1 — server + web** (branch `claude/dnd-gear-stat-mods` off main → PR to
  main): migration + column, `gearAbilityBonus` formula, catalog ability
  authoring, `gear-mods` lib, shared read, roll wiring, sheet fields, web display,
  tests, OpenAPI + regen. `seedGear` reseeds on deploy automatically.
- **Slice 2 — iOS parity** (off the swift integration branch): decode the gear
  fields; show them on HeroView's character sheet + gear cards + the
  `CompletionSheet` gear term.
- **Live-drive verify** (post-deploy, like every prior wave): equip a rare INT
  item → sheet shows INT raised → complete a learning quest → roll shows the
  `+1 gear` term → unequip → boost gone.

## Balance knobs to validate in the live drive

- `PER_ABILITY_CAP` (+4 score / +2 modifier).
- `gearAbilityBonus` per-rarity values (`common 0, rare +2, epic +2, legendary +4`).
- Per-item ability assignments (coverage + flavor).

These are starting values, not gospel; the live drive is where we confirm gear
meaningfully tilts the odds without erasing the dice bands.
