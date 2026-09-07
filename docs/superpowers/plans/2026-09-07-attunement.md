# Plan — Attunement (D&D second wave, deferred half of item 3)

**Date:** 2026-09-07
**Branches:** server+web `claude/dnd-attunement` (off `main`); iOS `claude/dnd-ios-attunement` (off `swift-mobile-app-a70k2k`).

## Why

The inventory PR (#122/#123) shipped the owned-gear view + salvage but deferred *attunement-as-power*. This adds it: the classic 5e attunement cap turned into an **upside-only** power layer on top of the gear we already have.

## Design (anti-shame, upside-only)

- **Attune up to 3 items** (`ATTUNEMENT_CAP = 3`, the 5e cap). Attuning draws extra battle power from a magic item.
- **Only epic/legendary** gear is attunable — attunement is for magic items; common/rare are not.
- **Attune requires the item to be equipped.** This keeps the existing rule ("only equipped gear affects battle power") intact: attunement amplifies gear you actually wear. Unequipping an item **auto-unattunes** it (equipping a replacement in a slot unattunes the item it displaces).
- **Bonus = `ceil(statPower / 2)`** added to battle power per equipped+attuned item. Purely additive — it never reduces base power, and not attuning is simply neutral (no penalty, no shame).
- **Meaningful choice:** once you equip more than 3 epic/legendary items (across the 5 slots), you pick which 3 to attune.
- **No campaigns gate** — like inventory/salvage, this is depth over gear everyone owns.

## Tasks

1. **Pure lib + tests** — `artifacts/api-server/src/lib/attunement.ts`:
   - `ATTUNEMENT_CAP = 3`; `isAttunable(rarity)` (epic|legendary); `attunementBonus(statPower) = Math.ceil(statPower / 2)`.
   - `gearPower(equipped: {statPower, rarity, attuned}[])` = Σ statPower + Σ bonus for items that are attuned **and** attunable. This is the single source of truth both battle-power sites call.
   - Tests: cap is 3; only epic/legendary attunable; bonus is half rounded up; gearPower adds the bonus only for attuned+attunable; base unchanged when nothing attuned; `gearPower ≥ Σ statPower` always (upside-only); a defensively-attuned common contributes no bonus.
2. **Schema + migration** — add `attuned boolean not null default false` to `user_gear` (`lib/db/src/schema/gear.ts`). Generate drizzle migration **0013** (must include `meta/_journal.json` + snapshot — see [[drizzle-migration-meta]]). Rebuild lib/db decls (`npx tsc` in `lib/db`). Render auto-runs migrations on boot.
3. **Routes** (`routes/gear.ts`):
   - `POST /gear/:id/attune` — owned + equipped + attunable + under cap → set `attuned=true`. Errors: 403 not owned; 409 not equipped ("Equip it first"); 409 not attunable ("Only epic and legendary gear can be attuned"); 409 cap reached ("All 3 attunement slots are full"). User-locked tx; the cap re-checked inside the tx.
   - `POST /gear/:id/unattune` — set `attuned=false`.
   - **Equip/unequip:** unequip sets `attuned=false`; equip's same-slot displacement sets the displaced rows `attuned=false` too.
   - **Battle power:** `buildHeroLook` (avatar.ts) and `getUserPower` (battle.ts) both call `attunement.gearPower(...)` with equipped rows (extend battle.ts's select to include `userGear.attuned`). Add `attunementBonus` onto each `equippedGear` entry.
   - **Inventory endpoint:** add `attuned`, `attunable`, `attunementBonus` per item and `attunedCount` + `attunementCap` on the response.
4. **OpenAPI + regen** — attune/unattune paths; extend `InventoryItem` (+attuned/attunable/attunementBonus) and `InventoryResponse` (+attunedCount/attunementCap); extend `EquippedGearItem`/avatar with `attunementBonus`. `cd lib/api-spec && pnpm codegen`.
5. **Web** — in the Inventory tab: an Attune/Unattune control on equipped epic/legendary items (disabled with a reason when the cap is full or the item is unequipped), the bonus shown on attuned items, and an "N/3 attuned" line in the loadout summary. Battle power already flows from `/avatar`.
6. **iOS** — attune/unattune in `InventoryView` + models (`attuned`/`attunable`/`attunementBonus`, `attunedCount`/`attunementCap`) and `HeroService.attuneGear`/`unattuneGear`. Branch off `swift-mobile-app`.

## Conventions

- Pure-lib tests only (no route harness). After the schema change, `npx tsc` in `lib/db`. Client regen: `cd lib/api-spec && pnpm codegen`. iOS on the swift-mobile-app line, never main.
