# The Campaign — a shared D&D layer over FocusQuest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a **multi-phase program**; each phase is independently shippable. Do phases in order — later phases consume the character sheet and roll engine built in Phase 0/1.

**Goal:** Turn FocusQuest from an RPG-flavored tracker into a **playable tabletop campaign** — ability scores, visible d20 skill checks, an AI Dungeon Master threading real quests into an ongoing story, and a co-op party with encounters — **shared across web / iOS / RN** by building the mechanics in `artifacts/api-server` and exposing them through the existing OpenAPI → `api-zod` → clients pipeline. No mechanic is native-only; the native app renders the same server truth every client gets.

**The design law that governs everything (non-negotiable):** the codebase runs on an **anti-shame contract** — no "warning", no guilt, no "you didn't", real numbers only, quest titles quoted. Tabletop D&D has failed rolls, damage, and death; **this game has none of those as downside.** Chance may only *add upside or reframe*. A "missed" check never removes XP/level/streak/coins and never reads as failure — it becomes a gentler next step ("the goblin slipped away — try a smaller approach"). Every string and every mechanic below is checked against this law. This mirrors the existing `xp-monotonicity` / upside-only Stat Perks invariants — extend those tests, don't weaken them.

**Architecture — one spine, four limbs.** All four threads hang off **two new server concepts**:
1. **The Character Sheet** (`character-sheet.ts`) — six ability scores *derived* (not newly stored) from signals already persisted: the five Life Kingdoms' lifetime points → five abilities, plus focus-session discipline → the sixth. Scores and modifiers are computed at read time, exactly like `kingdomTier`/liveliness are today (see [`kingdoms.ts`](../../../artifacts/api-server/src/lib/kingdoms.ts) — "derived at read time"). **Nothing new to migrate for scores.**
2. **The Roll Engine** (`roll-engine.ts`) — a pure, seeded `d20 + modifier + proficiency vs DC` resolver with anti-shame outcome bands. Task completion, encounters, and party actions all resolve through it. Pure and seeded ⇒ fully unit-testable, matching the repo's per-lib `*.test.ts` discipline.

The Dungeon Master (Phase 3) and Party/Encounters (Phase 2) are **consumers** of these two — they add narration and multiplayer, not new math.

**Tech Stack:** existing api-server (Hono + typed libs + Drizzle in `lib/db`), OpenAPI spec → regenerated `@workspace/api-client` + `api-zod` (see `lib/api-zod/src/generated`), `artifacts/focusquest` (React) and `ios/FocusQuest` (SwiftUI) clients, the `ai/` lib for DM generation. Feature-gated via the existing `feature-gates.ts` so the campaign rolls out behind a flag.

**One identity everywhere:** all state stays on the existing user + the same API, so web, iOS, and RN remain one character in one campaign.

---

## Global Constraints

- **Server-first, additive-only.** Every phase adds to `artifacts/api-server` + the OpenAPI schema, then regenerates clients (`api-client`, `api-zod`) — never hand-edit generated files. Existing fields are never removed or repurposed; the web client must keep working if it ignores the new fields (the `recurringTaskId` precedent).
- **Derived, not duplicated.** Ability scores, modifiers, DCs, and outcomes are computed from existing persisted signals (kingdom lifetime points, focus sessions, difficulty tier). Persist only what is genuinely new and cannot be derived (Phase 2 encounter/party state; Phase 3 narration cache).
- **Anti-shame law** applies to every user-facing string and every numeric effect. Add cases to the upside-only invariant tests; a roll that could lower a persisted stat fails review.
- **Determinism & fairness.** Rolls are seeded from stable inputs (user id + task id + day, or encounter id + turn) so a given action resolves the same on every client and in tests, and cannot be re-rolled by refetching. The seed is server-side; clients render, they do not roll.
- **Feature-gated rollout.** Gate the whole campaign behind a `feature-gates.ts` flag so it ships dark and enables per-cohort. Each phase is shippable behind the flag.
- **Test parity.** Match the codebase: every new lib gets a `*.test.ts`; pure resolvers (scores, DCs, roll bands) are exhaustively tested including the anti-shame invariants.

---

## Phase 0 — The Character Sheet (ability scores from existing signals)

**Why first:** highest immersion-per-effort, mostly a read-time derivation of data you already store, and it is the vocabulary (scores + modifiers) every later phase speaks. Ships as a screen with no new writes.

### The mapping (design)

Five Life Kingdoms → five abilities; focus discipline → the sixth; the Capital → the **proficiency bonus** (overall level). Names keep the app's own flavor rather than raw D&D labels, but the modifier math is classic.

| Ability (app name)   | Source signal                                  | Kingdom |
|----------------------|------------------------------------------------|---------|
| **Vigor** (CON)      | Hearth lifetime points (household/errands/upkeep) | hearth |
| **Attunement** (WIS) | Wellspring points (health/self-care)           | wellspring |
| **Might** (STR)      | Forge points (deep work/admin/finance)         | forge |
| **Intellect** (INT)  | Athenaeum points (learning/creative)           | athenaeum |
| **Presence** (CHA)   | Crossroads points (social/travel)              | crossroads |
| **Finesse** (DEX)    | Focus-session discipline (completed intervals / cadence) | — |

- **Score curve:** `score = clamp(8..20, round(8 + f(lifetimePoints)))` where `f` reuses the kingdom tier bands (Wild→8, Outpost→10, Settlement→12, Village→14, Town→16, Stronghold→18, with headroom to 20 at very high points). Finesse maps focus completed-intervals through the same shape. **Monotonic** (more work never lowers a score).
- **Modifier:** classic `floor((score - 10) / 2)` → the `+N` a player reads.
- **Proficiency bonus:** from the Capital tier (0–11) → `+2 … +6`, added to every check.

### Task 1: `character-sheet.ts` + tests
**Files:** create `artifacts/api-server/src/lib/character-sheet.ts`, `character-sheet.test.ts`.
- [x] Pure functions: `abilityScores(kingdomPoints, focusStats) -> {ability, score, modifier, kingdomId}[]`, `proficiencyBonus(capitalTier)`, and a `CharacterSheet` assembler that also surfaces class (existing `avatarClass`), level, and battle power. Reuse `kingdomTier`/`CATEGORY_TO_KINGDOM` from `kingdoms.ts`; **do not** re-derive the point totals.
- [x] Tests: monotonicity (adding points never lowers a score), band boundaries, clamp at 8/20, proficiency at capital tiers 0/1/11.

### Task 2: API surface
**Files:** modify the users/hero route (`artifacts/api-server/src/routes/users.ts`), the OpenAPI spec, then regenerate `api-client` + `api-zod`.
- [x] Add the character sheet to the existing hero/kingdoms response (or a new `GET /character-sheet`). Additive; the web client keeps working unchanged.
- [x] Regenerate clients; add the generated `CharacterSheet` type. **Never** hand-edit generated output.

### Task 3: Render it — web + iOS
**Files:** `artifacts/focusquest` hero/insights; `ios/FocusQuest/Features/Hero/`.
- [x] Web: a character-sheet panel above the Kingdom map — six ability blocks (name, score, `+mod`), proficiency, class, level. The kingdoms map becomes the *visual* of the same stats it now scores.
- [ ] iOS (on the `claude/swift-mobile-app-a70k2k` branch, after this endpoint deploys): a `CharacterSheetCard` on the Hero page, sitting above the existing `KingdomSceneImage` map, styled with the neon tokens + `TealIconLabelStyle`. Reuse the loaded `KingdomsResponse`; add the sheet to `HeroViewModel.Bundle`.
- [ ] **Gate:** the six scores render on web and iOS from real data, move when you complete quests in that life area, and never decrease.

---

## Phase 1 — The visible d20 & skill checks

**Why second:** the single most "D&D" *feeling* moment, and it plugs into the sheet (modifiers) from Phase 0 and the completion path that already returns XP. Server owns the roll; clients animate it.

### The mechanic (design)
On quest completion the server resolves a check: **`d20 + abilityModifier(kingdom of the task's category) + proficiencyBonus` vs a DC from the task's existing difficulty tier** (easy → DC 8, medium → 12, hard → 16; reuse `difficulty.ts`). Outcome bands, **all upside-only**:
- **Natural 20 → Critical:** the quest completes *and* a bonus (double surprise-reward roll / extra coins). Reuse `surprise-rewards.ts` / `gear-rewards.ts` — the roll *biases* existing rewards up, never down.
- **Meets/beats DC → Success:** normal completion + flavor.
- **Under DC → "Glancing":** the quest **still completes with its full base XP** (completion is never revoked — that would break `xp-monotonicity`). The narration reframes gently and, optionally, nudges the existing difficulty-ladder "easier variant" offer. No penalty.
The roll is **seeded** from `userId + taskId + completionDay` so it is stable, fair, and un-rerollable.

### Task 1: `roll-engine.ts` + tests
**Files:** create `artifacts/api-server/src/lib/roll-engine.ts`, `roll-engine.test.ts`.
- [x] Pure `resolveCheck({seed, modifier, proficiency, dc}) -> {d20, total, dc, band: "crit"|"success"|"glancing"}`. Seeded PRNG (stable, documented). DC helper from difficulty tier.
- [x] Tests: band boundaries, nat-20 always crit / nat-1 never worse than "glancing", determinism for a fixed seed, and the **invariant that no band reduces base reward** (assert glancing ≥ base).

### Task 2: Wire into completion
**Files:** the task-completion path (`routes/tasks.ts` + `gamification.ts`), OpenAPI, regenerate clients.
- [ ] On complete, compute the check and return a `SkillCheck { d20, total, dc, band, ability }` on the existing completion result alongside `pointsAwarded`/`leveledUp`. Crit path routes through the existing surprise/gear reward with an up-bias only.
- [x] Anti-shame copy per band (quote the quest title; never "failed").
- [ ] **Gate (server):** completing easy/medium/hard quests returns correctly-banded, deterministic checks; property test confirms no reward regression.

### Task 3: The dice, on screen
**Files:** iOS `CompletionSheet.swift` (+ a `DiceRollView`); web completion toast/modal.
- [ ] iOS (on the `claude/swift-mobile-app-a70k2k` branch, after this deploys): an animated d20 settling on the rolled value in `CompletionSheet`, colored by band (crit = gold, success = teal, glancing = calm/no-red), with the `+mod`/DC shown as `d20 + N vs DC`. Fire the Phase-5 `Haptics.levelUp()` on a crit. Respect a reduce-motion setting.
- [x] Web: an equivalent roll reveal in the completion UI (band-styled toast).
- [ ] **Gate:** completing a quest shows the die rolling to the server's value; a crit shows bonus loot; a glancing result reads encouraging, never punishing.

---

## Phase 2 — Party & Encounters

**Why third:** reframes systems you already have (World Boss / Solo Boss → encounters; allies / body-double → party) using the Phase-1 roll engine. Co-op retention beats solo.

### Encounters (reframe bosses)
**Files:** `world-boss.ts` / `solo-boss.ts` consumers, `battles.ts` schema, routes, clients.
- [ ] Model a boss as an **encounter**: an HP bar chipped by quest completions, where each completion's Phase-1 check is the "attack roll" (crit = extra damage). Add **initiative/turn** flavor and phase transitions. Persist only the genuinely new encounter state; damage derives from existing completions where possible.
- [ ] Anti-shame: an unbeaten encounter **retreats/rests**, it does not "defeat" the player; no lost progress.
- [ ] **Gate:** a solo encounter shows an HP bar that drops as you complete quests, crits hit harder, and finishing it grants loot — on web and iOS.

### Party (reframe allies / body-double)
**Files:** `partnerships.ts` / `body-double.ts`, `ally-milestones.ts`, routes, clients.
- [ ] A **party** view: your allies as a co-op group with a **shared encounter** (a light co-op world boss) and **party loot** split on victory. Reuse existing ally/partnership plumbing; add a party-scoped encounter.
- [ ] **Gate:** two linked accounts see the same shared encounter's HP move as either completes quests, and both receive loot on victory.

---

## Phase 3 — The Dungeon Master (AI narrative campaign)

**Why last:** the biggest *depth* jump and the most server/AI work; it narrates the mechanics the earlier phases made real, so it needs them to exist first. Reuses `ai/` and `campaign-arc.ts` (curated Arcs, 3–5 chapters).

### The DM
**Files:** create `artifacts/api-server/src/lib/dungeon-master.ts` (+ `ai/` prompt), a narration cache table, routes, clients.
- [ ] **Campaign thread:** map the user's active questline/campaign arc to a chapter; the DM writes short, grounded narration that references **real** completed quests and kingdom growth ("the Forge's east tunnel is clear; the Athenaeum's lanterns relit"). Never invents work the user didn't do.
- [ ] **Daily beats:** a **morning quest board** (today's quests framed as the day's adventure) and an **evening make-camp** that hooks the existing reflection feature (a short rest for the party + the hero-vitality "long rest" restore).
- [ ] **Session recap:** fold into the existing `weekly-recap.ts` — the week as a "session summary" in DM voice.
- [ ] **Cost/latency:** cache narration (one generation per beat), degrade gracefully to a templated non-AI line if generation fails (the app must never block on the DM). Anti-shame + no-fabrication constraints in the system prompt; validate output against the user's real completions before showing.
- [ ] **Gate:** a day of real quests produces a coherent morning board and evening camp that reference only quests actually completed; a generation failure falls back silently to a templated beat.

---

## Cross-cutting

- **Feature gate:** one `campaign` flag in `feature-gates.ts` guards Phases 0–3; unlock via the existing feature-unlock ladder so it appears as an earned Act, consistent with how Kingdoms/Perks unlocked.
- **Testing:** pure resolvers (`character-sheet`, `roll-engine`, DC/band math) get exhaustive unit tests incl. anti-shame/monotonicity invariants; encounter/party get integration coverage; DM output gets a "no-fabrication" validation test.
- **Client parity:** every phase lands web + iOS together off the same regenerated types; RN inherits the API for free. A dice *animation* may be richer on one client, but the resolved values are always the server's.
- **Reduce-motion / accessibility:** dice and encounter animations honor reduce-motion; every visual has a text equivalent (the roll reads as "d20 + N vs DC" in the accessibility label), matching the web KingdomScene aria approach.

## Second wave (scoped later)

- **Class abilities / feats** unlocked at levels (Mage "Focus Surge", Ranger "Trailblazer"), layered on existing Stat Perks.
- **Loot tables & treasure reveals** as a first-class system feeding gear.
- **Inventory & attunement** depth on the existing gear slots.
- **Spectator/DM-for-a-friend**, seasonal campaigns, and a printable "character sheet" export.
