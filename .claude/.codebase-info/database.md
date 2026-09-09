# Database

*Last Updated: 2026-09-08*

## Overview

- **Engine:** PostgreSQL (hosted externally, reached via `DATABASE_URL`; SSL via a bundled Supabase pooler CA cert — see `lib/db/src/ssl.ts`, `lib/db/certs/`).
- **Access layer:** Drizzle ORM (`drizzle-orm/node-postgres`), schema-first. Client setup: `lib/db/src/index.ts` (creates a `pg.Pool`, wraps with `drizzle(pool, { schema })`, exports `db`/`pool`, re-exports the whole schema). No repository/DAO layer — every route/`lib/*` file in `artifacts/api-server` imports `db` and table objects directly from `@workspace/db` and writes Drizzle queries inline.
- **Schema source:** `lib/db/src/schema/*.ts` — one file per table (~35 files), barrel-exported from `lib/db/src/schema/index.ts`.
- **Migrations:** `lib/db/drizzle/*.sql` (19 files, `0000_baseline.sql` … `0018_last_thing.sql`) + `meta/_journal.json` and per-migration snapshots. Config: `lib/db/drizzle.config.ts`. Workflow: edit schema → `pnpm --filter @workspace/db generate` (drizzle-kit diffs against migration history, not the live DB) → commit the generated SQL + meta → `pnpm --filter @workspace/db migrate` (or automatic at container boot via `artifacts/api-server/src/migrate.ts`, which retries with backoff and distinguishes "DB unreachable" from "SQL actually broken" — see `src/lib/migration-failure.ts`). `drizzle-kit push` is deliberately not used (a documented drizzle-kit 0.31.10 bug around multi-column unique-constraint ordering risked table truncation).
- **Zod/insert schemas:** several tables export a `drizzle-zod`-derived `insertXSchema` alongside the table (e.g. `insertUserSchema`, `insertTaskSchema`, `insertCampaignSchema`) for server-side insert validation — distinct from the OpenAPI-generated `@workspace/api-zod` package used for request/response contracts (see `communication.md`).

## Key Tables (by subsystem)

### Identity / auth
| Table | Notes |
|---|---|
| `users` | The central entity. Profile + full gamification state (level, streaks, XP) + hero/avatar customization (class, skin, hair, build, face, beard, glasses, earrings) + living-companion pet state (`companionName`, `companionDisposition`, `bondQuestsCompleted`, monotonic/never-decremented) + coin economy (`coinBalance`, timed boost-expiry columns, all "derived active iff non-null and in the future") + notification prefs/quiet hours/push budget + progressive-unlock ("Gentle Door") state (`unlockAll`, `highestLevel`, monotonic). See `lib/db/src/schema/users.ts` — the file's inline comments double as a changelog of which "Act" added each column group. |
| `sessions` | `sid` (PK) / `sess` (jsonb) / `expire` — server-side session store backing cookie auth (not JWT). |
| `api_tokens` | Personal-access tokens for iOS Shortcuts/Pocket Gate; stores only `tokenHash` (sha256), soft-revoked via `revokedAt`. |
| `device_tokens` | Push provider tokens (`provider`: `expo`/`apns`, `platform`), unique on `(provider, token)`. |
| `push_subscriptions` | Web Push subscriptions (`endpoint` unique, `p256dh`, `auth`). |

### Quests / tasks
| Table | Notes |
|---|---|
| `tasks` | The quest entity. Difficulty ladder (`difficulty`, jsonb `difficultyVariants` easy/medium/hard rungs, `struggleScore`); full completion **snapshot** columns (`pointsAwarded`, `coinsAwarded`, `streakDaysBefore`, `badgesGrantedIds`, `gearGrantedIds`, …) so `/uncomplete` can reverse exactly what was granted; scheduling (`dueDate`, `dueTime`, `isAnchored`, `focusDate`); FK to `questlines` (`onDelete: set null`); offline-capture idempotency via `clientKey` + a partial unique index (`WHERE client_key IS NOT NULL`). |
| `task_steps` | Sub-checklist items, cascade-FK to `tasks` + denormalized `userId`. |
| `recurring_tasks` | Templates: `frequency` (weekly/monthly/yearly), `daysOfWeek`, `monthlyMode`/`dayOfMonth`/`weekOfMonth`/`monthOfYear`, `leadDays`. |
| `habit_streaks` | One row per `(userId, recurringTaskId)` — `currentStreak`/`longestStreak`/`totalCompletions`/`lastPeriodKey`. |

### Story / grouping layer
| Table | Notes |
|---|---|
| `questlines` | Goal groupings of tasks; `status` (active/completed); reward snapshot (`rewardXpAwarded`); optional FK to `campaigns` (`campaignId`, `chapterOrder`, `chapterBeat`). |
| `campaigns` | Long-horizon story arcs; `arcPremise`/`endingBeat` text is **snapshotted at creation**, never regenerated on read; `storySource` (`ai`/`curated`); `status` (running/set_aside/completed); a **partial unique index enforces one running campaign per user at the DB layer**, not just in the route. |
| `dm_beats` | Cached "Dungeon Master" daily narration (`kind`), `facts` jsonb, unique per `(userId, localDate, kind)` — dedup is the insert itself. |

### RPG progression (gear / feats / consumables / capital)
| Table | Notes |
|---|---|
| `gear_items` | Catalog: `slot` (weapon/helmet/armor/boots/accessory), `rarity` (common/rare/epic/legendary), `statPower`, `costXp`, `levelRequired`, `inStore` (false = drop-only treasure, excluded from the store). |
| `user_gear` | Ownership: `equipped`, `attuned` (D&D-style attunement, only meaningful while equipped); unique `(userId, gearItemId)` prevents duplicate ownership/stacking. |
| `user_consumables` | Potions/scrolls inventory; unique `(userId, consumableId)`; catalog itself lives in code (`artifacts/api-server/src/lib/consumables.ts`), not the DB. |
| `feat_activations` | Daily-cooldown log of *active* class-feat uses; unique `(userId, featId, localDate)`. Which feats are *unlocked* is derived from class + level (`class-feats.ts`), never stored. |
| `kingdom_points` | "Life Kingdoms"/capital system: monotonic (never-decremented) `lifetimePoints` per `(userId, kingdomId)`; capital tier is derived from the sum across kingdoms, computed at read time. |
| `coin_transactions` | Append-only signed ledger (`amount` +earn/−spend, `reason` enum), optional FK to `reward_store_items`. |
| `reward_store_items` | User-defined real-life rewards (`label`, `tier`, snapshotted `coinCost`). |
| `dopamine_rewards` | Short reward-text log ("dopamine menu"). |

### Bestiary / battle / encounters
*(No static "monsters" table — foes are generated/named at encounter-creation time from a code roster (`encounter-progress.ts`'s `FOES`), then recorded by name once felled; the bestiary is derived from encounter history, not seeded data.)*

| Table | Notes |
|---|---|
| `weekly_battles` | One solo boss fight per user per week (`powerScore`, `bossPower`, `roll`, `result`, `xpAwarded`). |
| `world_boss_weeks` + `world_boss_attacks` | One shared server-wide boss per ISO week (`hp`, `totalDamage`, `defeatedAt`, created lazily via `unique(weekKey)` + `onConflictDoNothing`); one attack row per user per day (`unique(userId, dayKey)` is the atomic once-per-day dedup — "the insert is the guard"). |
| `personal_encounters` | Solo bestiary foe per user; HP chipped by real quest completions; at most one active foe (partial unique on `felledAt IS NULL`). |
| `party_encounters` + `party_encounter_contributions` | Shared foe per accepted partnership (co-op reframe of the world boss) + per-member damage-contribution ledger. |

### Social
| Table | Notes |
|---|---|
| `partnerships` | Accountability-partner requests; `status`; unique on the **unordered pair** via `LEAST(requesterId, recipientId)`/`GREATEST(...)` so A→B and B→A collide correctly. |
| `ally_nudges` | Poke/cheer messages between allies; `readAt` null = unread. |
| `badges` + `user_badges` | Achievement catalog (`category`, `metric`, `requirement`) + per-user earn records. |
| `body_double_rooms` / `body_double_members` / `body_double_sprints` | Co-working rooms; membership with presence (`leftAt`, `lastSeenAt` touched by a poll); timed sprints (15/25/50 min) with a live-sprint uniqueness guard. |

### Focus / reflection / wellbeing
| Table | Notes |
|---|---|
| `focus_sessions` | Pomodoro sessions: config snapshot (`preset`, `focusMinutes`, `breakMinutes`, `longBreakEvery`, `plannedCycles`) + progress (`completedIntervals`, `focusedSeconds` — server-derived, not client-trusted); optional FK to `tasks`. |
| `brain_checkins` | One-tap mental-state check-ins (`mode`: focused/distracted/frozen/hyperfocus/neutral; `source`: tap/daily_prompt/emergency_exit). |
| `rescue_events` | Logged "unstuck" interventions (`blocker`, `intervention`), optional FK to `tasks`. |
| `reflections` | One per user per local day; evening prompt/answer, `chips` jsonb, free text. |
| `initiation_awards` | One-time "first move" award grants (`kind`, `refId`), race-safe unique index. |
| `weekly_recaps` | AI weekly-recap emails; `stats` jsonb snapshot; `skipped`/`sentAt`. |
| `activity` | Generic activity-feed rows (`type`, `description`, `points`). |

## Relationships

```
users ──1:N── tasks ──1:N── task_steps
users ──1:N── recurring_tasks ──1:1── habit_streaks
users ──1:N── questlines ──N:1── campaigns (optional)
users ──1:N── user_gear ──N:1── gear_items      (unique per user+item)
users ──1:N── user_consumables
users ──1:N── feat_activations
users ──1:N── kingdom_points (per kingdomId)
users ──1:N── coin_transactions ──N:1── reward_store_items (optional)
users ──1:N── personal_encounters
users ──1:1(active)── world_boss_attacks (daily) ──N:1── world_boss_weeks (weekly, server-wide)
users ──N:M── partnerships (unordered pair, unique)
partnerships ──1:1(active)── party_encounters ──1:N── party_encounter_contributions ──N:1── users
users ──1:N── focus_sessions ──N:1── tasks (optional)
users ──1:N── badges (via user_badges)
users ──1:N── device_tokens / push_subscriptions / api_tokens / sessions
```

**Cross-cutting patterns worth knowing before writing a migration:**
- Almost everything FKs to `users.id`; newer tables use `onDelete: "cascade"`, some older ones use a bare `references()` with no cascade — check the specific table before assuming cascade behavior.
- Several "exactly one active X" or "once per period" invariants are enforced with a **partial unique index** rather than app-level locking (e.g. one running campaign per user, one un-felled personal encounter per user, one world-boss attack per user per day). Prefer this pattern for new once-per-period mechanics.
- Monotonic/never-decrement columns (`bondQuestsCompleted`, `kingdom_points.lifetimePoints`, `users.highestLevel`) are a deliberate **anti-shame invariant** — see `patterns.md`. Never add a code path that decrements one of these outside an explicit, documented reversal transaction.
