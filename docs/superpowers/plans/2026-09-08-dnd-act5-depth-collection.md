# Act V — Depth & Collection (RPG-depth roadmap) — sequenced plan

> Fifth and final act of the 🎲 "FocusQuest RPG Roadmap" artifact. Act V is the payoff layer: give the long-haul player **identity** (a build they chose), **a home that visibly grows**, and **a collection to complete**. Depends on Acts I–III (all shipped) and pairs with Act IV. Like every prior act, most of the *substrate* already exists — this plan reconciles the roadmap against what ships and sequences the genuinely-new work. Server-first, additive-only, **anti-shame law non-negotiable** (a setback may only reframe or add upside — never a penalty, debuff, blame, or a permanent foreclosure that reads as loss).

## What already exists (reconcile, do not duplicate)

- **Feats** — [`class-feats.ts`](../../../artifacts/api-server/src/lib/class-feats.ts) + `feat_activations`: each class has exactly **two** feats (one active @ L4, one passive @ L6), **auto-unlocked by level — no choice, nothing branches, nothing locks**. So the roadmap's "feat *tree* where picking a branch locks siblings" is a genuinely-new **choice** mechanic, not an extension of the current flat list.
- **Tiers that grow** — [`kingdoms.ts`](../../../artifacts/api-server/src/lib/kingdoms.ts): every balance kingdom climbs `Wild → Outpost → Settlement → Village → Town → Stronghold`, and the **capital** climbs a separate 12-stage ladder `Wilds → … → Crown City → Eternal Capital` (`capitalTier`, derived from the sum of all kingdom lifetime points). The per-kingdom scenes already render + grow (`kingdom-scene.tsx`, `kingdom-map.tsx`, `kingdom-tier-pips.tsx`). **The capital tier is computed but never surfaced to the player** — it's used only to derive the character sheet's proficiency bonus.
- **Foes** — [`encounter-progress.ts`](../../../artifacts/api-server/src/lib/encounter-progress.ts): a roster of **8 named `FOES`**, each with `motive` / `defeatBeat` / `worldNote` (rich copy already written). `personal_encounters` rows record each foe by **`name` + `felledAt`** (a felled foe is stamped, then a fresh one spawns); `party_encounters` do the same for shared foes. So **who you've felled, and when, is already recorded** — a bestiary can be *derived*, not stored.

Gaps the roadmap actually asks for that are **not** built:
1. No **player choice** in feats — no build identity, no specialization.
2. The **capital/stronghold** the player is growing toward is invisible — no single "your seat, and how it's grown" surface.
3. No **collection** — the 8 foes you fight are never gathered into a bestiary you can complete.

---

## Slice A — Bestiary / Discovery Log · size S · **build first** (clean, upside-only)

**Goal:** turn the foes you fell into a collection you complete — a discovery log that fills in as you beat each of the roster's 8 foes.

- **Server:** a **derived** `GET /bestiary` — join the static `FOES` roster against the user's `personal_encounters` (and `party_encounter` fells) grouped by foe `name`: per foe `{ name, motive, discovered: bool, timesFelled, firstFelledAt, lastFelledAt }`, plus the currently-active foe. **No new table** — fell history already lives in `personal_encounters.felledAt`. An undiscovered foe returns its slot but **withholds** name/copy (the client shows a silhouette).
- **Clients:** a Bestiary screen (web page + iOS view) — a grid of the 8 slots; a felled foe reveals its portrait, `defeatBeat`, and `worldNote`; an unmet foe is a "??? — not yet encountered" silhouette. A quiet "3 / 8 discovered" completion line. **Anti-shame:** never "you failed to beat X"; unmet = *not yet met*, always forward-looking; a felled foe re-appearing (they rotate) is "faced again," never "back to haunt you."
- **Deps:** none beyond the shipped encounter roster. **No schema.**
- **Tests:** derive logic (roster × fell history → discovered set; withhold copy for unmet; count/dedupe multiple fells of one name).
- **Risk:** low. Pure delight, no anti-shame tension.

## Slice B — The Capital: a home that visibly grows · size S–M · second

**Goal:** make the "stronghold that visibly grows" real — surface the **capital** (the seat of the whole realm) as a single place that advances through its 12 tiers as the player's lifetime progress compounds.

- **Server:** a small read surface — `GET /capital` (or fold onto `hero-status`): `{ tier, name, points, nextThreshold, pointsToNext }` from the existing `capitalTier(capitalLifetime(...))`. **Derived from lifetime kingdom points — no new schema, and monotonic** (lifetime never falls, so the capital never visibly shrinks: anti-shame by construction).
- **Clients:** a **Capital scene** that reads its tier — reuse the `kingdom-scene` / art-pipeline patterns (a tier-gated illustration that gains structure as the capital climbs `Waystation → … → Eternal Capital`), plus a tier badge + "N to the next tier" progress. Mount on the Hero/realm surface (web + iOS). If bespoke capital art is too heavy for v1, ship the tier badge + progress + a reused kingdom-scene stand-in and flag the dedicated capital art as a pipeline follow-up (mirrors the LPC pipeline cadence).
- **Deps:** Slice A optional; capital ladder already exists. **No schema.**
- **Risk:** low-med — the mechanic is derived; the cost is art/visual polish, which can degrade gracefully to a badge + progress bar.

## Slice C — Branching Feat Tree · size M–L · third · **needs an anti-shame decision before building**

**Goal:** give the hero a **build** — a specialization the player *chooses*, so two Level-8 fighters can play differently.

This is the one genuinely-new *choice* mechanic and the one that **collides with the anti-shame law**: the roadmap's "picking a branch **locks siblings**" is a permanent foreclosure — losing access to the paths you didn't pick reads as regret/penalty, exactly what the law forbids. Reconciliation options to put to the user (same gate we used for Act II's fail band and Act IV's attrition):

1. **Free respec — "focus, not a cage" (recommended):** the tree is real (each class gets branches with meaningfully different, stronger feats), the player picks a specialization, but can **re-choose anytime** at no cost. Keeps the whole point — a deliberate build identity — while nothing is ever permanently lost. The "choice" is which strength is active now, not which doors close forever.
2. **Additive branches, no locking:** branches add **new** optional feats you invest in (e.g. coin-priced, or level-gated deeper), and choosing one **never removes** another — pure growth. Drops the roadmap's "locks siblings" entirely; simplest anti-shame story, but less build *identity* (you can eventually have everything).
3. **Literal roadmap — permanent sibling-lock:** the classic RPG foreclosure. **Rejected unless the user explicitly overrides the anti-shame law.**

- **Server (once chosen):** a feat-tree registry extending `class-feats.ts` (branches per class, each granting a real upside-only effect via the existing perk/passive seams); store the hero's current specialization — a single `users.feat_branch` column (respec model) or a small `user_feat_choices` table (if choices stack). Derive granted effects from the choice + level, like the current feats.
- **Clients:** a tree view (web + iOS) — branches, the picked path highlighted, pick/confirm (and re-choose, under option 1). Anti-shame copy throughout.
- **Deps:** the user's pick above; schema + client regen; real UX.
- **Risk:** med-high (new choice UX + the reconciliation). **Do not build until the user picks a reconciliation; Slices A and B ship independently.**

---

## Cross-cutting

- **Derive before you store:** A and B need **no new schema** (bestiary from `personal_encounters`; capital from lifetime points) — only C introduces stored state, and only a minimal one. Same discipline that kept Acts I–III lean.
- **Anti-shame:** an unmet foe is *not yet met* (never "unbeaten"); the capital only grows (lifetime-derived); the feat tree must never permanently foreclose upside (hence the option-1 default).
- **Tests:** pure derive logic for the bestiary + capital tier; feat-branch effect math (upside-only, additive) once C is chosen.
- **Client parity:** server+web → main, iOS → the swift branch, per the established cadence. Sequence **A → B → C**; A is the fastest win and C is gated on a decision.
