# Class Feats — a level-unlocked ability layer over the Character Sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Build **server-first**: land the mechanic in `artifacts/api-server`, expose it through OpenAPI → regenerated `api-zod` + `@workspace/api-client`, then render web + iOS off the same generated types. No feat is native-only.

**Goal:** The first **second-wave** item of the shared D&D campaign layer. Give each hero **class** (fighter / mage / ranger / healer) a small ladder of **feats** unlocked as they level — a mix of always-on **passive** boosts and once-a-day **active** abilities (the plan's "Mage *Focus Surge*", "Ranger *Trailblazer*"). Feats are **layered on the existing Stat Perks** (`stat-perks.ts`): an active feat grants one of the boost windows the perks already use, but *earned by leveling* rather than *bought with coins*. Depth without a new economy.

**The design law (non-negotiable — the anti-shame contract):** feats are **upside-only**. A feat can only *add* XP, *extend* a boost, or *reframe* — never remove XP/level/streak, never gate base rewards, never scold. An **active feat on cooldown is neutral** ("ready again tomorrow"), never a failure or a "you missed it". A **locked feat** shows as a calm future milestone ("unlocks at Level 6"), never a nag. This mirrors the existing `xp-monotonicity` / upside-only Stat Perk invariants — **extend those tests, don't weaken them.**

**Architecture — derived unlocks, one tiny table for cooldowns.**
1. **`class-feats.ts`** (new pure lib) — the feat registry (id, class, kind, unlock level, effect) and pure resolvers: `unlockedFeats(class, level)`, `passiveBonus(feats, context)`, `canActivate(feat, lastUsedAt, now)`. Pure ⇒ exhaustively unit-testable, matching the per-lib `*.test.ts` discipline.
2. **Unlock state is DERIVED** from the hero's `avatarClass` + level — exactly like `feature-gates.ts` derives feature unlocks from level. **Nothing new to store for what's unlocked.**
3. **Only active-feat cooldowns persist.** One new table `feat_activations` (userId, featId, activatedAt) records each use; the daily cooldown is `no activation since local midnight`. Active feats apply their effect by reusing the existing boost columns (`users.xpBoostExpiresAt` / `focusBoostExpiresAt`) via `nextBoostExpiry` — so completion/focus payouts already honor them through `boostBonusPoints`, no seam changes for the boost itself.

**Tech stack:** existing api-server (Hono + typed libs + Drizzle in `lib/db`), OpenAPI → regenerated clients, `artifacts/focusquest` (React) + `ios/FocusQuest` (SwiftUI), gated via `feature-gates.ts`. One identity everywhere — feats live on the user, so web / iOS / RN are one character.

---

## Global Constraints

- **Server-first, additive-only.** Add to api-server + OpenAPI, regenerate clients (never hand-edit generated files). Existing fields/columns are never removed or repurposed; older clients keep working if they ignore the new fields (the `recurringTaskId` precedent).
- **Derived, not duplicated.** Which feats a hero has is computed from `avatarClass` + level at read time. Persist only the genuinely new thing that cannot be derived: active-feat activation timestamps.
- **Anti-shame law** applies to every user-facing string and every numeric effect. Add cases to the upside-only invariant tests; a feat that could lower a persisted stat fails review.
- **Reuse the Stat Perk seam.** Active feats grant the *same* boost windows perks do (`isBoostActive` / `boostBonusPoints` / `nextBoostExpiry`). Do not add a parallel XP-bonus path at the completion seam.
- **Feature-gated rollout.** Feats live inside the campaign layer: they require the existing `campaigns` unlock **and** the feat's own level threshold. Ship dark behind that gate.
- **Determinism & test parity.** Every new lib gets a `*.test.ts`; the pure resolvers are exhaustively tested including anti-shame/monotonicity invariants (passive bonus never negative; a locked or on-cooldown feat never reduces a payout).

---

## The feat ladder (design)

Four classes, a few feats each, unlocked at level thresholds inside the campaign era (L4+). Names keep the app's flavor; every effect maps to an existing, upside-only mechanic. **Illustrative — the registry in Task 1 is the source of truth; tune before shipping.**

| Class | Feat | Unlock | Kind | Effect (all upside-only) |
|-------|------|--------|------|--------------------------|
| **Mage** (INT/Athenaeum) | *Focus Surge* | L4 | active (daily) | Grants a free Focus Boost window (reuses `focusBoostExpiresAt`). |
| **Mage** | *Scholar's Insight* | L6 | passive | Small XP bias on `learning`/`creative` quests. |
| **Ranger** (DEX/finesse) | *Trailblazer* | L4 | active (daily) | Grants a free XP Boost window (reuses `xpBoostExpiresAt`). |
| **Ranger** | *Pathfinder* | L6 | passive | Small XP bias on `travel`/`errands` quests. |
| **Fighter** (STR/Forge) | *Second Wind* | L4 | active (daily) | Grants a free XP Boost window. |
| **Fighter** | *Iron Resolve* | L6 | passive | Small XP bias on `deep_work`/`admin` quests. |
| **Healer** (WIS/Wellspring) | *Mend* | L4 | active (daily) | Grants a Streak Shield if under the cap (reuses `streakFreezes`). |
| **Healer** | *Restorative* | L6 | passive | Small XP bias on `health`/`self_care` quests. |

- **Passive bias** is a small additive percentage on the *matching* category's base XP, applied through the same additive shape as `boostBonusPoints` — it can only add. Kingdom/category mapping reuses `CATEGORY_TO_KINGDOM` / `abilityForKingdom`.
- **Active feats** are **once per local day** (cooldown = no `feat_activations` row since local midnight in the user's tz). Activating grants an existing boost/shield window for free; the effect then flows through the perk seam already in place.

---

## Phase 1 — The pure lib

### Task 1: `class-feats.ts` + tests
**Files:** create `artifacts/api-server/src/lib/class-feats.ts`, `class-feats.test.ts`.
- [ ] Types: `FeatKind = "passive" | "active"`, `FeatDef { id; heroClass; kind; unlockLevel; label; emoji; description; grants?: "xp_boost" | "focus_boost" | "streak_shield"; passiveCategory?; passiveBonus? }`, and the `FEATS` registry above.
- [ ] Pure resolvers: `unlockedFeats(heroClass, level)`, `lockedFeats(heroClass, level)` (with each one's unlock level, for the "unlocks at L6" line), `passiveBonusPoints(feats, category, basePoints)` (additive, ≥ 0), `canActivate(feat, lastUsedAtLocalDate, todayLocalDate)`.
- [ ] Tests: unlock thresholds per class; `passiveBonusPoints` is never negative and is 0 for a non-matching category or a locked feat (monotonicity/anti-shame); `canActivate` false on the same local day, true on a new day; an unknown class yields no feats (older/default `fighter` still works).

## Phase 2 — Persistence & API

### Task 2: `feat_activations` schema + migration
**Files:** `lib/db/src/schema/feat-activations.ts`, schema index, generated migration + **meta/_journal.json + snapshot** (a migration is not complete without its meta — see the drizzle-migration-meta rule).
- [ ] Table: `id`, `userId` (fk), `featId` (text), `activatedAt` (timestamptz), `localDate` (text, the user-tz day, for the daily-cooldown query). Index on `(userId, featId, localDate)`.
- [ ] Register in the account-data registry; run the registry guard test. Generate + review SQL. Typecheck.

### Task 3: routes
**Files:** `artifacts/api-server/src/routes/class-feats.ts` (or fold into `stat-perks.ts`), mount in `routes/index.ts`.
- [ ] `GET /users/me/feats` → `{ unlocked: FeatView[], locked: FeatView[] }` where a `FeatView` carries the def plus, for active feats, `readyToday: boolean` (from the latest activation vs today's local date). Gated: requires `campaigns` unlocked; returns 403/empty otherwise, matching how the campaign layer gates.
- [ ] `POST /users/me/feats/:id/activate` → validate the feat is unlocked for the user's class+level, active-kind, and `readyToday`; in one tx insert a `feat_activations` row (idempotent per day via the index) and apply the grant (`nextBoostExpiry` for boosts; `streakFreezes` bump under `MAX_STREAK_FREEZES` for Mend). Return the updated feat + any new boost expiry. Never fails a user's day — on a race, the unique-per-day insert is the claim.

### Task 4: wire the passive bias into completion
**Files:** `routes/tasks.ts` completion seam (beside the existing `boostBonusPoints` call).
- [ ] After base points + existing boost bonus, add `passiveBonusPoints(unlockedFeats(class, level), task.category, task.points)` — additive only. Property test: total awarded ≥ base + existing boost (no regression; extends `xp-monotonicity`).
- [ ] Anti-shame copy for any surfaced line (quote the quest title; never "failed").

### Task 5: OpenAPI + regenerated clients
**Files:** `lib/api-spec/openapi.yaml`, regenerate `@workspace/api-client` + `api-zod`.
- [ ] Add the `/users/me/feats` + activate paths and the `FeatView` schema. Regenerate; verify the generated hooks/types exist. **Never** hand-edit generated output. Typecheck.

## Phase 3 — Clients (same regenerated types)

### Task 6: web
**Files:** `artifacts/focusquest` — a Feats panel on the character-sheet / insights page.
- [ ] Render unlocked feats (passive: always-on badge; active: an "Use today" button → activate, disabled with "Ready tomorrow" when used) and locked feats as calm "Unlocks at Level N" rows. Invalidate the stats/feats queries after activating so the button state and any boost card update.
- [ ] **Gate:** feats appear only when `campaigns` is unlocked; using an active feat grants its boost and the button reads "Ready tomorrow" until the next local day.

### Task 7: iOS
**Files:** `ios/FocusQuest/Features/Hero/` (beside `CharacterSheetCard`), a `FeatsCard` + `FeatService`.
- [ ] A `FeatsCard` under the character sheet: unlocked feats with the neon tokens + `TealIconLabelStyle`; active feats get a button that calls activate and settles to "Ready tomorrow"; locked feats show the unlock level. Decode defensively so an older server (no feats endpoint) simply hides the card.
- [ ] **Gate:** same as web — gated on `campaigns`; activating grants the boost and reflects live; reduce-motion honored; every control has an accessibility label.

---

## Cross-cutting

- **Feature gate:** feats require the existing `campaigns` unlock **plus** the feat's own `unlockLevel`. No new top-level `FeatureKey` unless product wants a separate ladder entry.
- **Testing:** pure resolvers get exhaustive unit tests incl. anti-shame/monotonicity; the activate route gets integration coverage incl. the once-per-day race; the completion property test gains a "passive bias never regresses a payout" case.
- **Client parity:** every phase lands web + iOS off the same regenerated types; RN inherits the API. Animation may be richer on one client; the resolved effect is always the server's.
- **Determinism:** the daily cooldown keys off the user's local date (same tz resolution as reflections / DM beats), so "once a day" is stable across clients and refetches.

## Deferred (later second-wave items)

- Loot tables & treasure reveals; inventory & attunement depth; printable character-sheet export; spectator/DM-for-a-friend; seasonal campaigns. Each is independent and server-first, like this one.
