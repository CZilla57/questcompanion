# World Boss (Co-op Raid) — Design

**Date:** 2026-07-15
**Act:** IV — Play Together (social + reward economy)
**Status:** Design approved, pending spec review

## Summary

A single **World Boss** appears each ISO week for the whole server. Players
**attack** it to chip a **shared HP bar** — damage from everyone accumulates on
the same bar. When the community collectively fells it, **every contributor
shares a bonus reward**. A player's **allies are highlighted** as their "raid
party," so the social layer (from the existing partnerships subsystem) rides on
top of a shared, server-wide encounter.

This delivers the **Co-op Bosses** half of the roadmap's *Guilds & Co-op Bosses*
quest (Act IV). "Guilds" is intentionally descoped: there is **no separate guild
entity** — a "party" is simply your accepted allies. The existing **solo weekly
boss stays exactly as-is**; the World Boss is a separate, additive encounter.

It is deliberately scoped to fit free-tier infra: **fully async**
(request/response only, no realtime, no new cron). Each player attacks on their
own time; defeat is resolved synchronously by the attack that crosses the HP
threshold.

## Key decisions (locked during brainstorming)

1. **Party = your allies** — reuse `partnerships`; no guild CRUD/invites/roles.
2. **Shared-HP chip-away combat** — a raid boss, not a summed single roll.
3. **Shared world boss** — one boss for everyone; solo weekly boss stays. Allies
   are a social lens, not a mechanical boundary (avoids friend-graph asymmetry).
4. **Daily attack cadence** — one attack per user per day (not per week), for
   throughput at small scale and a gentle daily re-engagement hook.

## Design Law: Anti-Shame (non-negotiable)

The World Boss is a source of shared delight, never leverage:

- Participation XP is **always** earned on every attack, regardless of whether
  the boss is ever felled.
- If the boss is **not** felled by week's end, there is **no punishment and no
  red "you failed" wall** — contributors simply keep the XP they already earned.
  The consolation *is* the participation reward.
- The daily attack is an **opportunity, never an obligation**. Missing days is
  never punished or surfaced negatively.
- **Allyless players fully participate** — the World Boss is never gated on
  having allies.
- The defeat reward is **flat for every contributor** (dealt ≥1 damage that
  week), not scaled by contribution — inclusive, no "you didn't pull your
  weight" framing.

## Data Model

Two new tables in `@workspace/db` (`lib/db/src/schema/`). All additive; pushed
live to the shared Neon DB (see shared-live-db discipline).

### 1. `world_boss_weeks` — one row per week

The shared boss for a given ISO week. Created **lazily** on the first view or
attack of a new week.

```
id          serial primary key
weekKey     text not null unique          -- e.g. "2026-W29" (ISO week)
hp          integer not null              -- snapshotted at creation from the HP curve
totalDamage integer not null default 0    -- denormalized running sum of all attacks
defeatedAt  timestamp                      -- null until the boss is felled
createdAt   timestamp not null default now
```

`unique(weekKey)` makes lazy creation an atomic `onConflictDoNothing` insert:
two concurrent first-attacks can't create two boss rows.

### 2. `world_boss_attacks` — one row per attack (append-only)

```
id         serial primary key
userId     integer not null references users(id)
weekKey    text not null                  -- denormalized for cheap per-week aggregation
dayKey     text not null                  -- e.g. "2026-07-15" (UTC day) — the dedup key
damage     integer not null               -- rolled at attack time
createdAt  timestamp not null default now
unique(userId, dayKey)                     -- atomic once-per-day dedup
```

`unique(userId, dayKey)` is the once-per-day guard, mirroring the solo boss's
`unique(userId, weekKey)` pattern: the insert **is** the dedup, so concurrent
attacks in the same day can't both land.

Contributors for a week = `SELECT DISTINCT userId FROM world_boss_attacks WHERE
weekKey = ?`. Per-user weekly contribution = `SUM(damage)` grouped by userId.

## Mechanics

All pure logic lives in a testable helper module
(`artifacts/api-server/src/lib/world-boss.ts`) with tunable consts, so the route
stays thin and the numbers are the economy's knobs.

### Week / day keys
- `weekKey` reuses the solo boss's ISO-week function (`getWeekKey`) — extract to
  a shared util so solo and co-op agree on week boundaries.
- `dayKey` = UTC `YYYY-MM-DD`.

### HP curve (the main balance knob)
- `worldBossHp(weekKey)` = fixed per week, gently escalating by week number,
  clamped: `min(HP_BASE + (weekNo - 1) * HP_STEP, HP_CAP)`.
- **Indicative tunable defaults:** `HP_BASE = 1500`, `HP_STEP = 300`,
  `HP_CAP = 5000`. Sized so a small group of geared players chipping daily over a
  week can fell it, while a lone player realistically cannot alone — preserving
  the co-op feel. These are starting values, expected to be retuned to turnout.
- Snapshotted into `world_boss_weeks.hp` at creation so mid-week the target is
  stable even if the curve is later retuned.
- **Flagged explicitly as the primary tuning knob.** Participant-scaling HP is a
  noted future option, not v1.

### Damage
- Reuse the solo combat model exactly: `getUserPower(userId)` (level + equipped
  gear `statPower`, via existing `calcBattlePower`) × a 75–125% roll
  (`round(power * (0.75 + random * 0.5))`).
- The random roll is injected through a seam so tests are deterministic.

### Attack flow (`POST /world-boss/attack`)
Inside one transaction:
1. Compute `weekKey`, `dayKey`, `damage`.
2. Lazily upsert the `world_boss_weeks` row (`onConflictDoNothing`, then select).
3. If the boss is **already defeated**, short-circuit → `{ attacked: false,
   reason: "defeated" }` (attacks close once felled).
4. Insert the `world_boss_attacks` row with `onConflictDoNothing` on
   `(userId, dayKey)`. No row returned → already attacked today → `{ attacked:
   false, reason: "already_today" }`.
5. Atomically accumulate: `UPDATE world_boss_weeks SET totalDamage = totalDamage
   + :damage WHERE weekKey = :weekKey RETURNING totalDamage`.
6. Award **participation XP** to the attacker (+`ATTACK_XP`), update level.
7. **Defeat check**: if `totalDamage` just crossed `hp` AND `defeatedAt` is still
   null, atomically claim the kill: `UPDATE world_boss_weeks SET defeatedAt =
   now WHERE weekKey = ? AND defeatedAt IS NULL RETURNING`. If this UPDATE
   returns a row (we won the race), **pay out every contributor**:
   for each `DISTINCT userId` in this week's attacks, `awardCoins(tx, userId,
   DEFEAT_COINS, "world_boss_defeat")` + add `DEFEAT_XP` + an activity row.
8. Log the attacker's activity row.

Because the defeat payout is guarded by `defeatedAt IS NULL … RETURNING`, exactly
one attack triggers it — no double payout under concurrency.

### Rewards (tunable consts — economy knobs)
- **Per attack:** `ATTACK_XP = 15` participation XP. **No coins** (avoids a daily
  coin farm; coins stay scarce and meaningful).
- **On defeat (each contributor, flat):** `DEFEAT_COINS = 50` + `DEFEAT_XP = 250`.
- Coins flow only through the existing `awardCoins(tx, …)` helper so the ledger
  invariant (`balance == sum(coin_transactions.amount)`) holds. New ledger
  reason: `"world_boss_defeat"`.

## API surface

New router `artifacts/api-server/src/routes/world-boss.ts`, mounted alongside
`battle`.

### `GET /world-boss/current`
Returns the viewer's snapshot of this week's boss:
```
weekKey, hp, totalDamage, defeated (bool), defeatedAt,
attackedToday (bool),
yourContribution (int),           -- your SUM(damage) this week
yourPower (int),                  -- previewed damage potential (level + gear)
contributors: [ { userId, displayName, avatarColor, avatar fields, damage,
                  isAlly (bool) } ]   -- ordered by damage desc, allies flagged
```
Boss row is created lazily here too, so the first viewer of a new week
materializes it.

### `POST /world-boss/attack`
Performs the attack flow above. Returns:
```
{ attacked: true, damage, totalDamage, hp, defeated, justDefeated,
  xpAwarded, coinsAwarded }      -- coinsAwarded > 0 only if this attack felled it
```
or `{ attacked: false, reason: "already_today" | "defeated" }` (HTTP 200 — not an
error wall; the client renders "come back tomorrow" / "already felled 🎉").

## UI (web)

A **World Boss card** on the battle/home surface (co-located with the solo boss),
plus optional dedicated view. Follows existing patterns (CoinChip animation,
battle card layout).

- **Shared HP bar** — framer-motion fill showing "X% felled this week," boss art,
  `totalDamage / hp`.
- **Attack button** — enabled once/day; on click, roll animation → your damage
  lands on the bar (optimistic then reconciled). Disabled with "Attack ready
  tomorrow" once `attackedToday`, "Defeated! 🎉" once felled.
- **Raid party panel** — contributor list with your allies highlighted (join
  `partnerships`). **Stretch (v1.1):** "nudge ally to attack" reusing the
  existing `ally_nudges` inbox/push system.
- **Defeated state** — victory celebration + reward toast; the header CoinChip
  refreshes via the existing coin-query invalidation on the attack that pays out.
- New hooks `useGetWorldBoss` / `useWorldBossAttack` from generated client;
  invalidate the boss query (and coins, on a felling attack) after attacking.

## Anti-shame & edge cases

- Participation XP is granted on every successful attack — the guaranteed floor.
- Never-felled boss → contributors keep participation XP; no negative surfacing.
- Allyless players participate fully; the raid-party panel simply shows the
  global contributors with none flagged as allies.
- Post-defeat attacks are rejected softly (`attacked:false, reason:"defeated"`),
  never an error.
- Concurrency safety mirrors the hardened solo boss: `unique(userId, dayKey)`
  insert-as-dedup for attacks; `defeatedAt IS NULL … RETURNING` claim for the
  single defeat payout; atomic `totalDamage` increment.
- New week rolls over implicitly by `weekKey`; a stale previous-week boss is
  simply never queried again (no cron reset needed).

## Testing

Mirrors the existing `battle` test approach.

**Pure helpers (`world-boss.ts`)** — unit tests:
- `worldBossHp` curve (escalation, clamp, week parsing).
- damage roll with injected RNG (min/max bounds at 0.0 / 1.0).
- `dayKey` / `weekKey` boundary behavior.
- defeat-threshold predicate (crossing detection).

**Route tests (`world-boss.ts`)**:
- attack accumulates `totalDamage` and inserts an attack row.
- **once-per-day dedup**: second attack same day → `attacked:false,
  already_today`, no extra damage.
- attack across a day boundary is allowed again.
- **synchronous defeat**: an attack that crosses `hp` sets `defeatedAt` and pays
  `DEFEAT_COINS` + `DEFEAT_XP` to **all** distinct contributors exactly once;
  coin ledger stays consistent.
- post-defeat attack → `attacked:false, defeated`, no further payout.
- `GET /world-boss/current` shape: contributors ordered by damage, allies
  flagged, `attackedToday`/`yourContribution` correct.
- anti-shame: participation XP granted even when the boss is not felled.

## Out of scope (v1)

- Named guilds, invites, roles, membership, leave/kick.
- Participant-scaled HP (fixed escalating curve for now).
- Contribution-scaled rewards (flat for all contributors).
- Cron-driven mid-week nudge pushes and push-on-defeat notifications.
- Nudge-ally-to-attack (listed as v1.1 stretch, may fold in if cheap).
- Overkill / boss phases / multi-week bosses.
