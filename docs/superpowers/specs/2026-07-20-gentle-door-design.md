# The Gentle Door — first-run pacing (Act VII quest 5)

**Date:** 2026-07-20 · **Status:** awaiting Chad's approval · **Parent:** `2026-07-19-act7-consolidation-design.md` (Quest 5)
**Depends on:** Quest 2 (The Now Screen, PR #68 — merged; nav gating rides on its
`NAV_GROUPS` single source of truth) and Quest 3 (Honest Coin, PR #71 — merged; the
Rewards hub is the L6 reveal).

## 1. Problem

Two doors slam at minute zero, then every door in the castle is open at once:

- **An irreversible identity decision.** `OnboardingScreen` (`App.tsx:94`) warns
  *"You can't change it later."* — and the server makes it true: `PATCH /users/me`
  (`routes/users.ts:48`) has no rename path worth the name (no format validation, a raw
  unique-violation 500 on collisions, no rate limit — the client string-matches the
  error text for "409"/"unique"/"duplicate"). For a perfectionism-prone audience the
  warning converts a text field into a threat.
- **All 27 features at once.** A fresh account lands on the full 7-group nav (Home,
  Quests, Focus, Progress, Hero, Allies, Rewards), a coin chip for an economy they
  haven't met, a World Boss they can't dent, kingdoms with nothing in them, an empty
  leaderboard. The game's own grammar — levels — already paces progression but gates
  nothing.

## 2. Design principles

- **The game reveals itself.** Locked features are *invisible* — no grayed entries, no
  "unlocks at level N" teasers, no countdowns, no nags (anti-shame law; the charter
  allows quiet labels but invisibility is calmer and v1 ships it).
- **Unlocks are monotonic.** Once a door opens it never closes again — mirrors the
  bond/kingdom/capital grammar. XP reversal (`/uncomplete`) must not re-lock a feature
  the user has seen.
- **Pacing, not authorization.** Gates are a presentation-layer device. API data
  endpoints stay open; deep links redirect quietly; nothing 403s. Failure direction is
  *open* (a gap in data shows more, never less).
- **Existing users feel nothing.** Grandfathering is structural (a flag whose default
  covers every existing row at migration time), not data-dependent (no reliance on
  current users' XP).
- **No new onboarding steps, no tutorial content, no XP-curve changes** (charter's
  out-of-scope list).

## 3. The ladder

Levels derive from `getLevelInfo(totalPoints)` (`lib/gamification.ts`) — the stored
`users.current_level` column stays write-only, as today. Existing bands, unchanged:

| Gate | Level | XP threshold | Reveals |
|---|---|---|---|
| — | 1 | 0 | Home (Now), Quests group (Today/Questlines/Recurring), quick add + voice, streak, brain check-ins, momentum, rescue, difficulty, reflection, notifications, badges |
| `focus` | 2 | 100 | Focus group (timer page; reached only via nav — task-row "Today's Focus" pins are the unrelated L1 pin feature) |
| `hero` | 3 | 250 | Hero group (avatar page: customization, care, companion, gear) |
| `progress` | 4 | 500 | Progress group (Progress + Insights tabs, incl. Kingdoms + rhythms) |
| `allies` | 5 | 850 | Allies group (Allies + Leaderboard tabs) + World Boss panel on Hero page |
| `rewards` | 6 | 1300 | Rewards group (Treats/Store/Perks) + coin chip. Coins **earn silently from L1** (award paths untouched), so the wallet is full at reveal |

Feature keys deliberately equal `NavGroupKey` values (`home`/`quests` are always-on and
never appear in the list). Anything not named above is L1 core.

## 4. Server: one pure module + one derived field

**New pure lib** `artifacts/api-server/src/lib/feature-gates.ts` (unit-tested, no I/O):

```ts
type FeatureKey = "focus" | "hero" | "progress" | "allies" | "rewards";
const FEATURE_GATES: Record<FeatureKey, number> = { focus: 2, hero: 3, progress: 4, allies: 5, rewards: 6 };
effectiveLevel(u): number            // max(getLevelInfo(u.totalPoints).level, u.highestLevel)
unlockedFeatures(u): FeatureKey[]    // all five when u.unlockAll; else by effectiveLevel
isFeatureUnlocked(u, key): boolean
newlyUnlocked(u, beforeLvl, afterLvl): FeatureKey[]  // ALWAYS [] when u.unlockAll
```

- `GET /users/me/stats` gains **`unlockedFeatures: FeatureKey[]`** (required). Stats is
  already fetched by `OnboardingGate` on every load and invalidated on every completion
  (`task-item.tsx:108/121`) — zero new requests, nav updates ride the existing cycle.
- **Task completion** (`routes/tasks.ts` complete tx) and **questline claim**
  (`routes/questlines.ts`) responses gain **`newlyUnlocked: FeatureKey[]`** — the gates
  crossed by that award, computed from effective level before/after inside the tx.
  Other XP raisers (initiation grant, reflection claim, battle attack) unlock silently —
  the nav simply appears on the next stats refetch; no celebration hook exists on those
  paths today and none is added (recorded as accepted).
- **Grandfathered users get `newlyUnlocked: []` always** — an existing user leveling
  5→6 must not be congratulated for "unlocking" a Rewards hub they've used for weeks.

## 5. Monotonic floor (the uncomplete edge)

`POST /tasks/:id/uncomplete` reverses XP, so derived level can drop back across a gate
(unlock Focus at 100 XP → uncomplete → 99 XP). A vanishing nav entry is a shame moment.

**New column `users.highest_level integer NOT NULL DEFAULT 1`**, written in exactly one
place: the uncomplete transaction sets
`highestLevel = max(user.highestLevel, levelBeforeReversal)` *before* subtracting points
(`routes/tasks.ts:~998`, alongside the existing snapshot reversal). Forward progress
needs no writes — derived level covers it; the floor only matters when XP goes down, and
XP only goes down there. Gates read `effectiveLevel = max(derived, highestLevel)`.

## 6. Grandfathering

**New column `users.unlock_all boolean NOT NULL DEFAULT true`.**

- The migration's default stamps `true` onto every existing row — grandfathering is
  done the moment the column exists. No backfill step, no XP assumptions (the charter's
  "all current users exceed the top gate" is true today but is not load-bearing).
- The **only** user-creation path (`upsertGameUser`, `routes/auth.ts:102`) explicitly
  inserts `unlockAll: false` — new accounts get the gentle door. Any unforeseen insert
  path fails open (DB default `true` = today's behavior).
- Not exposed to the client except through the fully-populated `unlockedFeatures` list.

Approaches considered: **(a) default-true flag — chosen** (structural, XP-independent,
fail-open); (b) level-derived only (charter's alternate; rejected — acceptance demands
"existing accounts see no change" and that must not depend on live users' XP); (c)
`createdAt` cutoff (rejected — magic date, untestable).

## 7. Client: filter, guard, celebrate

- **Nav filtering** (`layout.tsx`): `useGetMyStats({ tz })` (cache-shared with
  `OnboardingGate`, same key). Visible groups = `home`, `quests`, plus groups whose key
  is in `stats.unlockedFeatures`. `stats` unavailable (offline shell, cold start) →
  show **all** groups (fail open; a grandfathered user offline must not lose chrome, and
  for a fresh user it's pacing, not security). Applies to sidebar, mobile bottom bar
  (still ≤5 entries — L1 shows Home+Quests), and `activeGroupKey` consumers untouched.
- **Route guard**: a small `ROUTE_FEATURE` map in a new client lib
  (`focusquest/src/lib/feature-gates.ts`) — `/focus→focus`, `/avatar→hero`,
  `/progress|/insights→progress`, `/partners*|/leaderboard→allies`,
  `/rewards/*→rewards`. A `<GatedRoute>` wrapper in `App.tsx`: stats loaded ∧ locked →
  `<Redirect to="/" />`; stats missing → render. No level numbers client-side.
- **Celebration**: the level-up dialog (`now.tsx:286`, fed by `task-item.tsx`
  `onLevelUp`) renders, when `newlyUnlocked` is non-empty, an "Unlocked" section under
  the level name — nav label + nav icon per feature (e.g. "Unlocked: Focus"). The
  questline-claim toast (`questline-detail.tsx:62`) appends "— Focus unlocked!" when its
  response carries keys. Copy celebrates the door opening; it never previews the next one.
- **Embedded surfaces**:
  - `CoinChip` (both layout headers) renders `null` and skips its query while `rewards`
    is locked. Completion toasts: verify no coin copy leaks pre-L6 (none known — coins
    surface only in the chip and Rewards pages today).
  - `WorldBossPanel` (`avatar.tsx:844`) renders only when `allies` is unlocked (its
    host page needs `hero`; the panel additionally needs `allies` per the charter).
  - `StatusRow` (Now) keeps its line but drops the `/progress` link (plain, non-nagging
    text) while `progress` is locked.
  - Gear-reward toasts (`task-item.tsx`) say "equip it on your Hero page" / "check your
    Hero page" — a 3-day streak gear drop can land below 100 XP, i.e. before the Hero
    page exists. While `hero` is locked the toasts keep the celebration but say the item
    "joined your inventory" instead of pointing at a door that isn't there.
  - `useGetNudges` polling in `layout.tsx` gains `enabled: alliesUnlocked` (no ally
    badge chatter for a nav entry that doesn't exist).
- **Fresh-account L1 dashboard** (acceptance surface): prompt chips, Today's Focus,
  quick add, outbox, quest list, StatusRow (unlinked), decay warning — all L1-core,
  unchanged. Nothing on Now references a locked feature.

## 8. Rename

- **Copy**: `App.tsx:94` becomes "This is the name other players will see. You can
  change it later." (The threat dies; the leaderboard clause goes — at L1 there is no
  leaderboard to point at.)
- **Server** (`PATCH /users/me`, same endpoint, hardened): when `username` present and
  ≠ current —
  1. **Format**: `/^[a-zA-Z0-9_]{3,20}$/` (the client's `USERNAME_REGEX`, now enforced
     server-side) → 400 on failure.
  2. **Cooldown**: if `onboardingComplete` (i.e. this is a rename, not the onboarding
     set) and `usernameChangedAt` is within 7 days → **429**
     `{ error, renameAvailableAt }`. The onboarding set does **not** start the clock
     (`usernameChangedAt` stays null) — a minute-zero typo is fixable immediately; the
     7-day meter starts at the first real rename.
  3. **Uniqueness**: catch Postgres `23505` → **409** `{ error: "That hero name is
     already taken." }` (today's raw 500 dies; the client stops string-sniffing).
  - A successful post-onboarding rename writes `usernameChangedAt = now`. Same-name
    PATCH is a no-op 200 (clock untouched). New column
    `users.username_changed_at timestamp` (nullable).
- **Responses**: `formatUser` (GET/PATCH `/users/me`) gains
  `renameAvailableAt: string | null` (null = available now).
- **UI**: the Hero page gains a small identity row (current hero name + pencil) opening
  a rename dialog — same validation as onboarding; on cooldown the dialog quietly shows
  "You can rename again on {date}" (info inside an opened dialog, not a nag on the
  page). Hero unlocks at L3, two levels before the name becomes social at L5 — and the
  name appears nowhere a pre-L3 user can see. Leaderboard/ally/activity surfaces already
  read the live username by user id; renames propagate for free.

## 9. Notifications while doors are closed

`heroCareCandidate` (`lib/notification-scheduler.ts:116`) returns `null` for users
whose `hero` feature is locked — a "your hero is hungry" push aimed at someone who has
never seen the hero (and has no feeding UI) is confusion shaped like shame. That single
guard covers all three hero-category producers (hunger warnings, companion
streak-milestone pushes, and flavor vignettes — all live inside `heroCareCandidate`).
The milestone-marker maintenance write is skipped too while locked; a stale marker can
only *suppress* a celebration, never spam one — the safe direction.
Protection/reminder/reflection categories are L1 features and stay untouched.
Ally/boss pushes require partnerships/contributions that locked users cannot have; no
guard needed.

## 10. Data & API changes (summary)

- **Migration `0003_gentle_door`**: `users` + `unlock_all boolean NOT NULL DEFAULT true`,
  `username_changed_at timestamp` (nullable), `highest_level integer NOT NULL DEFAULT 1`.
  Additive only; applied to live Neon via `db migrate` before merge (shared-DB rule:
  nothing else unmerged is live).
- **openapi.yaml**: `MyStats` + required `unlockedFeatures` (enum array);
  `TaskCompletionResult` + required `newlyUnlocked`; `QuestlineClaimResult` + required
  `newlyUnlocked`; `User` + required nullable `renameAvailableAt`; PATCH `/users/me`
  documents 400/409/429. Then `pnpm --filter @workspace/api-spec codegen`.
- **No server-side 403s, no new endpoints, no cron shape changes.**

## 11. Acceptance (charter + additions)

1. Fresh account: nav shows exactly Home + Quests; `/focus` deep link lands on `/`;
   no coin chip; no World Boss panel; Now screen renders only L1 modules.
2. Crossing 100 XP via completion: response `newlyUnlocked: ["focus"]`, level-up dialog
   shows "Unlocked: Focus", nav gains Focus without reload.
3. Uncomplete back below 100 XP: Focus stays unlocked (floor holds).
4. Grandfathered account: all five features present, `newlyUnlocked` always `[]`,
   pixel-identical UI, rename available.
5. Rename: onboarding set free; first rename free; second rename inside 7 days → 429
   with `renameAvailableAt`; duplicate name → 409; bad format → 400; leaderboard shows
   the new name immediately.
6. Onboarding copy contains no "can't change it later"; no surface anywhere renders a
   locked-feature name, level requirement, or countdown (grep-level check).
7. Locked-hero users produce no hero-category push candidates.
8. `xp-monotonicity` standing guard still green (no new XP writers).
