# Act III — The Living World (RPG-depth roadmap) — sequenced plan

> Third act of the RPG-depth roadmap (the 🎲 "FocusQuest RPG Roadmap" artifact). Act III turns the narrator into characters and the boss into an antagonist. Like Acts I–II, most of its *first* feature is already built — this plan reconciles the roadmap against what ships and sequences the genuinely-new work. Server-first, additive-only, anti-shame law non-negotiable (a setback may only reframe or add upside — never a penalty, debuff, or blame).

## What already exists (reconcile, do not duplicate)

- **Living Companion** — [`companion.ts`](../../../artifacts/api-server/src/lib/companion.ts): derived beats (`welcome_back` / `rest_day` / `streak_milestone` / `ambient` / `quiet`), a **monotonic bond** (`users.bondQuestsCompleted`) with bond tiers, `dayGap` absence/rest logic, and a **completion reaction** (`completionCompanionReaction`) already surfaced as `companionReaction` on web + iOS. So "references yesterday / reacts to a missed day" is **done**.
- **Dungeon Master** — `dungeon-master.ts` + `dm_beats`: grounded morning/camp beats, weekly-recap voice, no-fabrication validation.
- **Encounters** — `personal_encounters` (thematically **named** foes per tier, e.g. "The Procrastigeist"), `party_encounters`, `world-boss.ts`/`solo-boss.ts`. HP chipped by the Act II roll band; a foe **retreats to rest**, never strikes the player.

Gaps the roadmap actually asks for that are **not** built:
1. The companion has **no name / disposition**, and its reaction is **not crit/fail-aware** (can't "cheer a crit").
2. Bosses have **no motive / defeat_beat / world_state_delta** — no arc'd antagonist whose defeat changes the world.

---

## Slice A — Crit/fail-aware companion reaction  · size S · **do first**

**Goal:** the companion reacts to the *last outcome* — cheers a crit, gives a gentle (anti-shame) line on a fail — completing the roadmap's "reacts to a missed day, cheers a crit" using systems already shipped.

- **Server:** extend `completionCompanionReaction(args)` with `band?: CheckBand`. Add a crit line (celebratory) and a fail line (gentle, forward-looking — never blame). Precedence: level-up / bond-tier-up events still win, so a milestone is never drowned by a per-roll line. **Wiring note:** the skill check resolves *later* than the reaction in `routes/tasks.ts` (reaction ~L730, `skillCheck` ~L982) — resolve the check before the reaction, or thread the band down. New copy in `companion-copy.ts`.
- **Clients:** none required — `companionReaction` already renders on web + iOS. (Optional crit flourish later.)
- **Deps:** Act II fail band (#131). **No schema.**
- **Tests:** companion-copy lines; reaction precedence (level-up/bond > crit > fail > neutral); anti-shame (fail line contains no blame / "fail").
- **Risk:** low.

## Slice B — Named companion (name + disposition)  · size M · second

**Goal:** turn the reactive layer into a named character with a disposition (roadmap: `companion(userId, name, disposition)`).

- **Server:** migration — companion `name` + `disposition` (columns on `users`, 1:1, simplest; or a small `companions` table). Sensible defaults so existing users aren't blank (a starter familiar + neutral disposition). Disposition enum (e.g. `cheerful` / `stoic` / `wry`) that lightly flavors reaction + beat copy. `GET`/`PATCH` companion (rename, set disposition). `companion-copy` gains per-disposition variants.
- **Clients:** a naming/disposition edit affordance — web hero/companion card + iOS companion card. Cross-surface.
- **Deps:** Slice A (so the named companion also reacts to rolls). Schema migration + client regen.
- **Risk:** medium (UX + migration + copy matrix).

## Slice C — Named, arc'd bosses (motive / defeat_beat / world_state_delta)  · size M–L · third

**Goal:** a foe you have a *reason* to beat, whose defeat changes the world state.

- **Server:** add `motive`, `defeatBeat`, `worldStateDelta` to the boss/encounter roster (personal encounters are already named — extend their roster defs and/or a boss table). On fell, apply `worldStateDelta` (a kingdom-flavored world-state flag) and surface `defeatBeat` narration. Reuse the Act II fell path. Anti-shame: `defeatBeat` celebrates; there is no failure state (the foe rests). The DM (`dungeon-master.ts`) may reference the defeated boss + world state for continuity.
- **Clients:** encounter card shows the `motive` (pre-fell) and `defeatBeat` (on fell) on web + iOS.
- **Deps:** Act II fell path. Schema. Optional DM integration.
- **Risk:** medium (schema + narrative + cross-surface + world-state semantics).

---

## Recommended order: **A → B → C**

A is a fast, self-contained win that closes the "reacts to the last outcome" gap with zero new schema. B deepens identity. C is the largest and benefits from A/B (a named companion can reference a named boss's defeat). Each is independently shippable **server-first, then web + iOS** per the established cadence (server+web → `main`, iOS → `claude/swift-mobile-app-a70k2k`).
