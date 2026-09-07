# Loot Tables & Treasure Reveals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`). Build **server-first**: mechanic in `artifacts/api-server`, exposed via OpenAPI → regenerated `api-zod` + `@workspace/api-client`, then web + iOS off the same types. No drop is native-only.

**Goal:** The second **second-wave** item of the D&D campaign layer. Turn the flat coin payout on an encounter fell into a **treasure reveal** — a seeded drop-table roll that, on top of the coins already granted, may award a **gear** item whose rarity scales with the foe's tier, surfaced to the client as a reveal moment. Reuses Phase-2 encounters (`routes/encounter.ts`, `routes/party.ts`), the seeded roll engine (`roll-engine.ts`), and the existing gear catalog + award logic (`gear-rewards.ts`).

**The design law (non-negotiable — anti-shame):** loot is **pure upside**. The fell already grants coins; a drop-table roll can only *add* — gear, or bonus coins, or nothing-extra (which still reads as "the field is yours," never "no loot / you failed"). No roll ever reduces the base coins or removes owned gear. A "common" drop is a gift, not a letdown. Extend the upside-only invariant tests.

**Architecture — one seeded roll, reuse the award path.**
1. **`loot-tables.ts`** (new pure lib) — per-tier drop tables + a **seeded** resolver `rollLoot({ tier, seed }) -> { rarity: GearRarity | null, bonusCoins }`. Seed from stable inputs (encounter id + tier + user) so the drop is fair, deterministic, and un-rerollable by refetching — same discipline as the skill-check seed.
2. **Reuse `roll-engine.ts`'s PRNG** — export a `seededUnit(seed) -> [0,1)` from it (built on the existing `hashSeed`); loot odds compare against it. One PRNG in the codebase, not two.
3. **Reuse `gear-rewards.ts`** — the fell awards gear at the rolled rarity through the existing unowned/empty-slot selection (generalize `awardStreakGear` to a shared `awardGear(userId, level, targetRarity, reason)` or add a thin loot wrapper). The `loot` result rides back on `EncounterHit` / `PartyEncounterHit` for the reveal.

**Tech stack:** existing api-server (Hono/Express + typed libs + Drizzle), OpenAPI → regenerated clients, web + iOS. Gated implicitly: loot only happens on an encounter fell, and encounters are already behind the campaign layer.

---

## Global Constraints
- **Server-first, additive-only.** Extend `EncounterHit` / `PartyEncounterHit` with an optional `loot` field; older clients ignore it and still show the coin/fell result. Never remove/repurpose existing fields.
- **Upside-only.** Loot adds; base `felledCoins` is untouched. Add drop-table cases to the upside-only invariant tests (a roll never lowers the coin payout; a null-rarity roll is valid and non-negative).
- **Determinism & fairness.** The loot roll is seeded from stable inputs (encounter id + tier), so it resolves identically on every client and in tests and cannot be re-rolled by refetching. Server rolls; clients reveal.
- **Reuse, don't duplicate.** One PRNG (`roll-engine`), one gear-award path (`gear-rewards`). No parallel rarity or RNG logic.
- **Test parity.** New lib gets `loot-tables.test.ts`; the resolver is exhaustively tested incl. tier→odds monotonicity and the anti-shame invariants.

## The drop tables (design — the registry in Task 1 is source of truth)
Per encounter tier, the probability of the best rarity the drop can be; higher tiers shift the odds up. A roll picks a rarity (or nothing-extra → small bonus coins). Illustrative:

| Tier | legendary | epic | rare | common | nothing-extra (→ bonus coins) |
|------|-----------|------|------|--------|-------------------------------|
| 1–2  | 0%        | 2%   | 12%  | 46%    | 40% |
| 3–4  | 1%        | 6%   | 22%  | 46%    | 25% |
| 5–6  | 3%        | 12%  | 30%  | 40%    | 15% |
| 7+   | 6%        | 18%  | 36%  | 32%    | 8%  |

Monotonic: the cumulative odds of *at least rare* never decrease with tier. "nothing-extra" still grants a few bonus coins so every fell feels rewarded.

---

## Phase 1 — The pure lib
### Task 1: `seededUnit` export + `loot-tables.ts` + tests
**Files:** modify `artifacts/api-server/src/lib/roll-engine.ts` (export `seededUnit`); create `loot-tables.ts`, `loot-tables.test.ts`.
- [ ] Export `seededUnit(seed: string): number` in `[0,1)` from roll-engine, built on the existing `hashSeed`. Add a determinism test.
- [ ] `loot-tables.ts`: the per-tier `LOOT_TABLES`, a `lootSeed(userId, encounterId, tier)` helper, and `rollLoot({ tier, seed }) -> { rarity: GearRarity | null, bonusCoins }`. Bonus coins ≥ 0 always.
- [ ] Tests: cumulative "≥ rare" odds monotonic in tier; a fixed seed is deterministic; `bonusCoins` never negative; a null-rarity roll is valid; every tier's table sums to 1.

## Phase 2 — Wire into the fell
### Task 2: award gear on fell + `loot` on the hit
**Files:** `routes/encounter.ts` (`chipPersonalEncounter`), `routes/party.ts` (`chipPartyEncounters`), `gear-rewards.ts` (generalize the award fn).
- [ ] On fell, after the existing `felledCoins`/`awardCoins`, roll `rollLoot`; if a rarity comes up, award gear via the shared gear-award path (reason `"loot_drop"`); add any `bonusCoins`. Wrap so a loot failure never fails the completion (best-effort, like the encounter chip itself).
- [ ] Add `loot?: { rarity, gear?: GearRewardInfo, bonusCoins }` to `EncounterHit` and `PartyEncounterHit`. Party loot is per-member (each feller rolls their own drop).
- [ ] Property test: total coins on fell ≥ base `felledCoins` (no regression); owned gear count never decreases.

### Task 3: OpenAPI + regenerated clients
**Files:** `lib/api-spec/openapi.yaml`, regenerate.
- [ ] Extend the `EncounterHit` / `PartyEncounterHit` schemas with the optional `loot` object + a `LootDrop` schema. Regenerate `api-client` + `api-zod`; typecheck. Never hand-edit generated files.

## Phase 3 — The reveal (clients)
### Task 4: web treasure reveal
**Files:** `artifacts/focusquest` completion toast/modal + the encounter cards.
- [ ] When a completion's result carries `loot` with gear, show a treasure reveal (rarity-colored) alongside the existing strike toast — "You found {gear} ({rarity})!". Bonus-coins-only reveals read as a small find, never "nothing".
- [ ] **Gate:** felling an encounter can reveal a gear drop colored by rarity; a no-gear fell still reads rewarding.

### Task 5: iOS treasure reveal
**Files:** `ios/FocusQuest/Features/Quests/CompletionSheet.swift` (+ encounter models).
- [ ] Decode the new `loot` on `EncounterHit`; show a reveal in the CompletionSheet (rarity-tinted, reduce-motion honored, accessibility label reads the item + rarity). Decode defensively so an older server (no loot) still shows the fell.
- [ ] **Gate:** felling on iOS reveals the drop; no-loot fells are unchanged.

---

## Cross-cutting
- **Testing:** pure `loot-tables` exhaustively unit-tested incl. anti-shame/monotonicity; the fell path gains a "coins never regress / gear never lost" property case.
- **Client parity:** web + iOS off the same regenerated types; the reveal animation may be richer on one client, the resolved drop is always the server's.
- **Reduce-motion / a11y:** the reveal honors reduce-motion; every drop has a text equivalent.

## Deferred (later second-wave items)
- Inventory & attunement depth; printable character-sheet export. Each independent and server-first.
