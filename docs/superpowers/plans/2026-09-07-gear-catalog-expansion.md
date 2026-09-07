# Plan — Gear Catalog Expansion (rarity ⊥ level)

**Date:** 2026-09-07
**Branch:** `claude/dnd-gear-catalog` (off `main`). Server + data only — no iOS/web UI changes required; both clients render whatever the API returns.

## Why

The catalog is 20 items and rarity is welded to level (all legendaries are lvl 22+). That starves the systems built on top of it:

- **Attunement barely engages** — accessory has no epic/legendary and boots has no legendary, so a player can't equip more than ~4 attunable items; the "pick 3 of your magic items" choice rarely bites.
- **Loot reveals go stale** — only 4 epic + 4 legendary items, unique-owned, so high-level players exhaust the pool.
- **No lucky finds** — the drop engine (`awardStreakGear`) already filters by `levelRequired ≤ userLevel` and takes the rolled rarity independently, so a lvl-3 hero rolling "legendary" *would* receive one — **if any existed at low level.** None do.

## Design

### 1. Decouple rarity from level

- **Level** = the item's power tier and its `levelRequired` gate (when a hero can receive/use it).
- **Rarity** = drop-rarity + magic quality + attunement eligibility (epic/legendary attunable) + store price tier. It no longer implies level.
- A hero can luck into a **legendary lvl-3 dagger**: low absolute power (it's a level-3 item) but rare, attunable, and uniquely named — a genuine early-game treasure. The drop code already supports this; the catalog just needs the item to exist.

### 2. Power formula (single source of truth)

`gearStatPower(levelRequired, rarity)` — level dominates, rarity is a modest multiplier:

```
base(level)  = 3 + 1.05 * levelRequired
rarityMult   = { common: 1.0, rare: 1.15, epic: 1.3, legendary: 1.5 }
statPower    = round(base(level) * rarityMult[rarity])
```

Sanity: lvl1 common → 4 (matches Rusty Sword today); lvl5 rare → 9; lvl12 epic → 19; lvl3 **legendary** → 9 (vs lvl3 common 6 — a ~50% edge, plus attunable). Multipliers are tunable in one place. **All statPowers (existing + new) are regenerated from this** so the curve is coherent; re-seed updates owned items' power in place (negligible battle-power shift, pre-launch-acceptable). *Decision: regenerate all rather than leave the legacy 20 on a different curve.*

### 3. Store vs drop-only (the `inStore` flag)

Adding exotic off-diagonal items (a lvl-3 legendary for 400 coins purchasable by any lvl-3 hero) would break the Honest-Coin price ladder and make lucky drops un-special. So:

- **`inStore: true`** — a curated "standard ladder" where rarity roughly tracks level (the reliable buy-your-way-up path; the existing 20 items, lightly filled so every slot has a clean common→legendary progression). Priced by the existing rarity ladder (20/60/150/400). Honest Coin intact.
- **`inStore: false`** — the exotic treasures: high-rarity at low/mid level, and flavorful uniques. **Drop-only — never sold.** This is what makes finds exciting and distinct from shopping.

New boolean column `gear_items.in_store` (default true) → migration **0014**. The store query filters `in_store = true`; `awardStreakGear`/loot use the full pool (no filter). *Decision: recommended over pricing exotics into the store; simpler alternative is to skip the flag and list everything, which I don't recommend.*

### 4. Sprite reuse (hard constraint)

`seed-gear.ts` throws if a `spriteId` doesn't resolve for **both** builds. Only 18 gear sprites exist: weapon {sword, greatsword, staff, slingshot, excalibur, archmage-staff}, helmet {cap, helm, greathelm, crown}, armor {leather-armor, mail, plate, dragon-plate}, boots {shoes, boots, greaves}, accessory {cape, amulet}. **Every new item reuses one of these** (by slot). On-hero sprites will therefore repeat within a slot — acceptable; net-new sprite art is a separate future task. `icon` (lucide) can still vary for list UIs.

### 5. Naming / flavor

Unique, evocative names at every rarity — including magic-feeling low-rarity/low-level items (e.g. a common but enchanted trinket). "Magic" is conveyed by name/description; mechanically it maps to rarity (rare+ = magic, epic+ = attunable). No separate `magic` column in v1 (fold into rarity; a display ✨ tag is a possible later nicety).

### Coverage target (~45 items)

Every slot × every rarity obtainable, spread across level bands early(1–4)/mid(5–12)/high(13–20)/elite(21–30). Fill the current holes (accessory epic+legendary, boots legendary) and add ~5 drop-only low-level exotics per slot. Sample flavor:
- common: "Rusty Sword", "Chipped Buckler Charm"
- rare: "Knight's Blade", "Whisperstep Boots"
- epic: "Zweihänder", "Stormcaller Amulet"
- legendary: "Excalibur", "Featherfall Slippers", "Duskfang Dagger (lvl 3)" ← the lucky low-level find

## Tasks

1. **Power formula** — add `gearStatPower(levelRequired, rarity)` to `scripts/src/gear-catalog.ts` and generate every row's `statPower` from it.
2. **Schema + migration** — `gear_items.in_store boolean not null default true` (`lib/db/src/schema/gear.ts`); `pnpm generate` → migration **0014** (journal + snapshot committed — see [[drizzle-migration-meta]]); `npx tsc` in `lib/db`.
3. **Expand `GEAR_CATALOG`** — grow to ~45 items per the coverage target; each carries `inStore` and a reused `spriteId`. Curated ladder `inStore:true`; exotics `inStore:false`.
4. **Store filter** — `GET /gear/store` filters `eq(in_store, true)`. Loot/`awardStreakGear` unchanged (full pool). No client regen (server-side filter; no new response fields).
5. **Seed pre-flight validation** — extend `seed-gear.ts`'s pre-flight to assert invariants and fail loudly: every (slot × rarity) obtainable; `statPower` non-decreasing in level within a rarity; every `spriteId` resolves (already checked). Doubles as the "test" (scripts has no vitest harness).
6. **Rollout** — deploy migration 0014 (Render auto-runs on boot), then run `pnpm --filter @workspace/scripts seed-gear` against the deployed DB (idempotent upsert by name; updates statPower + sets in_store). Verify a store fetch (no exotics) and a drop (exotics reachable).

## Risks / notes

- Re-seed **updates** existing items' `statPower` → owned gear's contribution shifts a little; fine pre-launch.
- `costXp` is vestigial (cost is `gearCoinCost(rarity)`); leave as-is.
- Salvage value stays rarity-based, so a drop-only legendary salvages for 160 — no buy→salvage arbitrage (it can't be bought); acceptable.
- No iOS/web code changes; more items simply flow through existing store/inventory lists.
