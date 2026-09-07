# Plan — Inventory & Salvage (D&D second wave, item 3)

**Date:** 2026-09-07
**Branches:** server+web `claude/dnd-inventory` (off `main`); iOS `claude/dnd-ios-inventory` (off `swift-mobile-app-a70k2k`).

## Why

Third second-wave item after Class Feats and Loot Tables. The campaign-layer plan deferred *"Inventory & attunement depth on the existing gear slots."* Loot drops now push gear (incl. legendaries) into `user_gear`, but there is **no owned-only inventory view** — the Gear Store lists everything with owned/equipped flags, and iOS has only the store list. Owned gear also accumulates with no way to convert clutter back to value.

This ships a dedicated **Inventory** surface (owned gear, grouped by slot, sortable, with a loadout summary) plus a **salvage** action that turns an unwanted owned item into coins. Attunement-as-power is intentionally deferred — the user chose "inventory view first."

## Design (anti-shame, upside-only)

- **Inventory is read-only depth over existing tables** — no new table. It groups a user's `user_gear` rows by slot, marks the equipped item per slot, and reports each item's salvage value + a loadout summary (equipped count, total equipped statPower = the gear component of battle power).
- **Salvage** = permanently give up an owned, **unequipped** item for coins. Refund is a fraction of the item's buy cost so there is **no arbitrage** (salvage value < buy cost always). Framed as "recover coins", not "destroy". Equipped items cannot be salvaged (must unequip first) — protects the loadout from an accidental tap.
- Salvage value ladder (⌊40% of `GEAR_COIN_COST`⌋): common 8, rare 24, epic 60, legendary 160.
- Loot-dropped gear is free, so salvaging it is pure upside; that is intended (loot → coins sink-to-source), and modest enough not to distort the economy.
- **No campaigns gate.** Unlike Feats/Loot, inventory is plumbing over gear everyone already has; gating it would hide items users own. Salvage is likewise always available.

## Tasks

1. **Pure lib + tests** — `artifacts/api-server/src/lib/salvage.ts`: `SALVAGE_VALUE: Record<GearRarity, number>` and `salvageValue(rarity)` derived as `Math.floor(gearCoinCost(rarity) * 0.4)`. Tests: monotonic by rarity, always ≥ 1, always strictly `< gearCoinCost` (no-arbitrage invariant).
2. **CoinReason** — add `"gear_salvage"` to the `CoinReason` union in `lib/db/src/schema/coin-transactions.ts` (text column, TS-only `$type`, **no SQL migration**). Rebuild lib/db decls (`npx tsc` in `lib/db`).
3. **Routes** — in `routes/gear.ts`:
   - `GET /gear/inventory` → owned items (joined gear detail) with `equipped`, `salvageValue` per item, and a `loadout` summary `{ slots: [{slot, equipped item|null}], equippedCount, equippedPower }` + `coinBalance`.
   - `POST /gear/:id/salvage` → tx: lock user row, verify owned + **not equipped** (409 if equipped, 403 if not owned), delete the `user_gear` row, `awardCoins(tx, …, "gear_salvage")`, activity row `gear_salvaged`. Return `{ salvaged, coinsGained, balance }`.
4. **OpenAPI + regen** — add both paths + `InventoryResponse`/`SalvageResult` schemas; `cd lib/api-spec && pnpm codegen` (regstenerates api-zod + api-client-react).
5. **Web** — new "Inventory" tab on the avatar page (beside Store/Battle): owned gear grouped by slot, sort (power/rarity), equip/unequip inline, and a **Salvage** action with a confirm dialog showing the coins gained. Reuse the existing `GearCard`/rarity styling.
6. **iOS** — `InventoryView` + `InventoryService` (hand-written models like Feats/Loot), reachable alongside the Gear Store. Owned gear grouped by slot, equip/unequip, salvage with a confirmation alert. Build green; live-verify only after server merges to main + deploys. Branch off `swift-mobile-app-a70k2k`.

## Conventions (from Feats/Loot builds)

- No route-test harness — pure-lib `*.test.ts` only.
- After a schema/type change in `lib/db`, run `npx tsc` in `lib/db` so `@workspace/db` decls rebuild (dist is gitignored; api-server tsc reads decls).
- Client regen: `cd lib/api-spec && pnpm codegen`.
- iOS lives on the `swift-mobile-app` line, never main; back-merge main after the server feature lands.
