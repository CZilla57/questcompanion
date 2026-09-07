# The Campaign — Phase 2, Party & Shared Encounters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This finishes the **Party** half of Phase 2 of the shared D&D campaign layer — the Encounters half already shipped (personal encounters, `personal_encounters` table, `encounter.ts`). Parent program: [`2026-09-06-dnd-campaign-layer.md`](./2026-09-06-dnd-campaign-layer.md).

**Goal:** Let two linked allies fight **one shared foe together**. A *party* is an accepted **partnership**; each party has at most one active **shared encounter** whose single HP bar is chipped by *either* member's real quest completions. When the foe is felled, **both** members receive upside-only party loot and a fresh, tougher foe spawns. This is the co-op reframe of the World Boss, scoped to a pair, resolved entirely through the Phase-1 roll engine and the Phase-2 `encounter.ts` view — no new combat math.

**Architecture — reuse the two spines, add one shared surface.** The shared encounter is the *personal* encounter's structure ([`personal_encounters`](../../../lib/db/src/schema/personal-encounters.ts) + [`routes/encounter.ts`](../../../artifacts/api-server/src/routes/encounter.ts)) re-scoped from a **user** to a **partnership**, plus a per-member contribution ledger so the UI can show teamwork and loot can reach every contributor. Damage is still `damageForCheck(power, band)` from [`encounter.ts`](../../../artifacts/api-server/src/lib/encounter.ts); the view is still `encounterView(hp, totalDamage)`; sizing/naming/loot still come from [`encounter-progress.ts`](../../../artifacts/api-server/src/lib/encounter-progress.ts). Attacks are **implicit**: you strike the party foe by completing your own quests, exactly as with the personal encounter — there is no separate "attack" button, so there is one source of truth (real work) and nothing to farm.

**Tech Stack:** api-server (Express + typed libs + Drizzle in `lib/db`), OpenAPI (`lib/api-spec/openapi.yaml`) → regenerated `@workspace/api-client-react` + `@workspace/api-zod` via `pnpm --filter @workspace/api-spec codegen` (never hand-edit generated files), `artifacts/focusquest` (React) and `ios/FocusQuest` (SwiftUI) clients.

**Branch:** this branch, `claude/dnd-party`, off `main`.

---

## Global Constraints

- **Anti-shame law (non-negotiable).** No member is ever shown as "behind", "carrying", or out-damaged; contributions render as additive teamwork, never a ranking with a loser. An unfelled foe **rests**, it is never a party "loss". Party loot is **pure upside** — a co-op bonus on top of each member's own rewards, never a split that leaves anyone with *less* than they'd get solo. Extend the upside-only invariant tests; a path that could lower a persisted stat or frame a member as deficient fails review.
- **Additive-only + derived, not duplicated.** New tables persist only the genuinely-new shared state (foe HP + per-member damage). The completion result gains new fields; every existing client keeps working if it ignores them (the `encounterHit` precedent). Reuse `encounter.ts` / `encounter-progress.ts` / `roll-engine.ts` — do not re-derive damage, phases, sizing, or loot.
- **Damage is monotonic.** `totalDamage` and each contribution only ever grow. Uncompleting a quest never heals the shared foe (mirrors `personal_encounters` — progress is never taken back).
- **Attacks are implicit and non-farmable.** The party foe is chipped only as a side effect of a real quest completion, best-effort, and a chip failure must **never** fail the completion (mirror the `chipPersonalEncounter` contract in [`tasks.ts`](../../../artifacts/api-server/src/routes/tasks.ts)).
- **At most one active foe per party**, enforced by a partial unique index — the DB is the guard against a race spawning two, not just route code (mirrors `personal_encounters_active_user_unique`).
- **Deleting a partnership dissolves its foe, never work.** `party_encounters.partnership_id` is `ON DELETE CASCADE`; already-granted coins/XP are never revoked.
- **Feature-gated.** The party surface lives behind the existing `campaigns` feature key (Phases 0–3 all gate on it) — **no new key**. It is simply empty until the user has an accepted ally (`allies` unlocks at L5), so the two gates compose naturally.
- **No route-test harness** (no supertest in this repo). Push logic into a pure lib with `*.test.ts`; prove routes with a live authed two-account drive.
- **Migrations are generated, committed with `meta/`, and applied to live Neon before the PR merges.** `drizzle-kit push` is removed. Commit the `.sql` **and** `meta/_journal.json` + snapshot together.

---

## File Structure

**Create:**
- `lib/db/src/schema/party-encounters.ts` — `party_encounters` + `party_encounter_contributions` tables
- `lib/db/drizzle/0011_party_encounters.sql` — generated migration (+ `meta/` updates)
- `artifacts/api-server/src/lib/party-encounter.ts` — pure sizing + loot + contribution rollup
- `artifacts/api-server/src/lib/party-encounter.test.ts`
- `artifacts/api-server/src/routes/party.ts` — `chipPartyEncounters` + `GET /party/encounters`
- `artifacts/focusquest/src/components/party-encounter-card.tsx` — the shared-foe panel
- `ios/FocusQuest/Features/Social/PartyView.swift` — SwiftUI parity (see Task 5 note)

**Modify:**
- `lib/db/src/schema/index.ts` — export party-encounters
- `artifacts/api-server/src/lib/account-data.ts` — register both tables (children before `partnerships`)
- `artifacts/api-server/src/routes/tasks.ts` — call `chipPartyEncounters` in the completion seam; add `partyHits` to the result
- `artifacts/api-server/src/routes/index.ts` — mount the party router
- `lib/api-spec/openapi.yaml` — paths + schemas + `TaskCompletionResult.partyHits`
- `artifacts/focusquest/src/pages/partners.tsx` (or the allies surface) — mount `PartyEncounterCard`
- `ios/FocusQuest/Features/Social/AlliesView.swift` — entry point to `PartyView`

---

### Task 1: Schema, migration, and the data registry

**Files:** create `lib/db/src/schema/party-encounters.ts`; modify `lib/db/src/schema/index.ts`, `artifacts/api-server/src/lib/account-data.ts`; generated `lib/db/drizzle/0011_party_encounters.sql` + `meta/`.

**Interfaces produced:** `partyEncountersTable` (`id`, `partnershipId`, `name`, `tier`, `hp`, `totalDamage`, `felledAt`, `createdAt`); `partyEncounterContributionsTable` (`id`, `partyEncounterId`, `userId`, `damage`, `createdAt`); types `PartyEncounter`, `PartyEncounterContribution`.

- [x] **Step 1: Write the schema file** — model on `personal-encounters.ts`. Scope the foe to a partnership, and add a per-member contribution ledger:

```typescript
// lib/db/src/schema/party-encounters.ts
import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { partnershipsTable } from "./partnerships";

// The Campaign — Phase 2 (Party): one SHARED foe per accepted partnership,
// chipped by EITHER member's quest completions. The co-op reframe of the World
// Boss, scoped to a pair. Same anti-shame law as personal_encounters: totalDamage
// only grows, a felled foe "rests", nothing is ever taken back.
export const partyEncountersTable = pgTable("party_encounters", {
  id:            serial("id").primaryKey(),
  partnershipId: integer("partnership_id").notNull()
                   .references(() => partnershipsTable.id, { onDelete: "cascade" }),
  name:          text("name").notNull(),
  tier:          integer("tier").notNull().default(1),
  hp:            integer("hp").notNull(),
  totalDamage:   integer("total_damage").notNull().default(0),
  felledAt:      timestamp("felled_at"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // At most one ACTIVE (unfelled) foe per party — lazy spawn is an atomic insert
  // that can't race two active foes into existence; many felled rows may remain.
  uniqueIndex("party_encounters_active_partnership_unique")
    .on(t.partnershipId)
    .where(sql`${t.felledAt} is null`),
]);

// One row per (foe, member), damage accumulated. Lets the UI show both members'
// contributions as teamwork and lets loot reach every contributor. NEVER used to
// rank members against each other (anti-shame law).
export const partyEncounterContributionsTable = pgTable("party_encounter_contributions", {
  id:               serial("id").primaryKey(),
  partyEncounterId: integer("party_encounter_id").notNull()
                      .references(() => partyEncountersTable.id, { onDelete: "cascade" }),
  userId:           integer("user_id").notNull()
                      .references(() => usersTable.id, { onDelete: "cascade" }),
  damage:           integer("damage").notNull().default(0),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("party_encounter_contrib_foe_user_unique").on(t.partyEncounterId, t.userId),
]);

export type PartyEncounter = typeof partyEncountersTable.$inferSelect;
export type PartyEncounterContribution = typeof partyEncounterContributionsTable.$inferSelect;
```

- [x] **Step 2: Export the module** — add `export * from "./party-encounters";` to `lib/db/src/schema/index.ts` after the `personal-encounters` line.

- [x] **Step 3: Generate the migration**

```bash
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm --filter @workspace/db generate --name party_encounters
```

- [x] **Step 4: Review the SQL.** Confirm `lib/db/drizzle/0011_party_encounters.sql` creates both tables, the FK to `partnerships` with `ON DELETE cascade`, the two partial/unique indexes, and **nothing else**. If any `DROP` appears, STOP and report drift — do not hand-edit the SQL to hide it. Confirm `meta/_journal.json` + the new snapshot are staged alongside the `.sql` (see [[drizzle-migration-meta]]).

- [x] **Step 5: Register in the account-data registry.** In `artifacts/api-server/src/lib/account-data.ts`, import both tables and add entries **before** the `partnerships` entry (children delete first):

```typescript
  { name: "party_encounter_contributions", table: partyEncounterContributionsTable, userColumns: [partyEncounterContributionsTable.userId] },
  // party_encounters has no user column — it hangs off partnerships (which the
  // account-delete walk already covers) and cascades. Register it read-only via
  // its partnership linkage if the guard requires a row; otherwise the CASCADE
  // from partnerships suffices. Follow whatever the guard test demands.
```

- [x] **Step 6: Run the registry guard + typecheck**

```bash
pnpm --filter @workspace/api-server test -- account-data
pnpm typecheck
```

- [x] **Step 7: Commit** — `git add` the schema, `lib/db/drizzle` (SQL **+ meta**), the index export, and account-data; commit `feat(party): party_encounters + contribution ledger schema`.

---

### Task 2: Pure party logic + tests

**Files:** create `artifacts/api-server/src/lib/party-encounter.ts`, `party-encounter.test.ts`.

**Interfaces produced:**
- `partyPower(powers: number[]): number` — combined sizing so the shared foe is tougher than a solo one (teamwork required).
- `partyLoot(tier: number, contributorIds: number[]): { userId: number; coins: number }[]` — **upside-only**: every member who dealt ≥1 damage receives the full `felledCoins(tier)` (a generous co-op bonus, never a split-to-less).
- `rollUpContributions<T extends { userId: number; damage: number }>(rows: T[], members: number[]): { userId: number; damage: number }[]` — one entry per member (0 for a member who hasn't struck yet), ordered by `members`, with **no** implicit ranking.
- Re-exports of the sizing constants it layers on (`HP` curve lives in `encounter-progress.ts`).

- [x] **Step 1: Write the failing tests** — cover: `partyPower` exceeds any single member's power (so `encounterHp(tier, partyPower) > encounterHp(tier, soloPower)`); `partyLoot` gives **each** contributor `felledCoins(tier)` and never a negative or zero-for-a-contributor payout; a non-contributor gets no row; `rollUpContributions` returns a 0-damage entry for a member who hasn't struck (never omits them, never marks them "behind"); determinism. Assert the anti-shame invariant explicitly (loot ≥ solo `felledCoins`, damage entries never sorted into winner/loser).

- [x] **Step 2: Run to verify they fail** — `pnpm --filter @workspace/api-server test -- party-encounter` → cannot resolve import.

- [x] **Step 3: Implement `party-encounter.ts`** — pure, no I/O, importing `felledCoins` from `./encounter-progress`. Keep it thin; the HP/phase/damage math already lives in `encounter.ts` / `encounter-progress.ts` and must be reused, not re-derived.

- [x] **Step 4: Run to verify pass**, then **Step 5: Commit** `feat(party): pure party sizing, upside-only loot, contribution rollup`.

---

### Task 3: The party route, completion wiring, and the API contract

**Files:** create `artifacts/api-server/src/routes/party.ts`; modify `routes/tasks.ts`, `routes/index.ts`, `lib/api-spec/openapi.yaml`; regenerate clients.

**Interfaces produced:**
- `chipPartyEncounters(userId, power, band): Promise<PartyEncounterHit[]>` — for **each** of the user's accepted partnerships, lazily spawn+chip the shared foe, accumulate this user's contribution, and on felling grant `partyLoot` to every contributor and spawn the next tier. Transactional per party; best-effort by contract.
- `GET /party/encounters` — the user's parties (accepted partnerships), each with `EncounterView`, both members (name), and their contributions.
- `TaskCompletionResult.partyHits: PartyEncounterHit[]`.

- [x] **Step 1: Build `chipPartyEncounters`** — model the transaction on `chipPersonalEncounter`. For the completing user, load accepted partnerships ([`accountability.ts`](../../../artifacts/api-server/src/routes/accountability.ts) shows the accepted-pair query). For each: `activePartyEncounter(tx, partnershipId, partyPower)` (lazy insert via the partial unique index, on-conflict re-read the winner); `damage = damageForCheck(power, band)`; bump `totalDamage` and the caller's contribution row (`onConflictDoUpdate` accumulate); if felled, stamp `felledAt`, `partyLoot(tier, contributorIds)` → `awardCoins` each, spawn `nextTier`. Return a `PartyEncounterHit` (party id, foe name/tier, this blow's damage, felled, this user's loot, `encounterView`). Sizing HP from **combined** power so it reads as a tougher, shared foe.

- [x] **Step 2: `GET /party/encounters`** — list accepted partnerships, lazily surfacing (not necessarily spawning) each shared foe; return `encounterView`, member names, and `rollUpContributions`. 401 when unauthenticated.

- [x] **Step 3: Wire into completion** — in `routes/tasks.ts`, inside the existing best-effort `try` that already calls `chipPersonalEncounter` (~line 976), also `partyHits = await chipPartyEncounters(userId, power, skillCheck.band)`; add `partyHits` to the `res.json` result. A party-chip throw must be caught by the **same** guard so it never fails the completion.

- [x] **Step 4: Mount the router** in `routes/index.ts`.

- [x] **Step 5: OpenAPI + codegen** — add the `party` tag, the `GET /party/encounters` path, and schemas `PartyEncounter`, `PartyMemberContribution`, `PartyEncounterHit`; add `partyHits` (array of `PartyEncounterHit`) to `TaskCompletionResult`. Every request/response body is a named `$ref` (orval inline-body collision gotcha). Then:

```bash
pnpm --filter @workspace/api-spec codegen
```

Never hand-edit anything under `*/src/generated`.

- [x] **Step 6: Typecheck + server suite**

```bash
pnpm typecheck
pnpm --filter @workspace/api-server test
```

- [x] **Step 7: Commit** `feat(party): shared-foe chip on completion + GET /party/encounters + contract`.

---

### Task 4: Web client — the shared-foe panel

**Files:** create `artifacts/focusquest/src/components/party-encounter-card.tsx`; modify the allies/partners page to mount it; reuse `artifacts/focusquest/src/lib/encounter.ts` and mirror `personal-encounter-card.tsx`.

- [x] **Step 1:** Render each party's shared foe: name, tier, the HP bar + phase label (reuse the encounter view helpers), and **both** members' contributions side by side as teamwork (e.g. "You · 120  ·  Alex · 95") — never a ranked list, never a "behind" state.
- [x] **Step 2:** On a completion whose result carries a `partyHits` strike or fell, surface the existing strike/fell toast (mirror the personal-encounter toast), worded co-op ("Together you struck the Gloomfen Warden").
- [x] **Step 3: Gate** — the panel appears only when `campaigns` is unlocked **and** the user has an accepted ally; otherwise render nothing. **Commit** `feat(web): party shared-encounter panel + co-op strike toast`.

---

### Task 5: iOS client parity

> **Branch note:** the native app's Phase 0–2 encounter UI lives on the `claude/dnd-ios` lineage, not yet merged to `main`. Do this task on that branch (or after it merges), reusing `CampaignModels.swift`'s `EncounterView` + the personal-encounter card style. It is listed here so the phase's parity is tracked in one place.

- [ ] **Step 1:** Add `PartyEncounter` / `PartyMemberContribution` / `PartyEncounterHit` Codable models (optional/defensive, matching `CampaignModels.swift`), a `PartyService.encounters()` call, and a `PartyView` reachable from `AlliesView` showing each shared foe's HP + both contributions with the neon tokens + `TealIconLabelStyle`.
- [ ] **Step 2:** Show a co-op strike/fell note from `partyHits` on the completion sheet.
- [ ] **Step 3: Gate** on `campaigns` + an accepted ally. Build for the simulator and verify live. **Commit** `feat(ios): party shared-encounter view (Campaign Phase 2 Party)`.

---

### Task 6: Live two-account drive + gates

- [ ] **Step 1:** Apply the migration to live Neon (standing instruction) before merge.
- [ ] **Step 2: Gate (server):** with two accepted-ally accounts, completing quests on **either** account moves the **same** shared foe's HP; felling it grants **both** contributors loot and spawns a tougher foe. Prove via a live authed drive against the deployed server (curl or the two-account script), captured in a short runbook like [`2026-08-12-ios-device-track-results.md`](../specs/2026-08-12-ios-device-track-results.md).
- [ ] **Step 3: Gate (client):** the shared HP bar moves for both members on web (and iOS once its branch lands); no member is ever shown as behind; an unfelled foe reads as resting, never a loss.
- [ ] **Step 4:** Mark Phase 2 **Party** complete in the parent plan ([`2026-09-06-dnd-campaign-layer.md`](./2026-09-06-dnd-campaign-layer.md)) and note anything deferred.

---

## Anti-shame checklist (review gate for every task)

- No copy or layout ranks members or implies anyone is behind, slow, or carrying the party.
- Party loot is strictly additive upside; no member ever nets less than they would solo.
- `totalDamage` and every contribution are monotonic; uncompleting never heals the foe.
- An unfelled foe rests; there is no party "defeat", timeout, or decay.
- A dissolved partnership removes only the foe (CASCADE), never granted rewards or completed work.

## Second wave (scoped later)

- **Guilds / >2 parties:** a shared foe across a group larger than a pair (needs a party entity beyond the pairwise partnership).
- **Party initiative / turn flavor** (cosmetic, deferred with the solo encounter's).
- **Weighted/legendary loot** on high-tier fells feeding the gear system.
