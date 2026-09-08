# Act IV — Tactics & Stakes (RPG-depth roadmap) — plan

> Fourth act of the RPG-depth roadmap. Give the player **resources to spend** and **something to play against**. Needs Acts I–II (done). Server-first, additive-only, anti-shame law non-negotiable.

## Slice 1 — Consumables economy · epic payoff · **build first** (clean, upside-only)

Potions/scrolls/"second wind" you *choose* to burn on a hard day. Reuses `coin_balance` + the Honest-Coin `spendCoins` primitive; mirrors `stat-perks.ts` (a curated coin-priced catalog) but held as **inventory** and applied to the **next roll**.

- **`consumables.ts`** (pure): a curated `CONSUMABLES` catalog + `rollBoostFor(id)`. v1 items:
  - **Focus Draught** 🧪 — +3 to your next quest's roll.
  - **Lucky Clover** 🍀 — advantage on your next roll (roll twice, keep the higher).
  - **Second Wind** 🌬️ — reroll your next roll if it comes up low (keep the better).
- **roll-engine**: `resolveCheck` gains an optional `boost` (`{kind:"bonus",amount}` | `{kind:"advantage"}` | `{kind:"reroll"}`), applied **deterministically** from the seed (advantage = max of `seed` and `seed:adv`; reroll = if `d20 < threshold`, `max(first, seed:rr)`) so the roll stays stable and un-rerollable. Every boost is upside-only — it can only raise the band.
- **schema (migration 0016)**: `user_consumables` (userId, consumableId, qty; unique per pair) + `users.pending_consumable` (text, null) — the one item queued for the next roll.
- **completion path** (`tasks.ts` `rollCompletionCheck`): if a pending consumable is set and owned, apply its boost, then best-effort consume it (qty−−, clear pending). Surface the used item on the result.
- **route** `consumables.ts`: `GET /consumables` (balance + owned qty + pending), `POST /consumables/:id/buy` (spend → qty++), `POST /consumables/:id/activate` (queue for next roll; needs qty>0) + deactivate.
- **web**: a consumables panel — buy, and queue one for "your next quest". **iOS**: follow-up.
- **CoinReason**: add `consumable_buy`.

## Slice 2 — Attrition · rare payoff · **needs an anti-shame decision before building**

The roadmap wants a light **exhaustion** a broken streak imposes and a good run clears — `users.exhaustion` 0–3, +1 on streak break, −1 per strong day, with a *"small roll penalty while > 0"*. **This collides with the non-negotiable anti-shame law** (no band/roll may reduce a reward; a setback may only reframe or add upside). Reconciliation options to put to the user:

1. **Upside-framed "well-rested" (recommended)**: invert it — a good run grants a temporary *Rested* bonus (a small roll boost), and a broken streak simply means no bonus (never a penalty). Same felt "stake to keep" without any downside. Pairs naturally with consumables.
2. **Cosmetic weariness**: track exhaustion as flavor only (the companion/hero reads "weary"), with **no** mechanical roll effect — a narrative stake, not a numeric one.
3. **Literal roadmap**: a real small roll penalty while exhausted — **rejected unless the user explicitly overrides the anti-shame law**.

Do not build Slice 2 until the user picks; Slice 1 ships independently.

## Cross-cutting
- Determinism: consumable boosts are seed-derived so a completion still resolves identically on every client and can't be re-rolled by refetching.
- Tests: pure `consumables` + roll-boost math get exhaustive unit tests incl. the upside-only invariant (a boost never lowers the band/total).
- Client parity: server+web → main, iOS → swift branch, per the established cadence.
